import express from "express";
import { Dropbox } from "dropbox";
import fetch from "isomorphic-fetch";
import dotenv from "dotenv";
import manaBridge from "./manaBridge.js";
import { connectDB, saveGameCache, getGameCache } from "./database.js";
import { tinfoilAuth } from "./authMiddleware.js";
import { User } from "./database.js";

dotenv.config();

const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
const ADMIN_PASS = process.env.ADMIN_PASS;

// Função simples de autenticação para rotas /bridge/*
const requireAuth = async (req, res, next) => {
  const cookies = req.headers.cookie || "";
  const tokenMatch = cookies.match(/auth_token=([^;]+)/);
  let token = tokenMatch ? tokenMatch[1] : null;

  if (token) {
    try {
      token = decodeURIComponent(token);
    } catch (e) {}

    const adminToken = Buffer.from(`admin:${ADMIN_PASS}`).toString("base64");
    if (token === adminToken) {
      return next();
    }

    try {
      const decoded = Buffer.from(token, "base64").toString();
      if (decoded.startsWith("user:")) {
        const userId = decoded.split(":")[1];
        const user = await User.findById(userId);
        if (user) {
          return next();
        }
      }
    } catch (e) {}
  }

  res.status(401).json({ error: "Não autorizado" });
};

const PORT = process.env.PORT || 8080;
const ROOT_GAMES_FOLDER = "/Games_Switch";

const log = {
  info: (msg) => console.log(`[INFO] ${msg}`),
  error: (msg, err) => console.error(`[ERROR] ${msg}`, err || ""),
  warn: (msg) => console.log(`[WARN] ${msg}`),
};

const dbx = new Dropbox({
  clientId: process.env.DROPBOX_APP_KEY,
  clientSecret: process.env.DROPBOX_APP_SECRET,
  refreshToken: process.env.DROPBOX_REFRESH_TOKEN,
  fetch,
});

const app = express();
app.enable("trust proxy");

// Logger de Requisições (Diagnóstico)
app.use((req, res, next) => {
  // Ignora assets estáticos para limpar o log
  if (
    !req.path.includes(".") &&
    (req.path.startsWith("/api") || req.path.startsWith("/download"))
  ) {
    console.log(
      `[REQ] ${req.method} ${req.path} - IP: ${req.ip} - Auth: ${
        req.headers.authorization ? "Sim" : "Não"
      }`
    );
  }
  next();
});

app.use(express.json()); // Necessário para ler o JSON do magnet link
app.use(manaBridge);

// ROTA DE DEBUG PÚBLICA (Para testar se o servidor está vivo sem senha)
app.get("/health", (req, res) => {
  res.json({
    status: "Online",
    time: new Date().toISOString(),
    games: cachedGames.length,
  });
});

app.use("/api", tinfoilAuth);
app.use("/download", tinfoilAuth);

// --- ESTADO GLOBAL DO SERVIDOR ---
let cachedGames = [];
let isIndexing = false;
let indexingProgress = "0%";
let lastCacheTime = 0;
const CACHE_DURATION = 60 * 60 * 1000; // 1 hora

// --- FUNÇÕES AUXILIARES ---

// Helper para processar promessas em lotes (Evita crash de memória/CPU)
async function processInBatches(items, batchSize, fn) {
  let results = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    log.info(
      `⚙️ Processando lote ${i + 1} a ${Math.min(
        i + batchSize,
        items.length
      )} de ${items.length}...`
    );

    // Executa o lote em paralelo
    const batchResults = await Promise.all(batch.map(fn));
    results = results.concat(batchResults);

    // Pequena pausa para respirar (Evita Rate Limit do Dropbox)
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return results;
}

async function getDirectLink(path) {
  try {
    let sharedLink = "";
    // 1. Verifica existência (Mais rápido que tentar criar e falhar)
    const listResponse = await dbx.sharingListSharedLinks({ path: path });

    if (listResponse.result.links.length > 0) {
      sharedLink = listResponse.result.links[0].url;
    } else {
      // 2. Cria novo se necessário
      const createResponse = await dbx.sharingCreateSharedLinkWithSettings({
        path: path,
      });
      sharedLink = createResponse.result.url;
    }

    // 3. Conversão CDN
    const cdnUrl = new URL(sharedLink);
    cdnUrl.hostname = "dl.dropboxusercontent.com";
    cdnUrl.searchParams.delete("dl");
    cdnUrl.searchParams.delete("preview");

    return cdnUrl.toString();
  } catch (e) {
    log.error(`Erro no link (${path}):`, e.error?.[".tag"] || e.message);
    return null;
  }
}

async function buildGameIndex() {
  if (isIndexing) {
    log.warn("Indexação já está rodando.");
    return;
  }
  isIndexing = true;
  indexingProgress = "Iniciando Scan...";
  const startTime = Date.now();
  log.info("🚀 INICIANDO INDEXAÇÃO COMPLETA...");

  try {
    let allFiles = [];
    let response = await dbx.filesListFolder({
      path: ROOT_GAMES_FOLDER,
      recursive: true,
      limit: 2000,
    });
    allFiles = allFiles.concat(response.result.entries);
    while (response.result.has_more) {
      response = await dbx.filesListFolderContinue({
        cursor: response.result.cursor,
      });
      allFiles = allFiles.concat(response.result.entries);
    }
    const validFiles = allFiles.filter(
      (entry) =>
        entry[".tag"] === "file" && entry.name.match(/\.(nsp|nsz|xci)$/i)
    );
    log.info(`📁 Total: ${validFiles.length} jogos.`);

    const games = await processInBatches(validFiles, 5, async (file) => {
      const directUrl = await getDirectLink(file.path_lower);
      if (!directUrl) return null;
      const displayName = file.name
        .replace(/\s*\([0-9.]+\s*(GB|MB)\)/gi, "")
        .trim();
      return { url: directUrl, size: file.size, name: displayName };
    });

    cachedGames = games.filter((g) => g !== null);
    lastCacheTime = Date.now();
    await saveGameCache(cachedGames);
    log.info(`✅ INDEXAÇÃO CONCLUÍDA! ${cachedGames.length} jogos.`);
    isIndexing = false;
    indexingProgress = "Concluído";
  } catch (e) {
    log.error("FALHA INDEXAÇÃO:", e);
    isIndexing = false;
    indexingProgress = "Erro";
  }
}

// --- ROTAS DA LOJA (CORREÇÃO AQUI) ---

// Aceita tanto /api quanto /api/ (Regex ou Array)
app.get(["/api", "/api/"], (req, res) => {
  // Se o cache estiver vazio e não estiver indexando, dispara index
  if (cachedGames.length === 0 && !isIndexing) {
    buildGameIndex();
  }

  // Se ainda estiver indexando e vazio
  if (isIndexing && cachedGames.length === 0) {
    const responseData = {
      success: `Loja Iniciando... (${indexingProgress})`,
      files: [],
    };
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "no-store");
    return res.json(responseData);
  }

  const responseData = {
    files: cachedGames,
    success: `Capivara Shop (${cachedGames.length} jogos)`,
  };

  // Força JSON estrito e não faz cache do JSON
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.json(responseData);
});

app.get("/refresh", (req, res) => {
  buildGameIndex();
  res.send("Indexação iniciada.");
});

// Endpoint para status da indexação (usado pelo admin dashboard)
app.get("/indexing-status", (req, res) => {
  res.json({
    isIndexing,
    progress: indexingProgress,
    totalGames: cachedGames.length,
    lastUpdate: lastCacheTime ? new Date(lastCacheTime).toISOString() : null,
  });
});

// Endpoint para listar jogos (usado pelo admin dashboard)
app.get("/bridge/games", requireAuth, (req, res) => {
  res.json({
    games: cachedGames,
    total: cachedGames.length,
    lastUpdate: lastCacheTime ? new Date(lastCacheTime).toISOString() : null,
  });
});

// --- STARTUP ---

async function startServer() {
  await connectDB();
  const savedCache = await getGameCache();
  if (savedCache.games.length > 0) {
    cachedGames = savedCache.games;
    lastCacheTime = savedCache.lastUpdate || Date.now();
    log.info(`📚 Cache carregado: ${cachedGames.length} jogos`);
  }

  app.listen(PORT, () => {
    log.info(`🚀 Mana Shop rodando na porta ${PORT}`);
    const cacheAge = Date.now() - lastCacheTime;
    if (cachedGames.length === 0 || cacheAge > CACHE_DURATION) {
      buildGameIndex();
    }
  });
}

startServer().catch((err) => {
  log.error("Falha ao iniciar servidor:", err);
  process.exit(1);
});
