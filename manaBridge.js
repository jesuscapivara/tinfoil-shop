import express from "express";
import WebTorrent from "webtorrent";
import { Dropbox } from "dropbox";
import fetch from "isomorphic-fetch";
import dotenv from "dotenv";
import multer from "multer";
import { loginTemplate, dashboardTemplate } from "./templates.js";

// Carrega .env ANTES de ler as variáveis
dotenv.config();

// Configuração do Multer para upload de arquivos .torrent
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max para arquivo .torrent
  fileFilter: (req, file, cb) => {
    if (file.originalname.endsWith(".torrent")) {
      cb(null, true);
    } else {
      cb(new Error("Apenas arquivos .torrent são permitidos"), false);
    }
  },
});

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

// --- HELPER: Extrai nome do jogo para criar pasta ---
function extractGameName(fileName) {
  // Remove extensão e informações extras como [TitleID][version](size)
  // Ex: "Hades 2 [0100A00019DE0000][v0] (4.22 GB).nsz" -> "Hades 2"
  let name = fileName
    .replace(/\.(nsp|nsz|xci)$/i, "") // Remove extensão
    .replace(/\s*\[[^\]]+\]/g, "") // Remove [TitleID], [version], etc
    .replace(/\s*\([^)]+\)/g, "") // Remove (size), (region), etc
    .trim();

  // Se ficou vazio, usa o nome original sem extensão
  if (!name) {
    name = fileName.replace(/\.(nsp|nsz|xci)$/i, "").trim();
  }

  // Limpa caracteres inválidos para nome de pasta
  name = name.replace(/[<>:"/\\|?*]/g, "_");

  return name || "Unknown_Game";
}

// --- FUNÇÃO COMUM PARA PROCESSAR TORRENT ---
function processTorrent(torrentInput, id, inputType = "magnet") {
  console.log(`[ManaBridge] 🚀 Processando ${inputType}: ${id}`);

  client.add(torrentInput, { path: "/tmp" }, (torrent) => {
    console.log(`[ManaBridge] ✅ Torrent conectado: ${torrent.name}`);
    console.log(`[ManaBridge] 📁 Arquivos no torrent: ${torrent.files.length}`);

    activeDownloads[id].name = torrent.name;
    activeDownloads[id].state = "📥 Baixando...";

    // Lista todos os arquivos de jogo no torrent
    const gameFiles = torrent.files.filter((f) =>
      f.name.match(/\.(nsp|nsz|xci)$/i)
    );

    console.log(
      `[ManaBridge] 🎮 Arquivos de jogo encontrados: ${gameFiles.length}`
    );
    gameFiles.forEach((f, i) => {
      console.log(
        `   ${i + 1}. ${f.name} (${(f.length / 1024 / 1024 / 1024).toFixed(
          2
        )} GB)`
      );
    });

    if (gameFiles.length === 0) {
      activeDownloads[id].state =
        "❌ Erro: Nenhum arquivo de jogo Switch encontrado";
      console.log("[ManaBridge] ❌ Nenhum arquivo .nsp/.nsz/.xci encontrado");
      torrent.destroy();
      return;
    }

    // Pega o maior arquivo de jogo (geralmente o jogo base)
    const mainFile = gameFiles.reduce((a, b) => (a.length > b.length ? a : b));
    const gameFolderName = extractGameName(mainFile.name);

    console.log(`[ManaBridge] 📂 Pasta do jogo: ${gameFolderName}`);
    activeDownloads[id].name = gameFolderName;

    // Evento de progresso
    torrent.on("download", () => {
      const progress = (torrent.progress * 100).toFixed(1);
      activeDownloads[id].progressPercent = progress;
      activeDownloads[id].speed =
        (torrent.downloadSpeed / 1024 / 1024).toFixed(1) + " MB/s";
      activeDownloads[id].state = `📥 Baixando... ${progress}%`;
    });

    // QUANDO O DOWNLOAD COMPLETAR
    torrent.on("done", async () => {
      console.log(`[ManaBridge] ✅ Download completo: ${torrent.name}`);
      activeDownloads[id].state = "📤 Preparando upload para Dropbox...";
      activeDownloads[id].progressPercent = 0;

      try {
        // Faz upload de todos os arquivos de jogo
        for (let i = 0; i < gameFiles.length; i++) {
          const file = gameFiles[i];
          const destPath = `${ROOT_GAMES_FOLDER}/${gameFolderName}/${file.name}`;

          console.log(
            `[ManaBridge] 📤 Enviando (${i + 1}/${gameFiles.length}): ${
              file.name
            }`
          );
          activeDownloads[id].state = `📤 Enviando ${i + 1}/${
            gameFiles.length
          }: ${file.name}`;

          await uploadFileToDropbox(file, destPath, id, gameFiles.length, i);
        }

        // Sucesso!
        console.log(`[ManaBridge] ✅ Upload completo para: ${gameFolderName}`);
        activeDownloads[id].state = "✅ Sucesso! Jogos disponíveis no Tinfoil.";
        activeDownloads[id].progressPercent = 100;

        // Remove da lista após 2 minutos
        setTimeout(() => {
          delete activeDownloads[id];
        }, 120000);
      } catch (err) {
        console.error("[ManaBridge] ❌ Erro no upload:", err);
        activeDownloads[id].state = `❌ Falha no Upload: ${err.message}`;
      } finally {
        torrent.destroy();
      }
    });

    torrent.on("error", (err) => {
      console.error("[ManaBridge] ❌ Erro no torrent:", err);
      activeDownloads[id].state = `❌ Erro: ${err.message}`;
    });
  });

  // Timeout para torrents que não conectam (5 minutos)
  setTimeout(() => {
    if (
      activeDownloads[id] &&
      activeDownloads[id].state === "Conectando aos peers..."
    ) {
      activeDownloads[id].state = "❌ Timeout: Nenhum peer encontrado";
      console.log("[ManaBridge] ❌ Timeout no torrent");
    }
  }, 300000);
}

// --- UPLOAD DE ARQUIVO PARA DROPBOX (com retry) ---
async function uploadFileToDropbox(
  file,
  destPath,
  downloadId,
  totalFiles,
  currentIndex
) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const stream = file.createReadStream();

    stream.on("data", (chunk) => chunks.push(chunk));

    stream.on("end", async () => {
      try {
        const buffer = Buffer.concat(chunks);
        const fileSizeMB = buffer.length / 1024 / 1024;

        console.log(`[ManaBridge] Buffer pronto: ${fileSizeMB.toFixed(2)} MB`);

        if (fileSizeMB > 150) {
          // Upload em sessão para arquivos grandes
          await uploadLargeBuffer(buffer, destPath, downloadId);
        } else {
          // Upload direto para arquivos pequenos
          console.log(`[ManaBridge] Upload direto para: ${destPath}`);
          await dbx.filesUpload({
            path: destPath,
            contents: buffer,
            mode: { ".tag": "add" },
            autorename: true,
            mute: true,
          });
        }

        // Atualiza progresso geral
        const overallProgress = (
          ((currentIndex + 1) / totalFiles) *
          100
        ).toFixed(1);
        activeDownloads[downloadId].progressPercent = overallProgress;

        console.log(`[ManaBridge] ✅ Upload concluído: ${destPath}`);
        resolve();
      } catch (err) {
        console.error(`[ManaBridge] ❌ Erro upload ${destPath}:`, err);
        reject(err);
      }
    });

    stream.on("error", (err) => {
      console.error("[ManaBridge] ❌ Erro no stream:", err);
      reject(err);
    });
  });
}

// --- UPLOAD GRANDE EM SESSÃO ---
async function uploadLargeBuffer(buffer, destPath, downloadId) {
  const CHUNK_SIZE = 8 * 1024 * 1024; // 8MB
  const totalSize = buffer.length;
  let offset = 0;

  console.log(
    `[ManaBridge] Upload em sessão: ${(totalSize / 1024 / 1024).toFixed(2)} MB`
  );

  // Primeiro chunk - inicia sessão
  const firstChunk = buffer.slice(0, Math.min(CHUNK_SIZE, totalSize));
  const startResult = await dbx.filesUploadSessionStart({
    close: false,
    contents: firstChunk,
  });
  const sessionId = startResult.result.session_id;
  offset = firstChunk.length;

  console.log(`[ManaBridge] Sessão iniciada: ${sessionId.substring(0, 20)}...`);

  // Chunks do meio
  while (offset < totalSize - CHUNK_SIZE) {
    const chunk = buffer.slice(offset, offset + CHUNK_SIZE);
    await dbx.filesUploadSessionAppendV2({
      cursor: { session_id: sessionId, offset: offset },
      close: false,
      contents: chunk,
    });
    offset += chunk.length;

    const progress = ((offset / totalSize) * 100).toFixed(0);
    activeDownloads[downloadId].state = `📤 Enviando... ${progress}%`;
    console.log(`[ManaBridge] Progresso: ${progress}%`);
  }

  // Último chunk - finaliza
  const lastChunk = buffer.slice(offset);
  await dbx.filesUploadSessionFinish({
    cursor: { session_id: sessionId, offset: offset },
    commit: {
      path: destPath,
      mode: { ".tag": "add" },
      autorename: true,
      mute: true,
    },
    contents: lastChunk,
  });

  console.log(`[ManaBridge] ✅ Sessão finalizada: ${destPath}`);
}

// --- API DE UPLOAD VIA MAGNET LINK (PROTEGIDA) ---
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

  try {
    processTorrent(magnet, id, "magnet");
    res.json({ success: true, id });
  } catch (err) {
    console.error("[ManaBridge] Erro ao adicionar magnet:", err);
    activeDownloads[id].state = `❌ Erro: ${err.message}`;
    res.status(500).json({ error: err.message });
  }
});

// --- API DE UPLOAD VIA ARQUIVO .TORRENT (PROTEGIDA) ---
router.post(
  "/bridge/upload-torrent",
  requireAuth,
  upload.single("torrentFile"),
  async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: "Arquivo .torrent não enviado" });
    }

    const id = Date.now().toString();

    activeDownloads[id] = {
      id,
      name: req.file.originalname,
      state: "Conectando aos peers...",
      progressPercent: 0,
      speed: "0 MB/s",
    };

    console.log(
      `[ManaBridge] 📁 Arquivo .torrent recebido: ${req.file.originalname}`
    );

    try {
      // WebTorrent aceita Buffer diretamente
      processTorrent(req.file.buffer, id, "torrent file");
      res.json({ success: true, id });
    } catch (err) {
      console.error("[ManaBridge] Erro ao processar .torrent:", err);
      activeDownloads[id].state = `❌ Erro: ${err.message}`;
      res.status(500).json({ error: err.message });
    }
  }
);

export default router;
