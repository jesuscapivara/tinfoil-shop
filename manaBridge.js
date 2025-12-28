import express from "express";
import WebTorrent from "webtorrent";
import { Dropbox } from "dropbox";
import fetch from "isomorphic-fetch";
import dotenv from "dotenv";
import multer from "multer";
import { loginTemplate, dashboardTemplate } from "./templates.js";

dotenv.config();

// Configuração do Multer
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
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
const IS_PRODUCTION = !!process.env.DOMINIO;

// Log inicial de config
console.log("═══════════════════════════════════════════════");
console.log("🎮 MANA BRIDGE - Inicialização");
console.log("═══════════════════════════════════════════════");
console.log(`   Ambiente: ${IS_PRODUCTION ? "PRODUÇÃO" : "LOCAL"}`);
console.log(`   Admin Email: ${ADMIN_EMAIL ? "✓" : "✗ FALTANDO"}`);
console.log(`   Admin Pass: ${ADMIN_PASS ? "✓" : "✗ FALTANDO"}`);
console.log(`   Dropbox Key: ${process.env.DROPBOX_APP_KEY ? "✓" : "✗"}`);
console.log("═══════════════════════════════════════════════");

const dbx = new Dropbox({
  clientId: process.env.DROPBOX_APP_KEY,
  clientSecret: process.env.DROPBOX_APP_SECRET,
  refreshToken: process.env.DROPBOX_REFRESH_TOKEN,
  fetch,
});

// WebTorrent com logs
const client = new WebTorrent();
client.on("error", (err) =>
  console.error("[WebTorrent] Erro global:", err.message)
);

let activeDownloads = {};

// --- HELPERS ---
const generateToken = (email, pass) =>
  Buffer.from(`${email}:${pass}`).toString("base64");

const getCookieOptions = () => ({
  maxAge: 86400000,
  httpOnly: true,
  path: "/",
  sameSite: "lax",
  secure: IS_PRODUCTION,
});

// --- MIDDLEWARE AUTH (Simplificado) ---
const requireAuth = (req, res, next) => {
  if (!ADMIN_EMAIL || !ADMIN_PASS) {
    return res
      .status(500)
      .send("Erro: Configure ADMIN_EMAIL e ADMIN_PASS no .env");
  }

  const cookies = req.headers.cookie || "";
  const tokenMatch = cookies.match(/auth_token=([^;]+)/);
  let token = tokenMatch ? tokenMatch[1] : null;

  if (token) {
    try {
      token = decodeURIComponent(token);
    } catch (e) {}
  }

  const validToken = generateToken(ADMIN_EMAIL, ADMIN_PASS);

  if (token === validToken) {
    next();
  } else {
    res.redirect("/admin/login");
  }
};

// --- ROTAS DE AUTENTICAÇÃO ---
router.get("/admin/login", (req, res) => {
  const cookies = req.headers.cookie || "";
  const token = cookies.match(/auth_token=([^;]+)/)?.[1];
  if (token === generateToken(ADMIN_EMAIL, ADMIN_PASS)) {
    return res.redirect("/admin");
  }
  res.send(loginTemplate());
});

router.post("/bridge/auth", (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: "Email e senha são obrigatórios" });
  }

  if (email === ADMIN_EMAIL && password === ADMIN_PASS) {
    res.cookie(
      "auth_token",
      generateToken(email, password),
      getCookieOptions()
    );
    res.json({ success: true, redirect: "/admin" });
  } else {
    res.status(401).json({ error: "Credenciais inválidas" });
  }
});

router.get("/admin/logout", (req, res) => {
  res.clearCookie("auth_token", { path: "/" });
  res.redirect("/admin/login");
});

router.get("/admin", requireAuth, (req, res) => {
  res.send(dashboardTemplate());
});

router.get("/bridge/status", requireAuth, (req, res) => {
  res.json(
    Object.values(activeDownloads).map((d) => ({
      id: d.id,
      name: d.name,
      status: d.state,
      percent: d.progressPercent,
      speed: d.speed,
    }))
  );
});

// ═══════════════════════════════════════════════
// LÓGICA DE TORRENT (COM DEBUG COMPLETO)
// ═══════════════════════════════════════════════

function log(msg, type = "INFO") {
  const timestamp = new Date().toISOString().substr(11, 8);
  console.log(`[${timestamp}] [${type}] ${msg}`);
}

function extractGameName(fileName) {
  let name = fileName
    .replace(/\.(nsp|nsz|xci)$/i, "")
    .replace(/\s*\[[^\]]+\]/g, "")
    .replace(/\s*\([^)]+\)/g, "")
    .trim();

  if (!name) {
    name = fileName.replace(/\.(nsp|nsz|xci)$/i, "").trim();
  }

  return name.replace(/[<>:"/\\|?*]/g, "_") || "Unknown_Game";
}

function processTorrent(torrentInput, id, inputType = "magnet") {
  log(`═══════════════════════════════════════════════`, "TORRENT");
  log(`🚀 NOVO TORRENT INICIADO`, "TORRENT");
  log(`   ID: ${id}`, "TORRENT");
  log(`   Tipo: ${inputType}`, "TORRENT");
  log(`═══════════════════════════════════════════════`, "TORRENT");

  // Handler de erro do client.add
  try {
    client.add(torrentInput, { path: "/tmp" }, (torrent) => {
      log(`✅ TORRENT CONECTADO`, "TORRENT");
      log(`   Nome: ${torrent.name}`, "TORRENT");
      log(`   InfoHash: ${torrent.infoHash}`, "TORRENT");
      log(`   Total de arquivos: ${torrent.files.length}`, "TORRENT");
      log(
        `   Tamanho total: ${(torrent.length / 1024 / 1024 / 1024).toFixed(
          2
        )} GB`,
        "TORRENT"
      );
      log(`   Peers conectados: ${torrent.numPeers}`, "TORRENT");

      activeDownloads[id].name = torrent.name;
      activeDownloads[id].state = "📥 Conectado, iniciando download...";

      // Lista TODOS os arquivos
      log(`📁 LISTA COMPLETA DE ARQUIVOS:`, "TORRENT");
      torrent.files.forEach((f, i) => {
        const sizeMB = (f.length / 1024 / 1024).toFixed(2);
        const isGame = f.name.match(/\.(nsp|nsz|xci)$/i) ? "🎮" : "📄";
        log(`   ${i + 1}. ${isGame} ${f.name} (${sizeMB} MB)`, "TORRENT");
      });

      // Filtra arquivos de jogo
      const gameFiles = torrent.files.filter((f) =>
        f.name.match(/\.(nsp|nsz|xci)$/i)
      );
      log(`🎮 Arquivos de jogo encontrados: ${gameFiles.length}`, "TORRENT");

      if (gameFiles.length === 0) {
        log(`❌ ERRO: Nenhum arquivo .nsp/.nsz/.xci encontrado!`, "ERROR");
        activeDownloads[id].state =
          "❌ Nenhum jogo Switch encontrado no torrent";
        torrent.destroy();
        return;
      }

      const mainFile = gameFiles.reduce((a, b) =>
        a.length > b.length ? a : b
      );
      const gameFolderName = extractGameName(mainFile.name);

      log(
        `📂 Pasta destino: ${ROOT_GAMES_FOLDER}/${gameFolderName}/`,
        "TORRENT"
      );
      activeDownloads[id].name = gameFolderName;

      // Progresso do download
      let lastLoggedProgress = 0;
      torrent.on("download", () => {
        const progress = Math.floor(torrent.progress * 100);
        activeDownloads[id].progressPercent = progress.toFixed(1);
        activeDownloads[id].speed =
          (torrent.downloadSpeed / 1024 / 1024).toFixed(1) + " MB/s";
        activeDownloads[id].state = `📥 Baixando... ${progress}%`;

        // Log a cada 10%
        if (progress >= lastLoggedProgress + 10) {
          lastLoggedProgress = progress;
          log(
            `📥 Download: ${progress}% | Velocidade: ${activeDownloads[id].speed} | Peers: ${torrent.numPeers}`,
            "TORRENT"
          );
        }
      });

      // Novos peers
      torrent.on("wire", () => {
        log(`🔗 Novo peer conectado. Total: ${torrent.numPeers}`, "TORRENT");
      });

      // DOWNLOAD COMPLETO
      torrent.on("done", async () => {
        log(`═══════════════════════════════════════════════`, "TORRENT");
        log(`✅ DOWNLOAD 100% COMPLETO!`, "TORRENT");
        log(`   Torrent: ${torrent.name}`, "TORRENT");
        log(`   Arquivos de jogo: ${gameFiles.length}`, "TORRENT");
        log(`═══════════════════════════════════════════════`, "TORRENT");

        activeDownloads[id].state = "📤 Preparando upload para Dropbox...";
        activeDownloads[id].progressPercent = 0;

        try {
          for (let i = 0; i < gameFiles.length; i++) {
            const file = gameFiles[i];
            const destPath = `${ROOT_GAMES_FOLDER}/${gameFolderName}/${file.name}`;

            log(
              `📤 UPLOAD ${i + 1}/${gameFiles.length}: ${file.name}`,
              "UPLOAD"
            );
            log(`   Destino: ${destPath}`, "UPLOAD");
            log(
              `   Tamanho: ${(file.length / 1024 / 1024 / 1024).toFixed(2)} GB`,
              "UPLOAD"
            );

            activeDownloads[id].state = `📤 Enviando ${i + 1}/${
              gameFiles.length
            }: ${file.name.substring(0, 30)}...`;

            await uploadFileToDropbox(file, destPath, id, gameFiles.length, i);

            log(`✅ Upload ${i + 1}/${gameFiles.length} concluído!`, "UPLOAD");
          }

          log(`═══════════════════════════════════════════════`, "SUCCESS");
          log(`🎉 TODOS OS UPLOADS CONCLUÍDOS!`, "SUCCESS");
          log(`   Pasta: ${gameFolderName}`, "SUCCESS");
          log(`   Arquivos: ${gameFiles.length}`, "SUCCESS");
          log(`═══════════════════════════════════════════════`, "SUCCESS");

          activeDownloads[id].state = "✅ Sucesso! Disponível no Tinfoil.";
          activeDownloads[id].progressPercent = 100;

          setTimeout(() => delete activeDownloads[id], 120000);
        } catch (err) {
          log(`═══════════════════════════════════════════════`, "ERROR");
          log(`❌ ERRO NO UPLOAD!`, "ERROR");
          log(`   Mensagem: ${err.message}`, "ERROR");
          log(`   Stack: ${err.stack}`, "ERROR");
          log(`═══════════════════════════════════════════════`, "ERROR");

          activeDownloads[id].state = `❌ Erro: ${err.message}`;
        } finally {
          torrent.destroy();
          log(`🗑️ Torrent destruído e recursos liberados`, "TORRENT");
        }
      });

      torrent.on("error", (err) => {
        log(`❌ ERRO NO TORRENT: ${err.message}`, "ERROR");
        activeDownloads[id].state = `❌ Erro: ${err.message}`;
      });

      torrent.on("warning", (warn) => {
        log(`⚠️ Warning: ${warn}`, "WARN");
      });
    });
  } catch (err) {
    log(`❌ ERRO ao adicionar torrent: ${err.message}`, "ERROR");
    activeDownloads[id].state = `❌ Erro: ${err.message}`;
  }

  // Timeout de 5 minutos
  setTimeout(() => {
    if (activeDownloads[id]?.state === "Conectando aos peers...") {
      log(`⏰ TIMEOUT: Nenhum peer encontrado após 5 minutos`, "ERROR");
      activeDownloads[id].state = "❌ Timeout: Nenhum peer encontrado";
    }
  }, 300000);
}

async function uploadFileToDropbox(
  file,
  destPath,
  downloadId,
  totalFiles,
  currentIndex
) {
  return new Promise((resolve, reject) => {
    log(`📥 Lendo arquivo do disco...`, "UPLOAD");

    const chunks = [];
    const stream = file.createReadStream();

    stream.on("data", (chunk) => {
      chunks.push(chunk);
    });

    stream.on("error", (err) => {
      log(`❌ Erro ao ler stream: ${err.message}`, "ERROR");
      reject(err);
    });

    stream.on("end", async () => {
      const buffer = Buffer.concat(chunks);
      const fileSizeMB = buffer.length / 1024 / 1024;

      log(`📦 Buffer criado: ${fileSizeMB.toFixed(2)} MB`, "UPLOAD");

      try {
        if (fileSizeMB > 150) {
          log(`📤 Usando upload em SESSÃO (arquivo > 150MB)`, "UPLOAD");
          await uploadLargeBuffer(buffer, destPath, downloadId);
        } else {
          log(`📤 Usando upload DIRETO (arquivo < 150MB)`, "UPLOAD");

          const result = await dbx.filesUpload({
            path: destPath,
            contents: buffer,
            mode: { ".tag": "add" },
            autorename: true,
            mute: true,
          });

          log(`✅ Dropbox confirmou: ${result.result.path_display}`, "UPLOAD");
        }

        const overallProgress = (
          ((currentIndex + 1) / totalFiles) *
          100
        ).toFixed(1);
        activeDownloads[downloadId].progressPercent = overallProgress;

        resolve();
      } catch (err) {
        log(`❌ Dropbox rejeitou upload!`, "ERROR");
        log(`   Path: ${destPath}`, "ERROR");
        log(`   Erro: ${err.message}`, "ERROR");

        if (err.error) {
          log(`   Detalhes: ${JSON.stringify(err.error)}`, "ERROR");
        }

        reject(err);
      }
    });
  });
}

async function uploadLargeBuffer(buffer, destPath, downloadId) {
  const CHUNK_SIZE = 8 * 1024 * 1024;
  const totalSize = buffer.length;
  let offset = 0;

  log(
    `📤 Upload em sessão: ${(totalSize / 1024 / 1024).toFixed(
      2
    )} MB em chunks de 8MB`,
    "UPLOAD"
  );

  // Primeiro chunk
  const firstChunk = buffer.slice(0, Math.min(CHUNK_SIZE, totalSize));
  log(`   Iniciando sessão com primeiro chunk...`, "UPLOAD");

  const startResult = await dbx.filesUploadSessionStart({
    close: false,
    contents: firstChunk,
  });

  const sessionId = startResult.result.session_id;
  offset = firstChunk.length;
  log(`   Sessão criada: ${sessionId.substring(0, 15)}...`, "UPLOAD");

  // Chunks intermediários
  let chunkNum = 1;
  while (offset < totalSize - CHUNK_SIZE) {
    chunkNum++;
    const chunk = buffer.slice(offset, offset + CHUNK_SIZE);

    await dbx.filesUploadSessionAppendV2({
      cursor: { session_id: sessionId, offset: offset },
      close: false,
      contents: chunk,
    });

    offset += chunk.length;
    const progress = ((offset / totalSize) * 100).toFixed(0);
    activeDownloads[downloadId].state = `📤 Enviando... ${progress}%`;

    log(`   Chunk ${chunkNum}: ${progress}% enviado`, "UPLOAD");
  }

  // Último chunk
  const lastChunk = buffer.slice(offset);
  log(`   Finalizando sessão com último chunk...`, "UPLOAD");

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

  log(`✅ Sessão finalizada com sucesso!`, "UPLOAD");
}

// --- ROTAS DE UPLOAD ---
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

  log(`📨 Magnet recebido: ${magnet.substring(0, 60)}...`, "API");
  processTorrent(magnet, id, "magnet");
  res.json({ success: true, id });
});

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

    log(
      `📨 Arquivo .torrent recebido: ${req.file.originalname} (${req.file.size} bytes)`,
      "API"
    );
    processTorrent(req.file.buffer, id, "torrent-file");
    res.json({ success: true, id });
  }
);

export default router;
