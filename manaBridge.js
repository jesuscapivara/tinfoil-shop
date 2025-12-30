import express from "express";
import WebTorrent from "webtorrent";
import { Dropbox } from "dropbox";
import fetch from "isomorphic-fetch";
import dotenv from "dotenv";
import multer from "multer";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { EventEmitter } from "events";
import fs from "fs";
// Frontend antigo removido - agora o frontend é separado
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:3000";

// ✅ Sistema de Eventos: "Megafone" para comunicação entre módulos
export const bridgeEvents = new EventEmitter();
import {
  saveDownloadHistory,
  getDownloadHistory,
  addOrUpdateGame,
  checkGameExists,
} from "./database.js";
import {
  createUser,
  findUserByEmail,
  getPendingUsers,
  approveUser,
  deleteUser,
  User,
} from "./database.js";
import { sendNewUserAlert, sendApprovalEmail } from "./emailService.js";
import { parseGameInfo } from "./titleDbService.js";
import { searchGames, fetchGameTorrent } from "./telegramIndexer.js";

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
const JWT_SECRET = process.env.JWT_SECRET;

// Log inicial de config
console.log("═══════════════════════════════════════════════");
console.log("🎮 CAPIVARA BRIDGE - Inicialização");
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
let completedDownloads = [];
let downloadQueue = [];
let isProcessingQueue = false;

const MAX_COMPLETED = 50;
const MAX_CONCURRENT_DOWNLOADS = 1;

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
const generateToken = (payload) => {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "1d" });
};

const getCookieOptions = () => ({
  maxAge: 86400000,
  httpOnly: true,
  path: "/",
  sameSite: "lax",
  secure: IS_PRODUCTION,
});

// --- MIDDLEWARE AUTH (JWT Seguro) ---
export const requireAuth = async (req, res, next) => {
  if (!ADMIN_EMAIL || !ADMIN_PASS) {
    return res
      .status(500)
      .send("Erro: Configure ADMIN_EMAIL e ADMIN_PASS no .env");
  }

  if (!JWT_SECRET) {
    return res.status(500).send("Erro: Configure JWT_SECRET no .env");
  }

  let token = null;

  // 1. Tenta obter token do header Authorization (Bearer token) - para API/frontend
  const authHeader = req.headers.authorization;
  if (authHeader && /Bearer/i.test(authHeader)) {
    token = authHeader.split(" ")[1];
  }

  // 2. Fallback: tenta obter token dos cookies (para dashboard web)
  if (!token) {
    const cookies = req.headers.cookie || "";
    const tokenMatch = cookies.match(/auth_token=([^;]+)/);
    if (tokenMatch) {
      token = tokenMatch[1];
      try {
        token = decodeURIComponent(token);
      } catch (e) {
        // Ignora erro de decode
      }
    }
  }

  if (token) {
    try {
      const decoded = jwt.verify(token, JWT_SECRET);

      if (decoded.role === "admin" && decoded.email === ADMIN_EMAIL) {
        req.user = decoded;
        return next();
      }

      // Se for usuário comum
      if (decoded.role === "user" && decoded.id) {
        const user = await User.findById(decoded.id);
        if (user && user.isApproved) {
          req.user = decoded;
          return next();
        }
      }
    } catch (err) {
      // Token inválido ou expirado
      console.log("[AUTH] Token inválido:", err.message);
    }
  }

  // Se for requisição de API (JSON), retorna erro JSON
  // Se for requisição web, redireciona para o novo frontend
  if (req.headers.accept && req.headers.accept.includes("application/json")) {
    return res.status(401).json({ error: "Não autorizado" });
  }

  res.redirect(`${FRONTEND_URL}/login`);
};

// ROTA DE REGISTRO (Nova)
// --- ROTA DE REGISTRO (PÚBLICA) ---
router.post("/bridge/register", async (req, res) => {
  const { email, password } = req.body;

  // Verificações básicas
  if (!email || !password) {
    return res.status(400).json({ error: "Preencha todos os campos" });
  }
  if (password.length < 6) {
    return res
      .status(400)
      .json({ error: "Senha muito curta (mínimo 6 caracteres)" });
  }

  const existing = await findUserByEmail(email);
  if (existing) {
    return res.status(400).json({ error: "Email já cadastrado" });
  }

  // Cria usuário
  const newUser = await createUser(email, password, false);

  if (newUser) {
    // Envia e-mail para o Admin
    sendNewUserAlert(email).catch(console.error);

    res.json({
      success: true,
      message: "Cadastro realizado! Aguarde aprovação.",
    });
  } else {
    res.status(500).json({ error: "Erro ao criar usuário" });
  }
});

// --- ROTA RAIZ: REDIRECIONAMENTO PARA O NOVO FRONTEND ---
router.get("/", async (req, res) => {
  // Redireciona para o novo frontend
  res.redirect(FRONTEND_URL);
});

// --- ROTAS DE AUTENTICAÇÃO ---
// Redireciona para o novo frontend
router.get("/admin/login", async (req, res) => {
  // Redireciona para a página de login do novo frontend
  res.redirect(`${FRONTEND_URL}/login`);
});

router.get("/admin", requireAuth, (req, res) => {
  // Redireciona para o dashboard do novo frontend
  res.redirect(`${FRONTEND_URL}/dashboard`);
});

router.post("/bridge/auth", async (req, res) => {
  const { email, password } = req.body;

  // Log para debug (sem mostrar a senha)
  console.log(`[AUTH] Tentativa de login: ${email}`);
  console.log(`[AUTH] Admin Email configurado: ${ADMIN_EMAIL ? "SIM" : "NÃO"}`);
  console.log(`[AUTH] Admin Pass configurado: ${ADMIN_PASS ? "SIM" : "NÃO"}`);

  // Normaliza email (remove espaços e converte para lowercase)
  const cleanEmail = email?.trim().toLowerCase();
  const cleanPassword = password?.trim();

  // 1. Verifica se é o Admin Supremo (.env)
  if (
    cleanEmail === ADMIN_EMAIL?.toLowerCase() &&
    cleanPassword === ADMIN_PASS
  ) {
    const token = generateToken({
      email: ADMIN_EMAIL,
      role: "admin",
      id: "admin",
    });
    const cookieOptions = getCookieOptions();
    res.cookie("auth_token", token, cookieOptions);
    console.log(`[AUTH] ✅ Admin logado: ${email}`);
    return res.json({
      success: true,
      redirect: `${FRONTEND_URL}/dashboard`,
      token,
    });
  }

  // 2. Verifica se é usuário normal (MongoDB)
  const user = await findUserByEmail(email);
  if (user) {
    const validPass = await bcrypt.compare(password, user.password);
    if (validPass) {
      const token = generateToken({
        id: user._id.toString(),
        email: user.email,
        role: "user",
      });
      const cookieOptions = getCookieOptions();
      res.cookie("auth_token", token, cookieOptions);
      console.log(`[AUTH] ✅ Usuário logado: ${email}`);
      return res.json({
        success: true,
        redirect: `${FRONTEND_URL}/dashboard`,
        token,
      });
    }
  }

  console.log(`[AUTH] ❌ Login falhou para: ${email}`);
  res.status(401).json({ error: "Credenciais inválidas" });
});

// ROTA PARA OBTER DADOS DO USUÁRIO (Para o Dashboard)
// --- API: DADOS DO USUÁRIO LOGADO ---
router.get("/bridge/me", requireAuth, async (req, res) => {
  const DOMAIN = process.env.DOMINIO || "capivara.rossetti.eng.br";

  if (req.user.role === "admin") {
    return res.json({
      email: ADMIN_EMAIL,
      isAdmin: true,
      isApproved: true,
      tinfoilUser: "admin",
      tinfoilPass: "*********",
      host: `${DOMAIN}/api`,
      protocol: "https",
    });
  }

  // Se for Usuário Comum
  try {
    const user = await User.findById(req.user.id);

    if (user) {
      res.json({
        email: user.email,
        isAdmin: user.isAdmin,
        isApproved: user.isApproved,
        tinfoilUser: user.tinfoilUser,
        tinfoilPass: null,
        host: `${DOMAIN}/api`,
        protocol: "https",
      });
    } else {
      res.status(404).json({ error: "Usuário não encontrado" });
    }
  } catch (e) {
    console.error("[API] Erro ao buscar usuário:", e);
    res.status(500).json({ error: "Erro interno" });
  }
});

// NOVA ROTA: REGENERAR CREDENCIAIS TINFOIL
router.post("/bridge/regenerate-credentials", requireAuth, async (req, res) => {
  if (req.user.role === "admin") {
    return res.status(400).json({ error: "Admin deve alterar senha no .env" });
  }

  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: "Usuário não encontrado" });

    // Gera nova senha
    const newPassPlain = Math.random().toString(36).slice(-6).toUpperCase();

    // Hash
    const salt = await bcrypt.genSalt(10);
    const newPassHash = await bcrypt.hash(newPassPlain, salt);

    // Salva no banco
    user.tinfoilPass = newPassHash;
    await user.save();

    console.log(`[AUTH] 🔄 Credenciais regeneradas para: ${user.email}`);

    res.json({ success: true, newPass: newPassPlain });
  } catch (e) {
    console.error("[AUTH] Erro ao regenerar:", e);
    res.status(500).json({ error: "Erro ao regenerar credenciais" });
  }
});

// --- API ADMIN: GERENCIAR USUÁRIOS ---
router.get("/bridge/users/pending", requireAuth, async (req, res) => {
  // Verifica se quem está chamando é admin (simplificado pela auth, mas idealmente checar isAdmin)
  const list = await getPendingUsers();
  res.json(list);
});

router.post("/bridge/users/approve/:id", requireAuth, async (req, res) => {
  const user = await approveUser(req.params.id);
  if (user) {
    const newTinfoilPass = Math.random().toString(36).slice(-6).toUpperCase();
    const salt = await bcrypt.genSalt(10);
    const tinfoilPassHash = await bcrypt.hash(newTinfoilPass, salt);

    // Atualiza a senha no banco
    user.tinfoilPass = tinfoilPassHash;
    await user.save();

    // Envia email de boas vindas com credenciais (usa a senha plain gerada)
    sendApprovalEmail(user.email, user.tinfoilUser, newTinfoilPass).catch(
      console.error
    );
    res.json({ success: true });
  } else {
    res.status(404).json({ error: "Usuário não encontrado" });
  }
});

router.post("/bridge/users/reject/:id", requireAuth, async (req, res) => {
  await deleteUser(req.params.id);
  res.json({ success: true });
});

router.get("/admin/logout", (req, res) => {
  res.clearCookie("auth_token", { path: "/" });
  res.redirect(`${FRONTEND_URL}/login`);
});

router.get("/admin", requireAuth, (req, res) => {
  // Redireciona para o dashboard do novo frontend
  res.redirect(`${FRONTEND_URL}/dashboard`);
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

// ═══════════════════════════════════════════════
// HELPER: DESTROY SEGURO DE TORRENT (CORRIGIDO)
// ═══════════════════════════════════════════════

function safeDestroyTorrent(torrent) {
  if (!torrent) return;

  // Executa no próximo ciclo do processador para evitar conflito
  setTimeout(() => {
    try {
      // Verifica se o torrent já foi destruído
      if (torrent.destroyed) {
        return; // Já foi destruído, não precisa fazer nada
      }

      // Apenas tenta destruir o torrent diretamente
      // O torrent.destroy() já remove do client automaticamente, então não precisamos chamar client.remove() separadamente
      // Isso evita o erro "No torrent with id" que acontece quando tentamos remover um torrent que já foi removido
      try {
        torrent.destroy({ destroyStore: true });
      } catch (destroyErr) {
        // Ignora erro se já foi destruído ou não existe
        // Não loga erros esperados (torrent já destruído, não existe, etc)
        const errorMsg = destroyErr.message || String(destroyErr);
        if (
          !errorMsg.includes("already destroyed") &&
          !errorMsg.includes("destroyed") &&
          !errorMsg.includes("No torrent with id")
        ) {
          console.log(`[SAFE-DESTROY] Erro ao destruir torrent: ${errorMsg}`);
        }
      }
    } catch (err) {
      // Engole o erro silenciosamente para não derrubar o servidor
      // Mas só se não for o erro crítico de "No torrent with id"
      if (!err.message.includes("No torrent with id")) {
        console.log(`[SAFE-DESTROY] Erro suprimido: ${err.message}`);
      }
    }
  }, 100);
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
  log(
    `   Input: ${
      typeof torrentInput === "string"
        ? torrentInput.substring(0, 100) + "..."
        : "Buffer"
    }`,
    "TORRENT"
  );
  log(`═══════════════════════════════════════════════`, "TORRENT");

  // Handler de erro do client.add
  try {
    log(`📡 Tentando adicionar torrent ao WebTorrent...`, "TORRENT");
    log(`   Input type: ${typeof torrentInput}`, "TORRENT");
    if (typeof torrentInput === "string") {
      log(`   Magnet preview: ${torrentInput.substring(0, 80)}...`, "TORRENT");
    }

    const torrentInstance = client.add(
      torrentInput,
      { path: "/tmp" },
      async (torrent) => {
        log(`🔗 Callback do WebTorrent chamado!`, "TORRENT");
        // Armazena referência do torrent para cancelamento (tanto a instância quanto o objeto)
        activeDownloads[id].torrent = torrent;
        activeDownloads[id].torrentInstance = torrentInstance;

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

        // Atualiza fase para "checking" (verificando duplicatas)
        activeDownloads[id].phase = "checking";
        activeDownloads[id].name = torrent.name;

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

        // =================================================================
        // 🛡️ SECURITY CHECK: DETECÇÃO DE DUPLICATAS
        // =================================================================
        for (const file of gameFiles) {
          // Usa o parser que já importamos para extrair ID e Versão
          const meta = parseGameInfo(file.name);

          // Consulta o banco
          const duplicate = await checkGameExists(
            file.name,
            meta.id,
            meta.version
          );

          if (duplicate) {
            const reason =
              duplicate.type === "filename"
                ? `Arquivo já existe: ${file.name}`
                : `Jogo já cadastrado: ${meta.name} [v${meta.version}]`;

            log(`🚫 BLOQUEADO: ${reason}`, "DUPLICATE");

            // Marca erro no status para o usuário ver
            activeDownloads[id].phase = "error";
            activeDownloads[id].error = `Duplicado! ${reason}`;
            activeDownloads[id].name = file.name; // Atualiza nome para ficar claro quem falhou
            activeDownloads[id].errorTimestamp = Date.now(); // Marca quando o erro ocorreu

            // Destrói o torrent imediatamente para não baixar nada
            safeDestroyTorrent(torrent);

            // Remove da lista ativa automaticamente após 10 segundos (alinhado com countdown do frontend)
            setTimeout(() => {
              if (
                activeDownloads[id] &&
                activeDownloads[id].phase === "error"
              ) {
                log(
                  `⏰ Auto-remoção: Download ${id} removido (duplicata detectada)`,
                  "CLEANUP"
                );
                onDownloadComplete(id);
              }
            }, 10000); // 10 segundos para duplicatas (alinhado com countdown do frontend)
            return; // 🛑 PARA TUDO AQUI
          }
        }
        // =================================================================

        // Calcula tamanho total dos jogos
        const totalGameSize = gameFiles.reduce((acc, f) => acc + f.length, 0);
        const totalSizeStr =
          totalGameSize > 1024 * 1024 * 1024
            ? (totalGameSize / 1024 / 1024 / 1024).toFixed(2) + " GB"
            : (totalGameSize / 1024 / 1024).toFixed(2) + " MB";

        activeDownloads[id].name = torrent.name;
        activeDownloads[id].total = totalSizeStr;
        activeDownloads[id].uploadTotal = totalSizeStr;
        activeDownloads[id].peers = torrent.numPeers;
        activeDownloads[id].totalFiles = gameFiles.length;

        // Muda para "connecting" após verificar duplicatas (aguardando conexão com peers)
        activeDownloads[id].phase = "connecting";

        if (gameFiles.length === 0) {
          log(`❌ ERRO: Nenhum arquivo .nsp/.nsz/.xci encontrado!`, "ERROR");
          activeDownloads[id].phase = "error";
          activeDownloads[id].error =
            "Nenhum jogo Switch encontrado no torrent";
          activeDownloads[id].errorTimestamp = Date.now();
          safeDestroyTorrent(torrent);
          // Auto-remoção após 1 minuto
          setTimeout(() => {
            if (activeDownloads[id] && activeDownloads[id].phase === "error") {
              log(
                `⏰ Auto-remoção: Download ${id} removido após 1 minuto de erro`,
                "CLEANUP"
              );
              onDownloadComplete(id);
            }
          }, 60000);
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

          // Muda para "downloading" quando começar a baixar (progress > 0)
          if (progress > 0 && activeDownloads[id].phase === "connecting") {
            activeDownloads[id].phase = "downloading";
          }

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
          const totalUploadSize = gameFiles.reduce(
            (acc, f) => acc + f.length,
            0
          );

          try {
            for (let i = 0; i < gameFiles.length; i++) {
              // ⚠️ VERIFICAÇÃO: Para o loop se foi cancelado
              if (!activeDownloads[id] || activeDownloads[id].isCancelled) {
                log(
                  `⚠️ Upload cancelado pelo usuário (arquivo ${i + 1}/${
                    gameFiles.length
                  })`,
                  "CANCEL"
                );
                return;
              }

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
              activeDownloads[id].currentFileProgress = 0; // Reset progresso do arquivo atual
              activeDownloads[
                id
              ].uploadStatus = `Preparando upload de ${file.name}...`;

              // 1. Upload do Arquivo (Mantém como está)
              await uploadFileToDropbox(
                file,
                destPath,
                id,
                gameFiles.length,
                i
              );

              // ==========================================================
              // 🚀 NOVA ESTRATÉGIA: INDEXAÇÃO AUTOMÁTICA (AUTO-INDEX)
              // ==========================================================
              try {
                log(`   🔍 Auto-Indexando: ${file.name}...`, "INDEX");

                // 1. Gera Link Direto
                const directUrl = await getDirectLink(destPath);

                if (directUrl) {
                  // 2. Inteligência: Extrai ID, Versão e Nome Limpo
                  const meta = parseGameInfo(file.name);

                  // 3. Salva no Banco (Instantâneo)
                  await addOrUpdateGame({
                    url: directUrl,
                    size: file.length,
                    name: meta.name,
                    id: meta.id,
                    titleId: meta.id,
                    version: meta.version,
                    filename: file.name,
                    path: destPath.toLowerCase(), // Importante para upsert funcionar
                  });

                  // 🔥 O PULO DO GATO ESTÁ AQUI:
                  // Avisa o sistema que houve atualização!
                  bridgeEvents.emit("new_game_indexed");
                  log(`   🔔 Evento de atualização disparado!`, "EVENT");
                }
              } catch (idxErr) {
                // Não paramos o fluxo se a indexação falhar, apenas logamos
                log(
                  `   ⚠️ Falha no Auto-Index (O jogo foi upado, mas não indexado): ${idxErr.message}`,
                  "WARN"
                );
              }
              // ==========================================================

              totalUploaded += file.length;
              // Progresso total já é calculado em tempo real durante o upload
              // Aqui apenas atualizamos os bytes totais
              activeDownloads[id].uploadedBytes =
                totalUploaded > 1024 * 1024 * 1024
                  ? (totalUploaded / 1024 / 1024 / 1024).toFixed(2) + " GB"
                  : (totalUploaded / 1024 / 1024).toFixed(2) + " MB";
              activeDownloads[id].currentFileProgress = 100; // Marca arquivo como completo

              log(
                `✅ Upload ${i + 1}/${gameFiles.length} concluído!`,
                "UPLOAD"
              );
            }

            log(`═══════════════════════════════════════════════`, "SUCCESS");
            log(`🎉 TODOS OS UPLOADS CONCLUÍDOS!`, "SUCCESS");
            log(`   Pasta: ${gameFolderName}`, "SUCCESS");
            log(`   Arquivos: ${gameFiles.length}`, "SUCCESS");
            log(`   ✅ Jogos indexados automaticamente no banco`, "SUCCESS");
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
                (Date.now() -
                  new Date(activeDownloads[id].startedAt).getTime()) /
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
            // ⚠️ Ignora erro se foi cancelado manualmente
            if (activeDownloads[id]?.isCancelled) {
              log(`⚠️ Upload cancelado pelo usuário (erro ignorado)`, "CANCEL");
              return;
            }

            log(`═══════════════════════════════════════════════`, "ERROR");
            log(`❌ ERRO NO UPLOAD!`, "ERROR");
            log(`   Mensagem: ${err.message}`, "ERROR");
            log(`   Stack: ${err.stack}`, "ERROR");
            log(`═══════════════════════════════════════════════`, "ERROR");

            if (activeDownloads[id]) {
              activeDownloads[id].error = err.message;
              activeDownloads[id].phase = "error";
              activeDownloads[id].errorTimestamp = Date.now();
            }
            // Auto-remoção após 1 minuto
            setTimeout(() => {
              if (
                activeDownloads[id] &&
                activeDownloads[id].phase === "error"
              ) {
                log(
                  `⏰ Auto-remoção: Download ${id} removido após 1 minuto de erro`,
                  "CLEANUP"
                );
                onDownloadComplete(id);
              }
            }, 60000);
          } finally {
            // 🛡️ LIMPEZA DE ARQUIVOS TEMPORÁRIOS
            try {
              // Caminho da pasta temporária criada pelo WebTorrent
              // O WebTorrent salva em /tmp/{torrent.name} ou /tmp/{infoHash}
              const tempFolder = `/tmp/${torrent.name || torrent.infoHash}`;
              if (fs.existsSync(tempFolder)) {
                fs.rmSync(tempFolder, { recursive: true, force: true });
                log(`🧹 Pasta temporária limpa: ${tempFolder}`, "CLEANUP");
              }

              // Também tenta limpar pelo gameFolderName se disponível
              if (activeDownloads[id]?.name) {
                const gameFolderPath = `/tmp/${activeDownloads[id].name}`;
                if (fs.existsSync(gameFolderPath)) {
                  fs.rmSync(gameFolderPath, { recursive: true, force: true });
                  log(`🧹 Pasta de jogo limpa: ${gameFolderPath}`, "CLEANUP");
                }
              }
            } catch (fsErr) {
              log(`⚠️ Erro ao limpar tmp: ${fsErr.message}`, "WARN");
            }

            // Destruição segura do Torrent
            safeDestroyTorrent(torrent);

            // Remove do ativo após 10 segundos
            setTimeout(() => {
              if (activeDownloads[id]) delete activeDownloads[id];
              onDownloadComplete(id);
            }, 10000);
          }
        });

        torrent.on("error", (err) => {
          log(`❌ ERRO NO TORRENT: ${err.message}`, "ERROR");
          activeDownloads[id].error = err.message;
          activeDownloads[id].phase = "error";
          activeDownloads[id].errorTimestamp = Date.now();
          // Auto-remoção após 1 minuto
          setTimeout(() => {
            if (activeDownloads[id] && activeDownloads[id].phase === "error") {
              log(
                `⏰ Auto-remoção: Download ${id} removido após 1 minuto de erro`,
                "CLEANUP"
              );
              onDownloadComplete(id);
            }
          }, 60000);
        });

        torrent.on("warning", (warn) => {
          log(`⚠️ Warning: ${warn}`, "WARN");
        });
      }
    );

    // Adiciona handler de erro no torrentInstance (antes do callback ser chamado)
    if (torrentInstance) {
      torrentInstance.on("error", (err) => {
        log(`❌ ERRO NO TORRENT INSTANCE ${id}: ${err.message}`, "TORRENT");
        if (activeDownloads[id]) {
          activeDownloads[id].error = err.message;
          activeDownloads[id].phase = "error";
          activeDownloads[id].errorTimestamp = Date.now();
        }
      });

      // Handler para detectar quando o torrent está tentando conectar
      torrentInstance.on("infoHash", () => {
        log(`🔍 InfoHash detectado: ${torrentInstance.infoHash}`, "TORRENT");
      });

      // Handler para detectar quando o torrent está procurando peers
      torrentInstance.on("tracker", (announce) => {
        log(`🔍 Tracker anunciado: ${announce}`, "TORRENT");
      });

      log(`✅ Torrent instance criado`, "TORRENT");
      log(
        `   InfoHash: ${torrentInstance.infoHash || "Aguardando conexão..."}`,
        "TORRENT"
      );

      // Log adicional para debug
      if (
        typeof torrentInput === "string" &&
        torrentInput.startsWith("magnet:")
      ) {
        const infoHashMatch = torrentInput.match(/btih:([a-zA-Z0-9]+)/i);
        if (infoHashMatch) {
          log(`   InfoHash esperado: ${infoHashMatch[1]}`, "TORRENT");
        }
      }
    } else {
      log(`⚠️ Torrent instance é null/undefined!`, "TORRENT");
    }
  } catch (err) {
    log(`❌ ERRO ao adicionar torrent: ${err.message}`, "ERROR");
    activeDownloads[id].error = err.message;
    activeDownloads[id].phase = "error";
    activeDownloads[id].errorTimestamp = Date.now();
    // Auto-remoção após 1 minuto
    setTimeout(() => {
      if (activeDownloads[id] && activeDownloads[id].phase === "error") {
        log(
          `⏰ Auto-remoção: Download ${id} removido após 1 minuto de erro`,
          "CLEANUP"
        );
        onDownloadComplete(id);
      }
    }, 60000);
  }

  // Timeout de 5 minutos
  setTimeout(() => {
    if (activeDownloads[id]?.phase === "connecting") {
      log(`⏰ TIMEOUT: Nenhum peer encontrado após 5 minutos`, "ERROR");
      activeDownloads[id].error = "Timeout: Nenhum peer encontrado";
      activeDownloads[id].phase = "error";
      activeDownloads[id].errorTimestamp = Date.now();
      // Auto-remoção após 1 minuto
      setTimeout(() => {
        if (activeDownloads[id] && activeDownloads[id].phase === "error") {
          log(
            `⏰ Auto-remoção: Download ${id} removido após 1 minuto de erro`,
            "CLEANUP"
          );
          onDownloadComplete(id);
        }
      }, 60000);
    }
  }, 300000);
}

// ═══════════════════════════════════════════════
// HELPER: GERA LINK DIRETO DO DROPBOX
// ═══════════════════════════════════════════════

async function getDirectLink(path) {
  try {
    let sharedLink = "";
    // Tenta listar primeiro (mais rápido/seguro contra rate limit)
    const listResponse = await dbx.sharingListSharedLinks({ path: path });

    if (listResponse.result.links.length > 0) {
      sharedLink = listResponse.result.links[0].url;
    } else {
      // Cria se não existir
      const createResponse = await dbx.sharingCreateSharedLinkWithSettings({
        path: path,
      });
      sharedLink = createResponse.result.url;
    }

    // Transforma em link de download direto (CDN)
    const cdnUrl = new URL(sharedLink);
    cdnUrl.hostname = "dl.dropboxusercontent.com";
    cdnUrl.searchParams.delete("dl");
    cdnUrl.searchParams.delete("preview");
    return cdnUrl.toString();
  } catch (e) {
    console.error(`[BRIDGE] ❌ Erro ao gerar link para ${path}:`, e.message);
    return null;
  }
}

// ═══════════════════════════════════════════════
// SMART STREAM UPLOAD (Buffer de 20MB)
// ═══════════════════════════════════════════════
// Usa buffering inteligente para não estourar a RAM
// Pausa o stream, envia o chunk, e resume
// ✅ 20MB é bom equilíbrio entre velocidade e uso de RAM

const SMART_CHUNK_SIZE = 20 * 1024 * 1024; // 20MB por chunk (otimizado após testes)

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
      // ⚠️ VERIFICAÇÃO: Não finaliza se foi cancelado
      if (
        !activeDownloads[downloadId] ||
        activeDownloads[downloadId].isCancelled
      ) {
        return reject(new Error("Cancelado pelo usuário"));
      }

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

// Helper para esperar (Backoff)
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Smart Stream para arquivos grandes (> 10MB) com Retry Pattern
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
    if (activeDownloads[downloadId]) {
      activeDownloads[downloadId].currentFile = fileName;
      activeDownloads[downloadId].fileIndex = currentIndex + 1;
      activeDownloads[downloadId].uploadStatus = `Preparando upload...`;
    }

    log(
      `📤 Smart Stream: ${(fileSize / 1024 / 1024).toFixed(
        2
      )} MB em ~${totalChunks} chunks de ${(
        SMART_CHUNK_SIZE /
        1024 /
        1024
      ).toFixed(0)}MB`,
      "UPLOAD"
    );

    // Função interna para enviar chunk com Retries
    const sendChunkWithRetry = async (chunkToSend, isFirst, isLast) => {
      let attempts = 0;
      const maxAttempts = 5; // Aumentado para 5 tentativas

      while (attempts < maxAttempts) {
        try {
          if (isFirst && offset === 0) {
            // Início da sessão
            if (activeDownloads[downloadId])
              activeDownloads[
                downloadId
              ].uploadStatus = `Conectando ao Dropbox...`;

            const res = await dbx.filesUploadSessionStart({
              close: false,
              contents: chunkToSend,
            });
            sessionId = res.result.session_id;
            log(
              `   ✓ Sessão criada: ${sessionId.substring(0, 12)}...`,
              "UPLOAD"
            );
          } else if (isLast) {
            // Finalização (Commit)
            await dbx.filesUploadSessionFinish({
              cursor: { session_id: sessionId, offset: offset },
              commit: {
                path: destPath,
                mode: { ".tag": "add" },
                autorename: true,
                mute: true,
              },
              contents: chunkToSend,
            });
          } else {
            // Meio do arquivo (Append)
            await dbx.filesUploadSessionAppendV2({
              cursor: { session_id: sessionId, offset: offset },
              close: false,
              contents: chunkToSend,
            });
          }
          // Se chegou aqui, sucesso! Sai do loop.
          return;
        } catch (err) {
          attempts++;
          const errorMsg =
            err.error && err.error.error_summary
              ? err.error.error_summary
              : err.message;
          const is409 =
            JSON.stringify(err).includes("409") ||
            errorMsg.includes("409") ||
            err.status === 409;

          log(
            `   ⚠️ Erro no chunk (Tentativa ${attempts}/${maxAttempts}): ${errorMsg}`,
            "WARN"
          );

          if (attempts >= maxAttempts) throw err; // Desiste após max tentativas

          // Se for erro 409 (Conflito de Offset), é grave, mas tentar de novo pode alinhar se for erro de leitura
          // Se for erro de rede (5xx, timeout), o retry resolve.

          // Backoff exponencial: espera 2s, 4s, 8s...
          await sleep(2000 * Math.pow(2, attempts - 1));
        }
      }
    };

    stream.on("data", async (chunk) => {
      // 🛡️ VERIFICAÇÃO CRÍTICA DE CANCELAMENTO
      if (
        !activeDownloads[downloadId] ||
        activeDownloads[downloadId].isCancelled
      ) {
        stream.destroy();
        return reject(new Error("Cancelado pelo usuário"));
      }

      buffer = Buffer.concat([buffer, chunk]);

      if (buffer.length >= SMART_CHUNK_SIZE) {
        stream.pause(); // ⏸️ PAUSA O STREAM

        try {
          const chunkToSend = buffer.slice(0, SMART_CHUNK_SIZE);
          const remaining = buffer.slice(SMART_CHUNK_SIZE);
          chunkNum++;

          // Stats de velocidade
          const now = Date.now();
          const elapsed = (now - lastChunkTime) / 1000;
          const speed =
            elapsed > 0 ? SMART_CHUNK_SIZE / 1024 / 1024 / elapsed : 0;
          lastChunkTime = now;

          // 🔄 ENVIA COM RETRY
          await sendChunkWithRetry(chunkToSend, offset === 0, false);

          offset += chunkToSend.length;
          buffer = remaining;

          // Atualiza UI
          const filePercent = ((offset / fileSize) * 100).toFixed(1);
          const uploadedMB = (offset / 1024 / 1024).toFixed(1);
          const totalMB = (fileSize / 1024 / 1024).toFixed(1);

          if (activeDownloads[downloadId]) {
            activeDownloads[downloadId].uploadSpeed =
              speed > 0 ? `${speed.toFixed(1)} MB/s` : "-- MB/s";
            activeDownloads[
              downloadId
            ].uploadStatus = `Enviando chunk ${chunkNum}/${totalChunks}`;
            activeDownloads[downloadId].currentFileProgress =
              parseFloat(filePercent);
            activeDownloads[downloadId].uploadedBytes = `${uploadedMB} MB`;
            activeDownloads[downloadId].uploadTotal = `${totalMB} MB`;

            // ✅ Calcula progresso total em tempo real
            const download = activeDownloads[downloadId];
            if (download && download.totalFiles && download.fileIndex) {
              const completedFiles = download.fileIndex - 1;
              const currentFileProgress = parseFloat(filePercent) / 100;
              const totalProgress =
                ((completedFiles + currentFileProgress) / download.totalFiles) *
                100;
              activeDownloads[downloadId].uploadPercent = Math.min(
                100,
                totalProgress.toFixed(1)
              );
            }
          }

          log(
            `   📦 Chunk ${chunkNum}/${totalChunks}: ${filePercent}% (${uploadedMB}/${totalMB} MB) @ ${speed.toFixed(
              1
            )} MB/s`,
            "UPLOAD"
          );

          stream.resume(); // ▶️ RETOMA O STREAM
        } catch (err) {
          stream.destroy();
          log(`❌ Falha fatal no chunk ${chunkNum}: ${err.message}`, "ERROR");
          reject(err);
        }
      }
    });

    stream.on("end", async () => {
      if (
        !activeDownloads[downloadId] ||
        activeDownloads[downloadId].isCancelled
      ) {
        return reject(new Error("Cancelado pelo usuário"));
      }

      try {
        log(
          `   🏁 Finalizando sessão (${(buffer.length / 1024 / 1024).toFixed(
            2
          )} MB restantes)...`,
          "UPLOAD"
        );

        // Envia o último pedaço e faz o Commit
        // Se offset é 0, significa que o arquivo era menor que 1 chunk (upload único)
        await sendChunkWithRetry(buffer, offset === 0, true);

        log(`✅ Smart Stream concluído: ${destPath}`, "UPLOAD");
        resolve();
      } catch (err) {
        log(`❌ Erro ao finalizar sessão: ${err.message}`, "ERROR");
        reject(err);
      }
    });

    stream.on("error", (err) => {
      log(`❌ Erro de leitura do stream (Disco): ${err.message}`, "ERROR");
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
    phase: "checking", // Começa verificando duplicatas
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

// --- ROTA DE PRÉ-VISUALIZAÇÃO ---
router.post("/bridge/preview", requireAuth, async (req, res) => {
  const { magnet, torrentFile } = req.body;

  if (!magnet && !torrentFile) {
    return res
      .status(400)
      .json({ error: "Magnet link ou arquivo .torrent necessário" });
  }

  const torrentInput =
    magnet || (torrentFile ? Buffer.from(torrentFile, "base64") : null);

  return new Promise((resolve) => {
    let previewTorrent = null;
    let timeoutId = null;

    // Timeout de segurança (15 segundos)
    timeoutId = setTimeout(() => {
      if (previewTorrent) {
        try {
          safeDestroyTorrent(previewTorrent);
          // safeDestroyTorrent já faz a limpeza completa, não precisa chamar client.remove novamente
        } catch (e) {
          // Ignora erros ao remover
        }
      }
      if (!res.headersSent) {
        resolve(
          res
            .status(408)
            .json({ error: "Timeout ao obter informações do torrent" })
        );
      }
    }, 15000);

    try {
      previewTorrent = client.add(torrentInput, { path: "/tmp" }, (torrent) => {
        clearTimeout(timeoutId);

        // Função para identificar tipo de arquivo
        const getFileType = (fileName) => {
          // Tenta extrair Title ID do nome do arquivo
          const idMatch = fileName.match(/\[([0-9A-Fa-f]{16})\]/i);
          if (!idMatch) return "UNKNOWN";

          const titleId = idMatch[1].toUpperCase();
          const suffix = titleId.slice(-3);

          if (suffix === "800") return "UPDATE";
          if (suffix === "000") return "BASE";
          return "DLC";
        };

        // Extrai informações do torrent
        const gameFiles = torrent.files.filter((f) =>
          f.name.match(/\.(nsp|nsz|xci)$/i)
        );

        // Classifica arquivos por tipo
        const baseGames = [];
        const updates = [];
        const dlcs = [];
        const unknown = [];

        gameFiles.forEach((f) => {
          const type = getFileType(f.name);
          const fileInfo = {
            name: f.name,
            size: f.length,
            type: type,
          };

          if (type === "BASE") baseGames.push(fileInfo);
          else if (type === "UPDATE") updates.push(fileInfo);
          else if (type === "DLC") dlcs.push(fileInfo);
          else unknown.push(fileInfo);
        });

        const totalGameSize = gameFiles.reduce((acc, f) => acc + f.length, 0);
        const baseSize = baseGames.reduce((acc, f) => acc + f.size, 0);
        const updateSize = updates.reduce((acc, f) => acc + f.size, 0);
        const dlcSize = dlcs.reduce((acc, f) => acc + f.size, 0);

        const info = {
          name: torrent.name,
          infoHash: torrent.infoHash,
          totalFiles: torrent.files.length,
          stats: {
            base: baseGames.length,
            update: updates.length,
            dlc: dlcs.length,
            unknown: unknown.length,
            total: gameFiles.length,
          },
          sizes: {
            total: torrent.length,
            totalGame: totalGameSize,
            base: baseSize,
            update: updateSize,
            dlc: dlcSize,
          },
          files: torrent.files.map((f) => {
            const isGame = f.name.match(/\.(nsp|nsz|xci)$/i) !== null;
            return {
              name: f.name,
              size: f.length,
              isGame: isGame,
              type: isGame ? getFileType(f.name) : "OTHER",
            };
          }),
        };

        // Remove o torrent após obter informações
        setTimeout(() => {
          try {
            safeDestroyTorrent(torrent);
          } catch (e) {
            // Ignora erros ao remover
          }
        }, 1000);

        if (!res.headersSent) {
          resolve(res.json({ success: true, info }));
        }
      });

      previewTorrent.on("error", (err) => {
        clearTimeout(timeoutId);
        try {
          if (previewTorrent) {
            safeDestroyTorrent(previewTorrent);
            // safeDestroyTorrent já faz a limpeza completa, não precisa chamar client.remove novamente
          }
        } catch (e) {
          // Ignora erros ao remover
        }
        if (!res.headersSent) {
          resolve(
            res
              .status(400)
              .json({ error: `Erro ao processar torrent: ${err.message}` })
          );
        }
      });
    } catch (err) {
      clearTimeout(timeoutId);
      if (!res.headersSent) {
        resolve(
          res.status(500).json({ error: `Erro interno: ${err.message}` })
        );
      }
    }
  });
});

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

    // 🛡️ VERIFICAÇÃO PRÉVIA DE DUPLICATAS (antes de adicionar à fila)
    try {
      // Importa parse-torrent dinamicamente
      const parseTorrentModule = await import("parse-torrent");
      const parseTorrent =
        typeof parseTorrentModule.default === "function"
          ? parseTorrentModule.default
          : parseTorrentModule;

      // Faz parse do torrent
      const torrentInfo = await parseTorrent(req.file.buffer);

      if (!torrentInfo || !torrentInfo.infoHash) {
        log(`⚠️ Não foi possível fazer parse do torrent`, "WARN");
      } else {
        // Extrai nomes dos arquivos
        const fileNames = [];
        if (torrentInfo.files && Array.isArray(torrentInfo.files)) {
          torrentInfo.files.forEach((file) => {
            if (file.path) {
              const fileName = Array.isArray(file.path)
                ? file.path[file.path.length - 1]
                : file.path;
              fileNames.push(fileName);
            } else if (file.name) {
              fileNames.push(file.name);
            }
          });
        } else if (
          torrentInfo.info &&
          torrentInfo.info.files &&
          Array.isArray(torrentInfo.info.files)
        ) {
          torrentInfo.info.files.forEach((file) => {
            if (file.path) {
              const fileName = Array.isArray(file.path)
                ? file.path[file.path.length - 1]
                : file.path;
              fileNames.push(fileName);
            } else if (file.name) {
              fileNames.push(file.name);
            }
          });
        }

        log(
          `🔍 Verificando ${fileNames.length} arquivo(s) por duplicatas...`,
          "DUPLICATE"
        );

        // Filtra apenas arquivos de jogo
        const gameFiles = fileNames.filter((fileName) =>
          fileName.match(/\.(nsp|nsz|xci)$/i)
        );

        if (gameFiles.length > 0) {
          log(
            `🎮 ${gameFiles.length} arquivo(s) de jogo encontrado(s) para verificação`,
            "DUPLICATE"
          );

          // Verifica cada arquivo de jogo
          for (const fileName of gameFiles) {
            log(`   Verificando: ${fileName}`, "DUPLICATE");
            const meta = parseGameInfo(fileName);

            // Verifica por filename (normalizado)
            const normalizedFileName = fileName.trim();
            const duplicateByFilename = await checkGameExists(
              normalizedFileName,
              null,
              null
            );

            if (duplicateByFilename) {
              const reason = `Arquivo já existe: ${fileName}`;
              log(`🚫 BLOQUEADO ANTES DA FILA: ${reason}`, "DUPLICATE");

              return res.status(409).json({
                error: `Este jogo já existe no sistema: ${reason}`,
                duplicate: true,
              });
            }

            // Se tiver titleId e versão, verifica também por lógica
            if (meta.id && meta.version) {
              const duplicateByLogic = await checkGameExists(
                normalizedFileName,
                meta.id,
                meta.version
              );

              if (duplicateByLogic) {
                const reason = `Jogo já cadastrado: ${meta.name} [v${meta.version}]`;
                log(`🚫 BLOQUEADO ANTES DA FILA: ${reason}`, "DUPLICATE");

                return res.status(409).json({
                  error: `Este jogo já existe no sistema: ${reason}`,
                  duplicate: true,
                });
              }
            }
          }

          log(`✅ Nenhuma duplicata encontrada, prosseguindo...`, "DUPLICATE");
        }
      }
    } catch (preCheckError) {
      // Se a verificação prévia falhar, continua normalmente
      // A verificação completa acontecerá depois que o torrent for processado
      log(
        `⚠️ Verificação prévia falhou (continuando): ${preCheckError.message}`,
        "WARN"
      );
    }

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

// --- ROTA DE CANCELAMENTO ---
router.post("/bridge/cancel/:id", requireAuth, (req, res) => {
  const { id } = req.params;
  const download = activeDownloads[id];

  if (!download) {
    return res.status(404).json({ error: "Download não encontrado" });
  }

  // Verifica se está na fila (antes de estar ativo)
  const queueIndex = downloadQueue.findIndex((q) => q.id === id);
  if (queueIndex !== -1) {
    // Remove da fila
    downloadQueue.splice(queueIndex, 1);
    log(`❌ Download ${id} removido da fila`, "CANCEL");
    return res.json({
      success: true,
      message: "Download removido da fila",
      removedFromQueue: true,
    });
  }

  // Cancela download ativo
  try {
    // ⚠️ FLAG CRÍTICA: Para o upload instantaneamente
    download.isCancelled = true;

    // Destrói o torrent se existir (blindado)
    try {
      if (download.torrent) {
        safeDestroyTorrent(download.torrent);
        log(`🗑️ Torrent ${id} destruído pelo usuário`, "CANCEL");
      } else if (download.torrentInstance) {
        safeDestroyTorrent(download.torrentInstance);
        log(`🗑️ Torrent instance ${id} destruído pelo usuário`, "CANCEL");
      }
    } catch (e) {
      log(`⚠️ Ignorando erro de destroy no cancelamento: ${e.message}`, "WARN");
    }

    // Marca como cancelado
    download.phase = "error";
    download.error = "Cancelado pelo usuário";
    download.uploadStatus = "Cancelado";

    // Remove após 5 segundos e processa próximo da fila
    setTimeout(() => {
      delete activeDownloads[id];
      onDownloadComplete(id);
    }, 5000);

    log(`❌ Download ${id} cancelado pelo usuário`, "CANCEL");
    res.json({ success: true, message: "Download cancelado" });
  } catch (err) {
    log(`❌ Erro ao cancelar download: ${err.message}`, "ERROR");
    res.status(500).json({ error: "Erro ao cancelar download" });
  }
});

// ═══════════════════════════════════════════════
// TELEGRAM INDEXER - BUSCA E DOWNLOAD DE JOGOS
// ═══════════════════════════════════════════════

/**
 * Busca jogos no bot do Telegram
 * POST /bridge/search-games
 * Body: { searchTerm: string }
 */
router.post("/bridge/search-games", requireAuth, async (req, res) => {
  try {
    const { searchTerm } = req.body;

    if (!searchTerm || searchTerm.trim().length === 0) {
      return res.status(400).json({ error: "Termo de busca é obrigatório" });
    }

    log(`🔎 Busca solicitada: "${searchTerm}"`, "SEARCH");
    const games = await searchGames(searchTerm);

    log(`✅ ${games.length} jogos encontrados`, "SEARCH");
    res.json({ success: true, games });
  } catch (error) {
    console.error("[SEARCH] Erro:", error);
    res.status(500).json({
      error: error.message || "Erro ao buscar jogos",
    });
  }
});

/**
 * Faz download de um jogo específico via Telegram e adiciona à fila
 * POST /bridge/download-from-search
 * Body: { command: string, gameName: string }
 */
router.post("/bridge/download-from-search", requireAuth, async (req, res) => {
  try {
    const { command, gameName } = req.body;

    if (!command) {
      return res
        .status(400)
        .json({ error: "Comando de download é obrigatório" });
    }

    log(
      `⬇️ Download solicitado: ${command} (${gameName || "N/A"})`,
      "DOWNLOAD"
    );

    // Busca o magnet link/torrent do bot
    const torrentData = await fetchGameTorrent(command);

    if (!torrentData || torrentData.type !== "magnet" || !torrentData.link) {
      return res.status(500).json({
        error: "Não foi possível obter o magnet link do jogo",
      });
    }

    const magnetLink = torrentData.link;
    log(`✅ Magnet link obtido: ${magnetLink.substring(0, 50)}...`, "DOWNLOAD");

    // Adiciona à fila de downloads (reutiliza a lógica existente)
    const id = `search_${Date.now()}_${Math.random()
      .toString(36)
      .substr(2, 9)}`;
    const name = gameName || torrentData.filename || "Jogo do Bot";

    // Verifica se já existe na fila ou ativo
    const existingInQueue = downloadQueue.find(
      (q) => q.input === magnetLink || q.magnet === magnetLink
    );
    const existingActive = Object.values(activeDownloads).find(
      (d) => d.magnet === magnetLink
    );

    if (existingInQueue || existingActive) {
      return res.status(409).json({
        error: "Este jogo já está na fila ou sendo baixado",
        id: existingInQueue?.id || existingActive?.id,
      });
    }

    // 🛡️ VERIFICAÇÃO PRÉVIA DE DUPLICATAS (antes de adicionar à fila)
    // Verifica se algum arquivo do torrent já existe no banco
    try {
      const fileNames = torrentData.fileNames || [];

      if (fileNames.length > 0) {
        log(
          `🔍 Verificando ${fileNames.length} arquivo(s) por duplicatas...`,
          "DUPLICATE"
        );

        // Filtra apenas arquivos de jogo (.nsp, .nsz, .xci)
        const gameFiles = fileNames.filter((fileName) =>
          fileName.match(/\.(nsp|nsz|xci)$/i)
        );

        if (gameFiles.length > 0) {
          log(
            `🎮 ${gameFiles.length} arquivo(s) de jogo encontrado(s) para verificação`,
            "DUPLICATE"
          );

          // Verifica cada arquivo de jogo
          for (const fileName of gameFiles) {
            log(`   Verificando: ${fileName}`, "DUPLICATE");
            const meta = parseGameInfo(fileName);

            // Normaliza o nome do arquivo (trim, case insensitive)
            const normalizedFileName = fileName.trim();

            // Verifica por filename primeiro
            log(
              `   Verificando por filename: "${normalizedFileName}"`,
              "DUPLICATE"
            );
            const duplicateByFilename = await checkGameExists(
              normalizedFileName,
              null,
              null
            );

            if (duplicateByFilename) {
              const reason = `Arquivo já existe: ${fileName}`;
              log(`🚫 BLOQUEADO ANTES DA FILA: ${reason}`, "DUPLICATE");
              log(
                `   Arquivo encontrado no banco: ${duplicateByFilename.found?.filename}`,
                "DUPLICATE"
              );

              return res.status(409).json({
                error: `Este jogo já existe no sistema: ${reason}`,
                duplicate: true,
              });
            }

            log(`   ✅ Filename não encontrado no banco`, "DUPLICATE");

            // Se tiver titleId e versão, verifica também por lógica
            if (meta.id && meta.version) {
              const duplicateByLogic = await checkGameExists(
                normalizedFileName,
                meta.id,
                meta.version
              );

              if (duplicateByLogic) {
                const reason = `Jogo já cadastrado: ${meta.name} [v${meta.version}]`;
                log(`🚫 BLOQUEADO ANTES DA FILA: ${reason}`, "DUPLICATE");

                return res.status(409).json({
                  error: `Este jogo já existe no sistema: ${reason}`,
                  duplicate: true,
                });
              }
            }
          }

          log(`✅ Nenhuma duplicata encontrada, prosseguindo...`, "DUPLICATE");
        } else {
          log(
            `⚠️ Nenhum arquivo de jogo encontrado no torrent para verificação prévia`,
            "WARN"
          );
        }
      } else {
        // Fallback: tenta extrair do nome do arquivo .torrent
        const filename = torrentData.filename || name;
        const meta = parseGameInfo(filename);

        if (meta.id && meta.version) {
          log(
            `🔍 Verificando duplicata prévia (fallback): ${meta.id} v${meta.version}`,
            "DUPLICATE"
          );
          const duplicate = await checkGameExists(
            filename,
            meta.id,
            meta.version
          );

          if (duplicate) {
            const reason =
              duplicate.type === "filename"
                ? `Arquivo já existe: ${filename}`
                : `Jogo já cadastrado: ${meta.name} [v${meta.version}]`;

            log(`🚫 BLOQUEADO ANTES DA FILA: ${reason}`, "DUPLICATE");

            return res.status(409).json({
              error: `Este jogo já existe no sistema: ${reason}`,
              duplicate: true,
            });
          }
        }
      }
    } catch (preCheckError) {
      // Se a verificação prévia falhar, continua normalmente
      // A verificação completa acontecerá depois que o torrent for processado
      log(
        `⚠️ Verificação prévia falhou (continuando): ${preCheckError.message}`,
        "WARN"
      );
    }

    // Cria item da fila no formato esperado
    const queueItem = {
      id,
      name,
      input: magnetLink, // processTorrent aceita magnet link como string
      source: "telegram_search",
      addedAt: new Date().toISOString(),
    };

    // Adiciona à fila usando a função existente
    addToQueue(queueItem);

    res.json({
      success: true,
      message: "Jogo adicionado à fila de download",
      id,
      name,
      position: downloadQueue.length,
      queued: downloadQueue.length > MAX_CONCURRENT_DOWNLOADS,
    });
  } catch (error) {
    console.error("[DOWNLOAD-SEARCH] Erro:", error);
    res.status(500).json({
      error: error.message || "Erro ao processar download",
    });
  }
});

export default router;
