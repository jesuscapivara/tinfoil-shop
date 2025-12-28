import express from "express";
import WebTorrent from "webtorrent";
import { Dropbox } from "dropbox";
import fetch from "isomorphic-fetch";
import dotenv from "dotenv";
import multer from "multer";
import { loginTemplate, dashboardTemplate } from "./templates.js";
import { saveDownloadHistory, getDownloadHistory } from "./database.js";

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
let completedDownloads = []; // Histórico de downloads finalizados (carregado do MongoDB)
let downloadQueue = []; // 🚦 FILA DE DOWNLOADS
let isProcessingQueue = false; // Flag para evitar processamento duplo

const MAX_COMPLETED = 50; // Mantém últimos 50 finalizados
const MAX_CONCURRENT_DOWNLOADS = 1; // ⚠️ LIMITE: Apenas 1 download por vez (protege RAM)

// Carrega histórico do MongoDB na inicialização
(async () => {
  try {
    const history = await getDownloadHistory(MAX_COMPLETED);
    if (history.length > 0) {
      completedDownloads = history.map((h) => ({
        id: h._id?.toString() || h.id,
        name: h.name,
        files: h.files,
        size: h.size,
        folder: h.folder,
        completedAt: h.completedAt,
        duration: h.duration,
      }));
      console.log(
        `[DB] 📥 Histórico carregado: ${completedDownloads.length} downloads`
      );
    }
  } catch (err) {
    console.log("[DB] ⚠️ Não foi possível carregar histórico do MongoDB");
  }
})();

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
  const active = Object.values(activeDownloads).map((d) => ({
    id: d.id,
    name: d.name || "Conectando...",
    phase: d.phase || "waiting",
    // Download info
    download: {
      percent: parseFloat(d.downloadPercent) || 0,
      speed: d.downloadSpeed || "-- MB/s",
      downloaded: d.downloaded || "0 MB",
      total: d.total || "-- MB",
      peers: d.peers || 0,
      eta: d.downloadEta || "--:--",
      done: d.downloadDone || false,
    },
    // Upload info
    upload: {
      percent: parseFloat(d.uploadPercent) || 0,
      speed: d.uploadSpeed || "-- MB/s",
      uploaded: d.uploadedBytes || "0 MB",
      total: d.uploadTotal || "-- MB",
      currentFile: d.currentFile || "",
      currentFileProgress: d.currentFileProgress || 0,
      fileIndex: d.fileIndex || 0,
      totalFiles: d.totalFiles || 0,
      status: d.uploadStatus || "",
      done: d.uploadDone || false,
    },
    error: d.error || null,
    startedAt: d.startedAt,
  }));

  // Formata a fila
  const queue = downloadQueue.map((q, index) => ({
    id: q.id,
    name: q.name,
    position: index + 1,
    source: q.source,
    addedAt: q.addedAt,
  }));

  res.json({
    active,
    queue,
    completed: completedDownloads,
  });
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

      // Calcula tamanho total dos jogos
      const totalGameSize = gameFiles.reduce((acc, f) => acc + f.length, 0);
      const totalSizeStr =
        totalGameSize > 1024 * 1024 * 1024
          ? (totalGameSize / 1024 / 1024 / 1024).toFixed(2) + " GB"
          : (totalGameSize / 1024 / 1024).toFixed(2) + " MB";

      activeDownloads[id].name = torrent.name;
      activeDownloads[id].phase = "downloading";
      activeDownloads[id].total = totalSizeStr;
      activeDownloads[id].uploadTotal = totalSizeStr;
      activeDownloads[id].peers = torrent.numPeers;
      activeDownloads[id].totalFiles = gameFiles.length;

      if (gameFiles.length === 0) {
        log(`❌ ERRO: Nenhum arquivo .nsp/.nsz/.xci encontrado!`, "ERROR");
        activeDownloads[id].phase = "error";
        activeDownloads[id].error = "Nenhum jogo Switch encontrado no torrent";
        torrent.destroy();
        // Processa próximo da fila após erro
        setTimeout(() => onDownloadComplete(id), 5000);
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
        const downloaded = torrent.downloaded;
        const downloadSpeed = torrent.downloadSpeed;
        const uploadSpeed = torrent.uploadSpeed;
        const uploaded = torrent.uploaded;
        const timeRemaining = torrent.timeRemaining;

        // Formata valores
        const formatBytes = (bytes) => {
          if (bytes > 1024 * 1024 * 1024)
            return (bytes / 1024 / 1024 / 1024).toFixed(2) + " GB";
          return (bytes / 1024 / 1024).toFixed(2) + " MB";
        };

        const formatTime = (ms) => {
          if (!ms || ms === Infinity) return "--:--";
          const seconds = Math.floor(ms / 1000);
          const mins = Math.floor(seconds / 60);
          const secs = seconds % 60;
          if (mins > 60) {
            const hours = Math.floor(mins / 60);
            return `${hours}h ${mins % 60}m`;
          }
          return `${mins}:${secs.toString().padStart(2, "0")}`;
        };

        activeDownloads[id].downloadPercent = progress.toFixed(1);
        activeDownloads[id].downloadSpeed =
          (downloadSpeed / 1024 / 1024).toFixed(1) + " MB/s";
        activeDownloads[id].downloaded = formatBytes(downloaded);
        activeDownloads[id].peers = torrent.numPeers;
        activeDownloads[id].downloadEta = formatTime(timeRemaining);
        activeDownloads[id].phase = "downloading";

        // Log a cada 10%
        if (progress >= lastLoggedProgress + 10) {
          lastLoggedProgress = progress;
          log(
            `📥 Download: ${progress}% | ${activeDownloads[id].downloadSpeed} | Peers: ${torrent.numPeers} | ETA: ${activeDownloads[id].downloadEta}`,
            "TORRENT"
          );
        }
      });

      // Atualiza peers
      torrent.on("wire", () => {
        activeDownloads[id].peers = torrent.numPeers;
      });

      // DOWNLOAD COMPLETO
      torrent.on("done", async () => {
        log(`═══════════════════════════════════════════════`, "TORRENT");
        log(`✅ DOWNLOAD 100% COMPLETO!`, "TORRENT");
        log(`   Torrent: ${torrent.name}`, "TORRENT");
        log(`   Arquivos de jogo: ${gameFiles.length}`, "TORRENT");
        log(`═══════════════════════════════════════════════`, "TORRENT");

        // Marca download como concluído
        activeDownloads[id].downloadPercent = 100;
        activeDownloads[id].downloadDone = true;
        activeDownloads[id].downloadEta = "Concluído";
        activeDownloads[id].phase = "uploading";
        activeDownloads[id].uploadSpeed = "-- MB/s";

        let totalUploaded = 0;
        const totalUploadSize = gameFiles.reduce((acc, f) => acc + f.length, 0);

        try {
          for (let i = 0; i < gameFiles.length; i++) {
            const file = gameFiles[i];
            const destPath = `${ROOT_GAMES_FOLDER}/${gameFolderName}/${file.name}`;
            const fileSizeStr =
              file.length > 1024 * 1024 * 1024
                ? (file.length / 1024 / 1024 / 1024).toFixed(2) + " GB"
                : (file.length / 1024 / 1024).toFixed(2) + " MB";

            log(
              `📤 UPLOAD ${i + 1}/${gameFiles.length}: ${file.name}`,
              "UPLOAD"
            );
            log(`   Destino: ${destPath}`, "UPLOAD");
            log(`   Tamanho: ${fileSizeStr}`, "UPLOAD");

            activeDownloads[id].currentFile = file.name;
            activeDownloads[id].fileIndex = i + 1;

            await uploadFileToDropbox(file, destPath, id, gameFiles.length, i);

            totalUploaded += file.length;
            const uploadProgress = Math.floor(
              (totalUploaded / totalUploadSize) * 100
            );
            activeDownloads[id].uploadPercent = uploadProgress;
            activeDownloads[id].uploadedBytes =
              totalUploaded > 1024 * 1024 * 1024
                ? (totalUploaded / 1024 / 1024 / 1024).toFixed(2) + " GB"
                : (totalUploaded / 1024 / 1024).toFixed(2) + " MB";

            log(`✅ Upload ${i + 1}/${gameFiles.length} concluído!`, "UPLOAD");
          }

          log(`═══════════════════════════════════════════════`, "SUCCESS");
          log(`🎉 TODOS OS UPLOADS CONCLUÍDOS!`, "SUCCESS");
          log(`   Pasta: ${gameFolderName}`, "SUCCESS");
          log(`   Arquivos: ${gameFiles.length}`, "SUCCESS");
          log(`═══════════════════════════════════════════════`, "SUCCESS");

          // Marca como concluído
          activeDownloads[id].uploadPercent = 100;
          activeDownloads[id].uploadDone = true;
          activeDownloads[id].phase = "done";

          // Adiciona ao histórico de finalizados
          const completedEntry = {
            id,
            name: gameFolderName,
            files: gameFiles.length,
            size: activeDownloads[id].total,
            folder: `${ROOT_GAMES_FOLDER}/${gameFolderName}`,
            completedAt: new Date().toISOString(),
            duration: Math.floor(
              (Date.now() - new Date(activeDownloads[id].startedAt).getTime()) /
                1000
            ),
            source: activeDownloads[id].source || "magnet",
          };

          // Salva no MongoDB
          saveDownloadHistory(completedEntry).catch(() => {});

          // Adiciona na memória
          completedDownloads.unshift(completedEntry);
          if (completedDownloads.length > MAX_COMPLETED) {
            completedDownloads.pop();
          }

          // Remove do ativo após 10 segundos e processa próximo da fila
          setTimeout(() => {
            delete activeDownloads[id];
            onDownloadComplete(id);
          }, 10000);
        } catch (err) {
          log(`═══════════════════════════════════════════════`, "ERROR");
          log(`❌ ERRO NO UPLOAD!`, "ERROR");
          log(`   Mensagem: ${err.message}`, "ERROR");
          log(`   Stack: ${err.stack}`, "ERROR");
          log(`═══════════════════════════════════════════════`, "ERROR");

          activeDownloads[id].error = err.message;
          activeDownloads[id].phase = "error";
          // Processa próximo da fila após erro
          setTimeout(() => onDownloadComplete(id), 5000);
        } finally {
          torrent.destroy();
          log(`🗑️ Torrent destruído e recursos liberados`, "TORRENT");
        }
      });

      torrent.on("error", (err) => {
        log(`❌ ERRO NO TORRENT: ${err.message}`, "ERROR");
        activeDownloads[id].error = err.message;
        activeDownloads[id].phase = "error";
        // Processa próximo da fila após erro
        setTimeout(() => onDownloadComplete(id), 5000);
      });

      torrent.on("warning", (warn) => {
        log(`⚠️ Warning: ${warn}`, "WARN");
      });
    });
  } catch (err) {
    log(`❌ ERRO ao adicionar torrent: ${err.message}`, "ERROR");
    activeDownloads[id].error = err.message;
    activeDownloads[id].phase = "error";
    // Processa próximo da fila após erro
    setTimeout(() => onDownloadComplete(id), 5000);
  }

  // Timeout de 5 minutos
  setTimeout(() => {
    if (activeDownloads[id]?.phase === "connecting") {
      log(`⏰ TIMEOUT: Nenhum peer encontrado após 5 minutos`, "ERROR");
      activeDownloads[id].error = "Timeout: Nenhum peer encontrado";
      activeDownloads[id].phase = "error";
      // Processa próximo da fila após timeout
      setTimeout(() => onDownloadComplete(id), 5000);
    }
  }, 300000);
}

// ═══════════════════════════════════════════════
// SMART STREAM UPLOAD (Buffer de 20MB)
// ═══════════════════════════════════════════════
// Usa buffering inteligente para não estourar a RAM
// Pausa o stream, envia o chunk, e resume
// ✅ 20MB é bom equilíbrio entre velocidade e uso de RAM

const SMART_CHUNK_SIZE = 50 * 1024 * 1024; // 50MB por chunk (otimizado após testes)

async function uploadFileToDropbox(
  file,
  destPath,
  downloadId,
  totalFiles,
  currentIndex
) {
  const fileSize = file.length;
  const fileSizeMB = fileSize / 1024 / 1024;

  log(`🚀 Smart Stream iniciando: ${fileSizeMB.toFixed(2)} MB`, "UPLOAD");

  // Arquivos pequenos (< 10MB): upload direto sem sessão
  if (fileSize < SMART_CHUNK_SIZE) {
    return uploadSmallFile(
      file,
      destPath,
      downloadId,
      totalFiles,
      currentIndex
    );
  }

  // Arquivos grandes: Smart Stream com sessão
  return uploadWithSmartStream(
    file,
    destPath,
    downloadId,
    totalFiles,
    currentIndex
  );
}

// Upload direto para arquivos pequenos
async function uploadSmallFile(
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
    stream.on("error", (err) => reject(err));

    stream.on("end", async () => {
      try {
        const buffer = Buffer.concat(chunks);
        log(
          `📤 Upload direto: ${(buffer.length / 1024 / 1024).toFixed(2)} MB`,
          "UPLOAD"
        );

        const result = await dbx.filesUpload({
          path: destPath,
          contents: buffer,
          mode: { ".tag": "add" },
          autorename: true,
          mute: true,
        });

        log(`✅ Dropbox confirmou: ${result.result.path_display}`, "UPLOAD");
        resolve();
      } catch (err) {
        log(`❌ Upload falhou: ${err.message}`, "ERROR");
        reject(err);
      }
    });
  });
}

// Smart Stream para arquivos grandes (> 10MB)
async function uploadWithSmartStream(
  file,
  destPath,
  downloadId,
  totalFiles,
  currentIndex
) {
  return new Promise((resolve, reject) => {
    const fileSize = file.length;
    const fileName = file.name;
    let sessionId = null;
    let offset = 0;
    let buffer = Buffer.alloc(0);
    let chunkNum = 0;
    let lastChunkTime = Date.now();
    let totalChunks = Math.ceil(fileSize / SMART_CHUNK_SIZE);

    const stream = file.createReadStream();

    // Atualiza status inicial
    activeDownloads[downloadId].currentFile = fileName;
    activeDownloads[downloadId].fileIndex = currentIndex + 1;
    activeDownloads[downloadId].uploadStatus = `Preparando upload...`;

    log(
      `📤 Smart Stream: ${(fileSize / 1024 / 1024).toFixed(
        2
      )} MB em ~${totalChunks} chunks de 20MB`,
      "UPLOAD"
    );

    stream.on("data", async (chunk) => {
      // Acumula no buffer
      buffer = Buffer.concat([buffer, chunk]);

      // Se o buffer encheu (5MB), hora de enviar!
      if (buffer.length >= SMART_CHUNK_SIZE) {
        // PAUSA o stream para não estourar a memória
        stream.pause();

        try {
          const chunkToSend = buffer.slice(0, SMART_CHUNK_SIZE);
          const remaining = buffer.slice(SMART_CHUNK_SIZE);
          chunkNum++;

          // Calcula velocidade
          const now = Date.now();
          const elapsed = (now - lastChunkTime) / 1000;
          const speed =
            elapsed > 0 ? SMART_CHUNK_SIZE / 1024 / 1024 / elapsed : 0;
          lastChunkTime = now;

          if (offset === 0) {
            // Primeiro chunk: inicia sessão
            activeDownloads[
              downloadId
            ].uploadStatus = `Conectando ao Dropbox...`;
            log(`   🔗 Iniciando sessão Dropbox...`, "UPLOAD");
            const res = await dbx.filesUploadSessionStart({
              close: false,
              contents: chunkToSend,
            });
            sessionId = res.result.session_id;
            log(
              `   ✓ Sessão criada: ${sessionId.substring(0, 12)}...`,
              "UPLOAD"
            );
          } else {
            // Chunks intermediários
            await dbx.filesUploadSessionAppendV2({
              cursor: { session_id: sessionId, offset: offset },
              close: false,
              contents: chunkToSend,
            });
          }

          offset += chunkToSend.length;
          buffer = remaining;

          // Atualiza progresso visual para o frontend
          const filePercent = ((offset / fileSize) * 100).toFixed(1);
          const uploadedMB = (offset / 1024 / 1024).toFixed(1);
          const totalMB = (fileSize / 1024 / 1024).toFixed(1);

          activeDownloads[downloadId].uploadSpeed =
            speed > 0 ? `${speed.toFixed(1)} MB/s` : "-- MB/s";
          activeDownloads[
            downloadId
          ].uploadStatus = `Enviando chunk ${chunkNum}/${totalChunks}`;
          activeDownloads[downloadId].currentFileProgress =
            parseFloat(filePercent);
          activeDownloads[downloadId].uploadedBytes = `${uploadedMB} MB`;
          activeDownloads[downloadId].uploadTotal = `${totalMB} MB`;

          log(
            `   📦 Chunk ${chunkNum}/${totalChunks}: ${filePercent}% (${uploadedMB}/${totalMB} MB) @ ${speed.toFixed(
              1
            )} MB/s`,
            "UPLOAD"
          );

          // RETOMA o stream
          stream.resume();
        } catch (err) {
          stream.destroy();
          log(`❌ Erro no chunk ${chunkNum}: ${err.message}`, "ERROR");
          reject(err);
        }
      }
    });

    stream.on("end", async () => {
      // Envia o que sobrou no buffer (último chunk)
      try {
        if (buffer.length > 0 || offset === 0) {
          if (offset === 0) {
            // Arquivo pequeno que não encheu nenhum chunk
            log(`   📤 Upload único (arquivo não encheu chunk)`, "UPLOAD");
            const res = await dbx.filesUploadSessionStart({
              close: false,
              contents: buffer,
            });
            sessionId = res.result.session_id;
            offset = buffer.length;
          }

          // Finaliza a sessão
          log(
            `   🏁 Finalizando sessão (${(buffer.length / 1024 / 1024).toFixed(
              2
            )} MB restantes)...`,
            "UPLOAD"
          );

          await dbx.filesUploadSessionFinish({
            cursor: { session_id: sessionId, offset: offset },
            commit: {
              path: destPath,
              mode: { ".tag": "add" },
              autorename: true,
              mute: true,
            },
            contents: buffer,
          });
        } else if (sessionId) {
          // Buffer vazio, só finaliza
          await dbx.filesUploadSessionFinish({
            cursor: { session_id: sessionId, offset: offset },
            commit: {
              path: destPath,
              mode: { ".tag": "add" },
              autorename: true,
              mute: true,
            },
            contents: Buffer.alloc(0),
          });
        }

        log(`✅ Smart Stream concluído: ${destPath}`, "UPLOAD");
        resolve();
      } catch (err) {
        log(`❌ Erro ao finalizar: ${err.message}`, "ERROR");
        reject(err);
      }
    });

    stream.on("error", (err) => {
      log(`❌ Stream error: ${err.message}`, "ERROR");
      reject(err);
    });
  });
}

// --- HELPER: Conta downloads ativos ---
function countActiveDownloads() {
  return Object.values(activeDownloads).filter(
    (d) => d.phase !== "done" && d.phase !== "error"
  ).length;
}

// ═══════════════════════════════════════════════
// SISTEMA DE FILA DE DOWNLOADS
// ═══════════════════════════════════════════════

function addToQueue(queueItem) {
  downloadQueue.push(queueItem);
  log(
    `📋 Adicionado à fila: ${queueItem.name} (Posição: ${downloadQueue.length})`,
    "QUEUE"
  );

  // Tenta processar a fila
  processQueue();
}

function processQueue() {
  // Se já está processando ou tem download ativo, não faz nada
  if (isProcessingQueue) return;
  if (countActiveDownloads() >= MAX_CONCURRENT_DOWNLOADS) return;
  if (downloadQueue.length === 0) return;

  isProcessingQueue = true;

  // Pega o próximo da fila
  const next = downloadQueue.shift();
  log(`🚀 Iniciando da fila: ${next.name}`, "QUEUE");

  // Cria o registro de download ativo
  activeDownloads[next.id] = {
    id: next.id,
    name: next.name,
    phase: "connecting",
    startedAt: new Date().toISOString(),
    source: next.source,
    // Download
    downloadPercent: 0,
    downloadSpeed: "-- MB/s",
    downloaded: "0 MB",
    total: "-- MB",
    peers: 0,
    downloadEta: "--:--",
    downloadDone: false,
    // Upload
    uploadPercent: 0,
    uploadSpeed: "-- MB/s",
    uploadedBytes: "0 MB",
    uploadTotal: "-- MB",
    currentFile: "",
    fileIndex: 0,
    totalFiles: 0,
    uploadDone: false,
    // Error
    error: null,
  };

  // Inicia o processamento do torrent
  processTorrent(next.input, next.id, next.source);

  isProcessingQueue = false;
}

// Chamado quando um download termina (sucesso ou erro)
function onDownloadComplete(id) {
  log(`✅ Download ${id} finalizado. Verificando fila...`, "QUEUE");

  // Pequeno delay para garantir que tudo foi limpo
  setTimeout(() => {
    if (downloadQueue.length > 0) {
      log(
        `📋 Fila tem ${downloadQueue.length} item(s). Processando próximo...`,
        "QUEUE"
      );
      processQueue();
    } else {
      log(`📋 Fila vazia. Aguardando novos downloads.`, "QUEUE");
    }
  }, 2000);
}

// --- ROTAS DE UPLOAD ---
router.post("/bridge/upload", requireAuth, async (req, res) => {
  const magnet = req.body.magnet;
  if (!magnet) return res.status(400).json({ error: "Magnet link vazio" });

  const id = Date.now().toString();

  // Extrai nome do magnet (se disponível)
  const nameMatch = magnet.match(/dn=([^&]+)/);
  const displayName = nameMatch
    ? decodeURIComponent(nameMatch[1])
    : "Magnet Link";

  log(`📨 Magnet recebido: ${magnet.substring(0, 60)}...`, "API");

  // Cria item da fila
  const queueItem = {
    id,
    name: displayName,
    input: magnet,
    source: "magnet",
    addedAt: new Date().toISOString(),
  };

  // Se não tem downloads ativos, inicia direto
  if (countActiveDownloads() < MAX_CONCURRENT_DOWNLOADS) {
    addToQueue(queueItem);
    res.json({
      success: true,
      id,
      queued: false,
      message: "Download iniciado!",
    });
  } else {
    // Adiciona na fila para processar depois
    downloadQueue.push(queueItem);
    const position = downloadQueue.length;
    log(`📋 Magnet adicionado à fila (Posição: ${position})`, "QUEUE");
    res.json({
      success: true,
      id,
      queued: true,
      position,
      message: `Adicionado à fila (posição ${position})`,
    });
  }
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
    const displayName = req.file.originalname.replace(".torrent", "");

    log(
      `📨 Arquivo .torrent recebido: ${req.file.originalname} (${req.file.size} bytes)`,
      "API"
    );

    // Cria item da fila
    const queueItem = {
      id,
      name: displayName,
      input: req.file.buffer,
      source: "torrent-file",
      addedAt: new Date().toISOString(),
    };

    // Se não tem downloads ativos, inicia direto
    if (countActiveDownloads() < MAX_CONCURRENT_DOWNLOADS) {
      addToQueue(queueItem);
      res.json({
        success: true,
        id,
        queued: false,
        message: "Download iniciado!",
      });
    } else {
      // Adiciona na fila para processar depois
      downloadQueue.push(queueItem);
      const position = downloadQueue.length;
      log(`📋 Torrent adicionado à fila (Posição: ${position})`, "QUEUE");
      res.json({
        success: true,
        id,
        queued: true,
        position,
        message: `Adicionado à fila (posição ${position})`,
      });
    }
  }
);

export default router;
