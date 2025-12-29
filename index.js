import express from "express";
import { Dropbox } from "dropbox";
import fetch from "isomorphic-fetch";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import manaBridge, { requireAuth } from "./manaBridge.js";
import { connectDB, saveGameCache, getGameCache } from "./database.js";
import { tinfoilAuth } from "./authMiddleware.js";

// ✅ IMPORTAÇÃO DO NOVO MÓDULO CEREBRAL
import { loadTitleDB, parseGameInfo, getDbStatus } from "./titleDbService.js";

// ES Modules __dirname equivalent
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

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

// Servir arquivos estáticos do frontend
app.use("/public", express.static(path.join(__dirname, "frontend/public")));

// Logger
app.use((req, res, next) => {
  if (
    !req.path.includes(".") &&
    (req.path.startsWith("/api") || req.path.startsWith("/download"))
  ) {
    console.log(`[REQ] ${req.method} ${req.path} - IP: ${req.ip}`);
  }
  next();
});

app.use(express.json()); // Necessário para ler o JSON do magnet link
app.use(manaBridge);

// Rota de Health agora consome o status do serviço externo
app.get("/health", (req, res) => {
  res.json({
    status: "Online",
    time: new Date().toISOString(),
    games: cachedGames.length,
    titleDb: getDbStatus(), // ✅ Usa a função do novo módulo
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

async function processInBatches(items, batchSize, fn) {
  let results = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map(fn));
    results = results.concat(batchResults);
    await new Promise((resolve) => setTimeout(resolve, 200)); // Delay reduzido
  }
  return results;
}

async function getDirectLink(path) {
  try {
    let sharedLink = "";
    const listResponse = await dbx.sharingListSharedLinks({ path: path });
    if (listResponse.result.links.length > 0) {
      sharedLink = listResponse.result.links[0].url;
    } else {
      const createResponse = await dbx.sharingCreateSharedLinkWithSettings({
        path: path,
      });
      sharedLink = createResponse.result.url;
    }
    const cdnUrl = new URL(sharedLink);
    cdnUrl.hostname = "dl.dropboxusercontent.com";
    cdnUrl.searchParams.delete("dl");
    cdnUrl.searchParams.delete("preview");
    return cdnUrl.toString();
  } catch (e) {
    // Log silencioso - muitos erros podem ser rate limit, não queremos poluir o console
    // Se precisar debug, descomente: log.warn(`Erro ao gerar link para ${path}: ${e.message}`);
    return null;
  }
}

// (A função parseGameInfo antiga foi removida daqui pois agora vem do import)

async function buildGameIndex() {
  if (isIndexing) return;
  isIndexing = true;
  indexingProgress = "Escaneando Dropbox...";
  log.info("🚀 INICIANDO INDEXAÇÃO...");

  // ✅ Garante que o Cérebro está carregado antes de processar
  if (getDbStatus().startsWith("Vazio")) {
    await loadTitleDB();
  }

  try {
    let allFiles = [];
    let pageCount = 1;
    let response = await dbx.filesListFolder({
      path: ROOT_GAMES_FOLDER,
      recursive: true,
      limit: 2000,
    });
    allFiles = allFiles.concat(response.result.entries);
    log.info(
      `📄 Página ${pageCount}: ${response.result.entries.length} itens (Total: ${allFiles.length})`
    );

    while (response.result.has_more) {
      pageCount++;
      response = await dbx.filesListFolderContinue({
        cursor: response.result.cursor,
      });
      allFiles = allFiles.concat(response.result.entries);
      log.info(
        `📄 Página ${pageCount}: ${response.result.entries.length} itens (Total: ${allFiles.length})`
      );

      // Pequeno delay para não sobrecarregar a API do Dropbox
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    log.info(`📁 Total de itens listados do Dropbox: ${allFiles.length}`);

    const validFiles = allFiles.filter(
      (entry) =>
        entry[".tag"] === "file" && entry.name.match(/\.(nsp|nsz|xci)$/i)
    );
    log.info(`📁 Encontrados ${validFiles.length} arquivos.`);

    indexingProgress = "Processando Inteligência...";

    // ✅ Processamento em lotes com progresso incremental
    const BATCH_SIZE = 15; // Lotes de 15 para não sobrecarregar
    let processedCount = 0;
    let games = [];

    for (let i = 0; i < validFiles.length; i += BATCH_SIZE) {
      const batch = validFiles.slice(i, i + BATCH_SIZE);
      const batchNum = Math.floor(i / BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(validFiles.length / BATCH_SIZE);

      indexingProgress = `Processando lote ${batchNum}/${totalBatches} (${processedCount}/${validFiles.length} jogos)...`;
      log.info(
        `📦 Processando lote ${batchNum}/${totalBatches} (${batch.length} arquivos)`
      );

      const batchResults = await Promise.all(
        batch.map(async (file) => {
          try {
            const directUrl = await getDirectLink(file.path_lower);
            if (!directUrl) {
              log.warn(`⚠️ Falha ao gerar link: ${file.name}`);
              return null;
            }

            // ✅ CHAMA O PARSER DO ARQUIVO SEPARADO
            const { name, id, version } = parseGameInfo(file.name);

            if (!id) {
              log.warn(`⚠️ DESCONHECIDO: "${name}". Verifique a grafia.`);
            }

            processedCount++;
            return {
              url: directUrl,
              size: file.size,
              name: name,
              id: id,
              titleId: id,
              version: version,
              filename: file.name,
            };
          } catch (err) {
            log.error(`❌ Erro ao processar ${file.name}:`, err.message);
            return null;
          }
        })
      );

      games = games.concat(batchResults.filter((g) => g !== null));

      // Delay entre lotes para não sobrecarregar
      if (i + BATCH_SIZE < validFiles.length) {
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
    }

    cachedGames = games;
    lastCacheTime = Date.now();
    await saveGameCache(cachedGames);

    const successCount = cachedGames.length;
    const failedCount = validFiles.length - successCount;

    log.info(`✅ INDEXAÇÃO CONCLUÍDA!`);
    log.info(`   📊 Estatísticas:`);
    log.info(`   ✅ Jogos indexados: ${successCount}`);
    log.info(`   ❌ Falhas: ${failedCount}`);
    log.info(`   📁 Total de arquivos: ${validFiles.length}`);

    indexingProgress = `Concluído (${successCount}/${validFiles.length} jogos)`;
  } catch (e) {
    log.error("FALHA INDEXAÇÃO:", e);
    indexingProgress = `Erro: ${e.message || "Erro desconhecido"}`;
  } finally {
    isIndexing = false;
  }
}

// --- ROTAS DA LOJA ---
app.get(["/api", "/api/"], (req, res) => {
  if (cachedGames.length === 0 && !isIndexing) buildGameIndex();

  if (isIndexing && cachedGames.length === 0) {
    return res.json({
      success: `Loja Iniciando... (${indexingProgress})`,
      files: [],
    });
  }

  // Tinfoil lê esse JSON. O campo "id" ajuda ele a achar a capa sozinho no Switch!
  res.setHeader("Content-Type", "application/json");
  res.json({
    files: cachedGames,
    success: `Capivara Shop (${cachedGames.length} jogos)`,
  });
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

// Endpoint para o Dashboard (Site)
app.get("/bridge/games", requireAuth, (req, res) => {
  res.json({ games: cachedGames });
});

// --- STARTUP ---

async function startServer() {
  await connectDB();

  // ✅ Inicializa o Cérebro no Startup
  await loadTitleDB();

  const savedCache = await getGameCache();
  if (savedCache.games.length > 0) {
    cachedGames = savedCache.games;
    lastCacheTime = savedCache.lastUpdate || Date.now();
  }
  app.listen(PORT, () => {
    log.info(`🚀 Mana Shop rodando na porta ${PORT}`);
    if (
      cachedGames.length === 0 ||
      Date.now() - lastCacheTime > CACHE_DURATION
    ) {
      buildGameIndex();
    }
  });
}

startServer().catch((err) => {
  log.error("Falha ao iniciar servidor:", err);
  process.exit(1);
});
