import express from "express";
import WebTorrent from "webtorrent";
import { Dropbox } from "dropbox";
import fetch from "isomorphic-fetch";
import dotenv from "dotenv";

// Carrega .env ANTES de ler as variáveis
dotenv.config();

const router = express.Router();

// --- CONFIGURAÇÕES ---
const ROOT_GAMES_FOLDER = "/Games_Switch";
const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
const ADMIN_PASS = process.env.ADMIN_PASS;

// Debug: Log para verificar se as variáveis foram carregadas
console.log(
  `[ManaBridge] ADMIN_EMAIL: ${ADMIN_EMAIL ? "✅ Configurado" : "❌ FALTANDO"}`
);
console.log(
  `[ManaBridge] ADMIN_PASS: ${ADMIN_PASS ? "✅ Configurado" : "❌ FALTANDO"}`
);

const dbx = new Dropbox({
  clientId: process.env.DROPBOX_APP_KEY,
  clientSecret: process.env.DROPBOX_APP_SECRET,
  refreshToken: process.env.DROPBOX_REFRESH_TOKEN,
  fetch,
});

const client = new WebTorrent();
let activeDownloads = {};

// --- MIDDLEWARE DE AUTENTICAÇÃO (SEM BIBLIOTECA EXTRA) ---
const requireAuth = (req, res, next) => {
  // 1. Verifica se as credenciais estão no .env
  if (!ADMIN_EMAIL || !ADMIN_PASS) {
    return res
      .status(500)
      .send("Erro: Configure ADMIN_EMAIL e ADMIN_PASS no .env");
  }

  // 2. Tenta ler o cookie 'auth_token' manualmente
  const cookies = req.headers.cookie || "";
  const token = cookies
    .split("; ")
    .find((row) => row.startsWith("auth_token="))
    ?.split("=")[1];

  // 3. O token é apenas um base64 de "email:senha" (Básico e funcional para este caso)
  const validToken = Buffer.from(`${ADMIN_EMAIL}:${ADMIN_PASS}`).toString(
    "base64"
  );

  if (token === validToken) {
    next();
  } else {
    res.redirect("/admin/login");
  }
};

// --- ROTA DE LOGIN (HTML) ---
router.get("/admin/login", (req, res) => {
  res.send(loginTemplate());
});

// --- ROTA DE AUTENTICAÇÃO (POST) ---
router.post("/bridge/auth", (req, res) => {
  const { email, password } = req.body;

  if (email === ADMIN_EMAIL && password === ADMIN_PASS) {
    // Cria o token
    const token = Buffer.from(`${email}:${password}`).toString("base64");
    // Define o cookie (HttpOnly para segurança)
    res.cookie("auth_token", token, { maxAge: 86400000, httpOnly: true });
    res.json({ success: true });
  } else {
    res.status(401).json({ error: "Credenciais inválidas" });
  }
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
router.post("/bridge/upload", requireAuth, (req, res) => {
  const magnet = req.body.magnet;
  if (!magnet) return res.status(400).json({ error: "Magnet link vazio" });

  const id = Date.now().toString();

  activeDownloads[id] = {
    id,
    name: "Inicializando...",
    state: "Metadata",
    progressPercent: 0,
    speed: "0 MB/s",
  };

  client.add(magnet, { path: "/tmp" }, (torrent) => {
    activeDownloads[id].name = torrent.name;
    activeDownloads[id].state = "Baixando Metadata...";

    // Seleciona o maior arquivo (jogo)
    const file = torrent.files.reduce((a, b) => (a.length > b.length ? a : b));

    if (!file.name.match(/\.(nsp|nsz|xci)$/i)) {
      activeDownloads[id].state = "Erro: Arquivo não é um jogo Switch";
      torrent.destroy();
      return;
    }

    activeDownloads[id].state = "🚀 Processando Stream...";

    const stream = file.createReadStream();

    dbx
      .filesUpload({
        path: `${ROOT_GAMES_FOLDER}/${file.name}`,
        contents: stream,
        mode: "add",
        autorename: true,
        mute: true,
      })
      .then(() => {
        activeDownloads[id].state = "✅ Sucesso! Disponível no Tinfoil.";
        activeDownloads[id].progressPercent = 100;
        // Remove da lista após 1 minuto para não poluir
        setTimeout(() => {
          delete activeDownloads[id];
        }, 60000);
        torrent.destroy();
      })
      .catch((err) => {
        console.error(err);
        activeDownloads[id].state = "❌ Falha no Upload (Erro Dropbox)";
        torrent.destroy();
      });

    torrent.on("download", () => {
      activeDownloads[id].progressPercent = (torrent.progress * 100).toFixed(1);
      activeDownloads[id].speed =
        (torrent.downloadSpeed / 1024 / 1024).toFixed(1) + " MB/s";
      activeDownloads[id].state = `Baixando & Enviando...`;
    });
  });

  res.json({ success: true });
});

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
            :root { --bg: #0f172a; --card: #1e293b; --text: #f1f5f9; --primary: #3b82f6; }
            body { background: var(--bg); color: var(--text); font-family: 'Segoe UI', sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
            .login-card { background: var(--card); padding: 2.5rem; border-radius: 16px; width: 100%; max-width: 350px; box-shadow: 0 10px 25px rgba(0,0,0,0.3); text-align: center; }
            h2 { margin-bottom: 1.5rem; font-weight: 600; color: #fff; }
            input { width: 100%; padding: 12px; margin-bottom: 15px; background: #334155; border: 1px solid #475569; border-radius: 8px; color: white; box-sizing: border-box; outline: none; }
            input:focus { border-color: var(--primary); }
            button { width: 100%; padding: 12px; background: var(--primary); color: white; border: none; border-radius: 8px; cursor: pointer; font-weight: bold; transition: 0.2s; }
            button:hover { opacity: 0.9; }
            .logo { font-size: 3rem; margin-bottom: 10px; display: block; }
        </style>
    </head>
    <body>
        <div class="login-card">
            <span class="logo">🎮</span>
            <h2>Mana Admin</h2>
            <form id="loginForm">
                <input type="email" id="email" placeholder="Email" required>
                <input type="password" id="password" placeholder="Senha" required>
                <button type="submit">Entrar</button>
            </form>
        </div>
        <script>
            document.getElementById('loginForm').addEventListener('submit', async (e) => {
                e.preventDefault();
                const email = document.getElementById('email').value;
                const password = document.getElementById('password').value;
                
                const res = await fetch('/bridge/auth', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ email, password })
                });
                
                if (res.ok) window.location.href = '/admin';
                else alert('Acesso Negado');
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
            :root { --bg: #0f172a; --card: #1e293b; --text: #94a3b8; --white: #f8fafc; --primary: #6366f1; --success: #10b981; }
            body { background: var(--bg); color: var(--text); font-family: 'Segoe UI', sans-serif; margin: 0; padding: 20px; }
            .container { max-width: 800px; margin: 0 auto; }
            
            /* Header */
            header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 40px; }
            h1 { color: var(--white); font-size: 1.5rem; display: flex; align-items: center; gap: 10px; margin: 0; }
            .badge { background: #334155; padding: 5px 10px; border-radius: 20px; font-size: 0.8rem; }
            
            /* Add Section */
            .add-box { background: var(--card); padding: 20px; border-radius: 12px; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1); display: flex; gap: 10px; flex-wrap: wrap; }
            input { flex: 1; padding: 12px; background: #0f172a; border: 1px solid #334155; border-radius: 8px; color: white; min-width: 200px; }
            button { padding: 12px 24px; background: var(--primary); color: white; border: none; border-radius: 8px; cursor: pointer; font-weight: 600; }
            button:hover { opacity: 0.9; }

            /* List Section */
            h3 { margin-top: 30px; color: var(--white); font-weight: 500; }
            .grid { display: grid; gap: 15px; margin-top: 15px; }
            .card { background: var(--card); padding: 20px; border-radius: 10px; border-left: 4px solid var(--primary); animation: fadeIn 0.3s ease; }
            .card-header { display: flex; justify-content: space-between; margin-bottom: 10px; }
            .game-name { color: var(--white); font-weight: 600; }
            .speed { font-size: 0.85rem; color: var(--text); }
            
            /* Progress Bar */
            .progress-bg { height: 6px; background: #334155; border-radius: 3px; overflow: hidden; }
            .progress-fill { height: 100%; background: linear-gradient(90deg, var(--primary), var(--success)); width: 0%; transition: width 0.5s ease; }
            .status-text { font-size: 0.8rem; margin-top: 8px; display: block; }

            @keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
        </style>
    </head>
    <body>
        <div class="container">
            <header>
                <h1>🎮 Mana Bridge <span class="badge">v2.0</span></h1>
                <div style="font-size: 0.9rem">Logado como Admin</div>
            </header>

            <div class="add-box">
                <input type="text" id="magnet" placeholder="Cole o Magnet Link aqui..." autocomplete="off">
                <button onclick="uploadGame()">🚀 Iniciar Download</button>
            </div>

            <h3>Downloads Ativos</h3>
            <div id="downloads-list" class="grid">
                <div style="text-align: center; padding: 20px; opacity: 0.5;">Nenhum download ativo no momento.</div>
            </div>
        </div>

        <script>
            async function uploadGame() {
                const magnet = document.getElementById('magnet').value;
                if (!magnet) return alert('Por favor, cole um link!');
                
                const btn = document.querySelector('button');
                const originalText = btn.innerText;
                btn.innerText = 'Enviando...';
                btn.disabled = true;

                try {
                    const res = await fetch('/bridge/upload', {
                        method: 'POST',
                        headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify({ magnet })
                    });
                    
                    if(res.ok) {
                        document.getElementById('magnet').value = '';
                        loadStatus();
                    } else {
                        alert('Erro ao iniciar. Verifique o link.');
                    }
                } catch(e) { console.error(e); }
                
                btn.innerText = originalText;
                btn.disabled = false;
            }

            async function loadStatus() {
                try {
                    const res = await fetch('/bridge/status');
                    if (res.status === 401 || res.status === 403) window.location.href = '/admin/login';
                    
                    const list = await res.json();
                    const container = document.getElementById('downloads-list');
                    
                    if (list.length === 0) {
                        container.innerHTML = '<div style="text-align: center; padding: 20px; opacity: 0.5;">Nenhum download ativo no momento.</div>';
                        return;
                    }

                    container.innerHTML = list.map(item => \`
                        <div class="card">
                            <div class="card-header">
                                <span class="game-name">\${item.name}</span>
                                <span class="speed">\${item.speed}</span>
                            </div>
                            <div class="progress-bg">
                                <div class="progress-fill" style="width: \${item.percent}%"></div>
                            </div>
                            <span class="status-text">\${item.status} (\${item.percent}%)</span>
                        </div>
                    \`).join('');
                } catch(e) { console.error(e); }
            }

            setInterval(loadStatus, 2000);
            loadStatus();
        </script>
    </body>
    </html>
    `;
}

export default router;
