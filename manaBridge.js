import express from "express";
import WebTorrent from "webtorrent";
import { Dropbox } from "dropbox";
import fetch from "isomorphic-fetch";
import dotenv from "dotenv";
import { Readable } from "stream";

// Carrega .env ANTES de ler as variáveis
dotenv.config();

const router = express.Router();

// --- CONFIGURAÇÕES ---
const ROOT_GAMES_FOLDER = "/Games_Switch";
const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
const ADMIN_PASS = process.env.ADMIN_PASS;
const IS_PRODUCTION = !!process.env.DOMINIO; // Se tem domínio, está em produção

// Debug: Log para verificar se as variáveis foram carregadas
console.log(
  `[ManaBridge] ADMIN_EMAIL: ${ADMIN_EMAIL ? "✅ Configurado" : "❌ FALTANDO"}`
);
console.log(
  `[ManaBridge] ADMIN_PASS: ${ADMIN_PASS ? "✅ Configurado" : "❌ FALTANDO"}`
);
console.log(`[ManaBridge] Ambiente: ${IS_PRODUCTION ? "Produção" : "Local"}`);

const dbx = new Dropbox({
  clientId: process.env.DROPBOX_APP_KEY,
  clientSecret: process.env.DROPBOX_APP_SECRET,
  refreshToken: process.env.DROPBOX_REFRESH_TOKEN,
  fetch,
});

const client = new WebTorrent();
let activeDownloads = {};

// --- HELPER: Gera token de autenticação ---
function generateToken(email, pass) {
  return Buffer.from(`${email}:${pass}`).toString("base64");
}

// --- HELPER: Configurações do Cookie ---
function getCookieOptions() {
  // Configuração simplificada que funciona tanto em dev quanto prod
  return {
    maxAge: 86400000, // 24 horas
    httpOnly: true,
    path: "/",
    sameSite: "lax", // Lax funciona bem para same-site navigation
    secure: IS_PRODUCTION, // Só true em HTTPS
  };
}

// --- MIDDLEWARE DE AUTENTICAÇÃO ---
const requireAuth = (req, res, next) => {
  // 1. Verifica se as credenciais estão no .env
  if (!ADMIN_EMAIL || !ADMIN_PASS) {
    console.error("[ManaBridge] ❌ Credenciais não configuradas!");
    return res
      .status(500)
      .send("Erro: Configure ADMIN_EMAIL e ADMIN_PASS no .env");
  }

  // 2. Tenta ler o cookie 'auth_token'
  const cookies = req.headers.cookie || "";
  const tokenMatch = cookies.match(/auth_token=([^;]+)/);
  let token = tokenMatch ? tokenMatch[1] : null;

  // IMPORTANTE: Decodifica o token caso tenha sido URL-encoded
  if (token) {
    try {
      token = decodeURIComponent(token);
    } catch (e) {
      // Se falhar, mantém o original
    }
  }

  console.log(
    `[ManaBridge] Auth check - Token presente: ${token ? "Sim" : "Não"}`
  );

  // 3. Valida o token
  const validToken = generateToken(ADMIN_EMAIL, ADMIN_PASS);

  // DEBUG: Compara os tokens
  console.log(
    `[ManaBridge] Token recebido: ${
      token ? token.substring(0, 20) + "..." : "null"
    }`
  );
  console.log(`[ManaBridge] Token esperado: ${validToken.substring(0, 20)}...`);
  console.log(`[ManaBridge] Match: ${token === validToken}`);

  if (token === validToken) {
    console.log("[ManaBridge] ✅ Autenticação válida");
    next();
  } else {
    console.log("[ManaBridge] ❌ Token inválido, redirecionando para login");
    res.redirect("/admin/login");
  }
};

// --- ROTA DE LOGIN (HTML) ---
router.get("/admin/login", (req, res) => {
  // Se já está logado, redireciona para o dashboard
  const cookies = req.headers.cookie || "";
  const tokenMatch = cookies.match(/auth_token=([^;]+)/);
  const token = tokenMatch ? tokenMatch[1] : null;
  const validToken = generateToken(ADMIN_EMAIL, ADMIN_PASS);

  if (token === validToken) {
    return res.redirect("/admin");
  }

  res.send(loginTemplate());
});

// --- ROTA DE AUTENTICAÇÃO (POST) ---
router.post("/bridge/auth", (req, res) => {
  const { email, password } = req.body;

  console.log(`[ManaBridge] Tentativa de login: ${email}`);

  if (!email || !password) {
    console.log("[ManaBridge] ❌ Email ou senha vazios");
    return res.status(400).json({ error: "Email e senha são obrigatórios" });
  }

  if (email === ADMIN_EMAIL && password === ADMIN_PASS) {
    console.log("[ManaBridge] ✅ Login bem sucedido!");

    // Cria o token
    const token = generateToken(email, password);

    // Define o cookie com as opções corretas
    res.cookie("auth_token", token, getCookieOptions());

    console.log("[ManaBridge] Cookie definido:", getCookieOptions());

    res.json({ success: true, redirect: "/admin" });
  } else {
    console.log("[ManaBridge] ❌ Credenciais inválidas");
    res.status(401).json({ error: "Credenciais inválidas" });
  }
});

// --- ROTA DE LOGOUT ---
router.get("/admin/logout", (req, res) => {
  res.clearCookie("auth_token", { path: "/" });
  res.redirect("/admin/login");
});

// --- ROTA DO DASHBOARD (PROTEGIDA) ---
router.get("/admin", requireAuth, (req, res) => {
  res.send(dashboardTemplate());
});

// --- API DE STATUS (PROTEGIDA) ---
router.get("/bridge/status", requireAuth, (req, res) => {
  const list = Object.values(activeDownloads).map((d) => ({
    id: d.id,
    name: d.name,
    status: d.state,
    percent: d.progressPercent,
    speed: d.speed,
  }));
  res.json(list);
});

// --- API DE UPLOAD (PROTEGIDA) ---
router.post("/bridge/upload", requireAuth, async (req, res) => {
  const magnet = req.body.magnet;
  if (!magnet) return res.status(400).json({ error: "Magnet link vazio" });

  const id = Date.now().toString();

  activeDownloads[id] = {
    id,
    name: "Inicializando...",
    state: "Conectando aos peers...",
    progressPercent: 0,
    speed: "0 MB/s",
  };

  console.log(`[ManaBridge] 🚀 Iniciando download: ${id}`);

  try {
    client.add(magnet, { path: "/tmp" }, (torrent) => {
      console.log(`[ManaBridge] Torrent conectado: ${torrent.name}`);
      activeDownloads[id].name = torrent.name;
      activeDownloads[id].state = "Baixando Metadata...";

      // Seleciona o maior arquivo (jogo)
      const file = torrent.files.reduce((a, b) =>
        a.length > b.length ? a : b
      );

      console.log(
        `[ManaBridge] Arquivo selecionado: ${file.name} (${(
          file.length /
          1024 /
          1024 /
          1024
        ).toFixed(2)} GB)`
      );

      if (!file.name.match(/\.(nsp|nsz|xci)$/i)) {
        activeDownloads[id].state = "❌ Erro: Arquivo não é um jogo Switch";
        console.log("[ManaBridge] ❌ Arquivo não é um jogo Switch");
        torrent.destroy();
        return;
      }

      activeDownloads[id].state = "🚀 Preparando upload...";
      activeDownloads[id].name = file.name;

      // Para arquivos grandes, usamos Upload Session do Dropbox
      const fileSizeMB = file.length / 1024 / 1024;
      console.log(`[ManaBridge] Tamanho: ${fileSizeMB.toFixed(2)} MB`);

      if (fileSizeMB > 150) {
        // Upload em sessão para arquivos grandes
        uploadLargeFile(file, id, torrent);
      } else {
        // Upload direto para arquivos pequenos
        uploadSmallFile(file, id, torrent);
      }

      torrent.on("download", () => {
        activeDownloads[id].progressPercent = (torrent.progress * 100).toFixed(
          1
        );
        activeDownloads[id].speed =
          (torrent.downloadSpeed / 1024 / 1024).toFixed(1) + " MB/s";
      });

      torrent.on("error", (err) => {
        console.error("[ManaBridge] Erro no torrent:", err);
        activeDownloads[id].state = `❌ Erro: ${err.message}`;
      });
    });

    // Timeout para magnet links que não conectam
    setTimeout(() => {
      if (
        activeDownloads[id] &&
        activeDownloads[id].state === "Conectando aos peers..."
      ) {
        activeDownloads[id].state = "❌ Timeout: Nenhum peer encontrado";
        console.log("[ManaBridge] ❌ Timeout no magnet link");
      }
    }, 60000);
  } catch (err) {
    console.error("[ManaBridge] Erro ao adicionar torrent:", err);
    activeDownloads[id].state = `❌ Erro: ${err.message}`;
  }

  res.json({ success: true, id });
});

// --- UPLOAD PEQUENO (< 150MB) ---
async function uploadSmallFile(file, id, torrent) {
  try {
    activeDownloads[id].state = "📤 Enviando para Dropbox...";

    const chunks = [];
    const stream = file.createReadStream();

    stream.on("data", (chunk) => chunks.push(chunk));
    stream.on("end", async () => {
      const buffer = Buffer.concat(chunks);

      await dbx.filesUpload({
        path: `${ROOT_GAMES_FOLDER}/${file.name}`,
        contents: buffer,
        mode: "add",
        autorename: true,
        mute: true,
      });

      finishUpload(id, torrent);
    });

    stream.on("error", (err) => {
      console.error("[ManaBridge] Erro no stream:", err);
      activeDownloads[id].state = `❌ Erro no stream: ${err.message}`;
      torrent.destroy();
    });
  } catch (err) {
    console.error("[ManaBridge] Erro upload pequeno:", err);
    activeDownloads[id].state = `❌ Falha no Upload: ${err.message}`;
    torrent.destroy();
  }
}

// --- UPLOAD GRANDE (> 150MB) - Usa Session ---
async function uploadLargeFile(file, id, torrent) {
  try {
    activeDownloads[id].state = "📤 Iniciando upload em sessão...";

    const CHUNK_SIZE = 8 * 1024 * 1024; // 8MB por chunk
    const stream = file.createReadStream();
    let sessionId = null;
    let offset = 0;

    const chunks = [];

    stream.on("data", (chunk) => {
      chunks.push(chunk);
    });

    stream.on("end", async () => {
      try {
        const fullBuffer = Buffer.concat(chunks);
        const totalSize = fullBuffer.length;

        console.log(
          `[ManaBridge] Upload sessão: ${(totalSize / 1024 / 1024).toFixed(
            2
          )} MB`
        );

        // Primeiro chunk - inicia sessão
        const firstChunk = fullBuffer.slice(0, Math.min(CHUNK_SIZE, totalSize));
        const startResult = await dbx.filesUploadSessionStart({
          close: false,
          contents: firstChunk,
        });
        sessionId = startResult.result.session_id;
        offset = firstChunk.length;

        activeDownloads[id].state = `📤 Enviando... ${(
          (offset / totalSize) *
          100
        ).toFixed(0)}%`;

        // Chunks do meio
        while (offset < totalSize - CHUNK_SIZE) {
          const chunk = fullBuffer.slice(offset, offset + CHUNK_SIZE);
          await dbx.filesUploadSessionAppendV2({
            cursor: { session_id: sessionId, offset: offset },
            close: false,
            contents: chunk,
          });
          offset += chunk.length;
          activeDownloads[id].state = `📤 Enviando... ${(
            (offset / totalSize) *
            100
          ).toFixed(0)}%`;
          activeDownloads[id].progressPercent = (
            (offset / totalSize) *
            100
          ).toFixed(1);
        }

        // Último chunk - finaliza
        const lastChunk = fullBuffer.slice(offset);
        await dbx.filesUploadSessionFinish({
          cursor: { session_id: sessionId, offset: offset },
          commit: {
            path: `${ROOT_GAMES_FOLDER}/${file.name}`,
            mode: "add",
            autorename: true,
            mute: true,
          },
          contents: lastChunk,
        });

        finishUpload(id, torrent);
      } catch (err) {
        console.error("[ManaBridge] Erro no upload sessão:", err);
        activeDownloads[id].state = `❌ Falha no Upload: ${err.message}`;
        torrent.destroy();
      }
    });

    stream.on("error", (err) => {
      console.error("[ManaBridge] Erro no stream:", err);
      activeDownloads[id].state = `❌ Erro no stream: ${err.message}`;
      torrent.destroy();
    });
  } catch (err) {
    console.error("[ManaBridge] Erro upload grande:", err);
    activeDownloads[id].state = `❌ Falha no Upload: ${err.message}`;
    torrent.destroy();
  }
}

// --- FINALIZA UPLOAD ---
function finishUpload(id, torrent) {
  console.log(`[ManaBridge] ✅ Upload concluído: ${activeDownloads[id].name}`);
  activeDownloads[id].state = "✅ Sucesso! Disponível no Tinfoil.";
  activeDownloads[id].progressPercent = 100;

  // Remove da lista após 2 minutos
  setTimeout(() => {
    delete activeDownloads[id];
  }, 120000);

  torrent.destroy();
}

// ==========================================
// TEMPLATES HTML/CSS (FRONTEND MODERNO)
// ==========================================

function loginTemplate() {
  return `
    <!DOCTYPE html>
    <html lang="pt-BR">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Mana Shop | Login</title>
        <style>
            :root { --bg: #0f172a; --card: #1e293b; --text: #f1f5f9; --primary: #3b82f6; --error: #ef4444; }
            body { background: var(--bg); color: var(--text); font-family: 'Segoe UI', sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
            .login-card { background: var(--card); padding: 2.5rem; border-radius: 16px; width: 100%; max-width: 350px; box-shadow: 0 10px 25px rgba(0,0,0,0.3); text-align: center; }
            h2 { margin-bottom: 1.5rem; font-weight: 600; color: #fff; }
            input { width: 100%; padding: 12px; margin-bottom: 15px; background: #334155; border: 1px solid #475569; border-radius: 8px; color: white; box-sizing: border-box; outline: none; }
            input:focus { border-color: var(--primary); }
            button { width: 100%; padding: 12px; background: var(--primary); color: white; border: none; border-radius: 8px; cursor: pointer; font-weight: bold; transition: 0.2s; }
            button:hover { opacity: 0.9; }
            button:disabled { opacity: 0.5; cursor: not-allowed; }
            .logo { font-size: 3rem; margin-bottom: 10px; display: block; }
            .error { color: var(--error); font-size: 0.9rem; margin-bottom: 15px; display: none; }
            .error.show { display: block; }
        </style>
    </head>
    <body>
        <div class="login-card">
            <span class="logo">🎮</span>
            <h2>Mana Admin</h2>
            <div id="error" class="error"></div>
            <form id="loginForm">
                <input type="email" id="email" placeholder="Email" required autocomplete="email">
                <input type="password" id="password" placeholder="Senha" required autocomplete="current-password">
                <button type="submit" id="submitBtn">Entrar</button>
            </form>
        </div>
        <script>
            document.getElementById('loginForm').addEventListener('submit', async (e) => {
                e.preventDefault();
                
                const email = document.getElementById('email').value;
                const password = document.getElementById('password').value;
                const errorDiv = document.getElementById('error');
                const btn = document.getElementById('submitBtn');
                
                errorDiv.classList.remove('show');
                btn.disabled = true;
                btn.innerText = 'Entrando...';
                
                try {
                    const res = await fetch('/bridge/auth', {
                        method: 'POST',
                        headers: {'Content-Type': 'application/json'},
                        credentials: 'include',
                        body: JSON.stringify({ email, password })
                    });
                    
                    const data = await res.json();
                    
                    if (res.ok && data.success) {
                        // Pequeno delay para garantir que o cookie foi salvo
                        setTimeout(() => {
                            window.location.href = data.redirect || '/admin';
                        }, 100);
                    } else {
                        errorDiv.innerText = data.error || 'Acesso Negado';
                        errorDiv.classList.add('show');
                        btn.disabled = false;
                        btn.innerText = 'Entrar';
                    }
                } catch(err) {
                    console.error(err);
                    errorDiv.innerText = 'Erro de conexão. Tente novamente.';
                    errorDiv.classList.add('show');
                    btn.disabled = false;
                    btn.innerText = 'Entrar';
                }
            });
        </script>
    </body>
    </html>
    `;
}

function dashboardTemplate() {
  return `
    <!DOCTYPE html>
    <html lang="pt-BR">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Mana Shop | Dashboard</title>
        <style>
            :root { --bg: #0f172a; --card: #1e293b; --text: #94a3b8; --white: #f8fafc; --primary: #6366f1; --success: #10b981; --error: #ef4444; }
            body { background: var(--bg); color: var(--text); font-family: 'Segoe UI', sans-serif; margin: 0; padding: 20px; }
            .container { max-width: 800px; margin: 0 auto; }
            
            /* Header */
            header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 40px; flex-wrap: wrap; gap: 10px; }
            h1 { color: var(--white); font-size: 1.5rem; display: flex; align-items: center; gap: 10px; margin: 0; }
            .badge { background: #334155; padding: 5px 10px; border-radius: 20px; font-size: 0.8rem; }
            .logout { color: var(--text); text-decoration: none; font-size: 0.9rem; }
            .logout:hover { color: var(--error); }
            
            /* Add Section */
            .add-box { background: var(--card); padding: 20px; border-radius: 12px; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1); display: flex; gap: 10px; flex-wrap: wrap; }
            input { flex: 1; padding: 12px; background: #0f172a; border: 1px solid #334155; border-radius: 8px; color: white; min-width: 200px; }
            button { padding: 12px 24px; background: var(--primary); color: white; border: none; border-radius: 8px; cursor: pointer; font-weight: 600; }
            button:hover { opacity: 0.9; }
            button:disabled { opacity: 0.5; cursor: not-allowed; }

            /* List Section */
            h3 { margin-top: 30px; color: var(--white); font-weight: 500; }
            .grid { display: grid; gap: 15px; margin-top: 15px; }
            .card { background: var(--card); padding: 20px; border-radius: 10px; border-left: 4px solid var(--primary); animation: fadeIn 0.3s ease; }
            .card.success { border-left-color: var(--success); }
            .card.error { border-left-color: var(--error); }
            .card-header { display: flex; justify-content: space-between; margin-bottom: 10px; }
            .game-name { color: var(--white); font-weight: 600; word-break: break-all; }
            .speed { font-size: 0.85rem; color: var(--text); white-space: nowrap; }
            
            /* Progress Bar */
            .progress-bg { height: 6px; background: #334155; border-radius: 3px; overflow: hidden; }
            .progress-fill { height: 100%; background: linear-gradient(90deg, var(--primary), var(--success)); width: 0%; transition: width 0.5s ease; }
            .status-text { font-size: 0.8rem; margin-top: 8px; display: block; }

            .empty { text-align: center; padding: 40px 20px; opacity: 0.5; }
            
            @keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
        </style>
    </head>
    <body>
        <div class="container">
            <header>
                <h1>🎮 Mana Bridge <span class="badge">v3.0</span></h1>
                <a href="/admin/logout" class="logout">🚪 Sair</a>
            </header>

            <div class="add-box">
                <input type="text" id="magnet" placeholder="Cole o Magnet Link aqui..." autocomplete="off">
                <button id="uploadBtn" onclick="uploadGame()">🚀 Iniciar Download</button>
            </div>

            <h3>Downloads Ativos</h3>
            <div id="downloads-list" class="grid">
                <div class="empty">Nenhum download ativo no momento.</div>
            </div>
        </div>

        <script>
            async function uploadGame() {
                const magnet = document.getElementById('magnet').value.trim();
                if (!magnet) return alert('Por favor, cole um link!');
                
                const btn = document.getElementById('uploadBtn');
                btn.innerText = 'Enviando...';
                btn.disabled = true;

                try {
                    const res = await fetch('/bridge/upload', {
                        method: 'POST',
                        headers: {'Content-Type': 'application/json'},
                        credentials: 'include',
                        body: JSON.stringify({ magnet })
                    });
                    
                    if (res.status === 401) {
                        window.location.href = '/admin/login';
                        return;
                    }
                    
                    if(res.ok) {
                        document.getElementById('magnet').value = '';
                        loadStatus();
                    } else {
                        const data = await res.json();
                        alert(data.error || 'Erro ao iniciar. Verifique o link.');
                    }
                } catch(e) { 
                    console.error(e);
                    alert('Erro de conexão');
                }
                
                btn.innerText = '🚀 Iniciar Download';
                btn.disabled = false;
            }

            async function loadStatus() {
                try {
                    const res = await fetch('/bridge/status', { credentials: 'include' });
                    
                    if (res.status === 401) {
                        window.location.href = '/admin/login';
                        return;
                    }
                    
                    const list = await res.json();
                    const container = document.getElementById('downloads-list');
                    
                    if (list.length === 0) {
                        container.innerHTML = '<div class="empty">Nenhum download ativo no momento.</div>';
                        return;
                    }

                    container.innerHTML = list.map(item => {
                        let cardClass = 'card';
                        if (item.status.includes('✅')) cardClass += ' success';
                        if (item.status.includes('❌')) cardClass += ' error';
                        
                        return \`
                            <div class="\${cardClass}">
                                <div class="card-header">
                                    <span class="game-name">\${item.name}</span>
                                    <span class="speed">\${item.speed}</span>
                                </div>
                                <div class="progress-bg">
                                    <div class="progress-fill" style="width: \${item.percent}%"></div>
                                </div>
                                <span class="status-text">\${item.status} (\${item.percent}%)</span>
                            </div>
                        \`;
                    }).join('');
                } catch(e) { console.error(e); }
            }

            // Atualiza a cada 2 segundos
            setInterval(loadStatus, 2000);
            loadStatus();
            
            // Enter para enviar
            document.getElementById('magnet').addEventListener('keypress', (e) => {
                if (e.key === 'Enter') uploadGame();
            });
        </script>
    </body>
    </html>
    `;
}

export default router;
