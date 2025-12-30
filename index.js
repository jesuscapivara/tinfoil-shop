import express from "express";
import cors from "cors";
import { Dropbox } from "dropbox";
import fetch from "isomorphic-fetch";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import manaBridge, { requireAuth, bridgeEvents } from "./manaBridge.js";
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

// CONFIGURAÇÃO CORS OTIMIZADA
const FRONTEND_URL = process.env.FRONTEND_URL; // Produção
const isDev = process.env.NODE_ENV !== "production";

app.use(
  cors({
    origin: (origin, callback) => {
      // 1. Permite requisições server-to-server ou ferramentas (Postman/Tinfoil)
      if (!origin) return callback(null, true);

      // 2. Produção: Whitelist estrita
      if (FRONTEND_URL && origin === FRONTEND_URL) {
        return callback(null, true);
      }

      // 3. Desenvolvimento: Permite localhost em QUALQUER porta (Vite usa 5173, 5174...)
      if (
        isDev &&
        (origin.startsWith("http://localhost:") ||
          origin.startsWith("http://127.0.0.1:"))
      ) {
        return callback(null, true);
      }

      // 4. Domínios específicos legados/extras
      const allowedDomains = [
        "https://capivara.rossetti.eng.br",
        "https://tinfoil-frontend.vercel.app", // Frontend em Produção (Vercel)
      ];
      if (allowedDomains.includes(origin)) {
        return callback(null, true);
      }

      // 5. Permite localhost em QUALQUER porta mesmo em produção (para desenvolvimento local do frontend)
      // Isso permite que o frontend local se conecte ao backend em produção, independente da porta
      if (
        origin.startsWith("http://localhost:") ||
        origin.startsWith("http://127.0.0.1:")
      ) {
        return callback(null, true);
      }

      callback(new Error(`CORS blocked origin: ${origin}`));
    },
    credentials: true, // Essencial para cookies/auth headers
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "X-Requested-With",
      "Accept",
      "Origin",
    ],
    exposedHeaders: ["Content-Length", "Content-Type"],
    preflightContinue: false, // Responde ao preflight imediatamente
    optionsSuccessStatus: 204, // Status code para OPTIONS bem-sucedido
  })
);

// Frontend antigo removido - agora o frontend é separado

// Logger
app.use((req, res, next) => {
  if (
    !req.path.includes(".") &&
    (req.path === "/" ||
      req.path.startsWith("/api") ||
      req.path.startsWith("/download"))
  ) {
    console.log(`[REQ] ${req.method} ${req.path} - IP: ${req.ip}`);
  }
  next();
});

app.use(express.json()); // Necessário para ler o JSON do magnet link
app.use(manaBridge);

// Rota de Health agora consome o status do serviço externo
// Endpoint público - não requer autenticação
app.get("/health", (req, res) => {
  res.json({
    status: "Online",
    time: new Date().toISOString(),
    games: cachedGames.length,
    titleDb: getDbStatus(), // ✅ Usa a função do novo módulo
  });
});

// Endpoint público para status de indexação (usado pelo frontend)
app.get("/indexing-status", (req, res) => {
  const counts = countGamesByType(cachedGames);
  res.json({
    isIndexing,
    progress: indexingProgress,
    totalGames: cachedGames.length,
    stats: counts, // Estatísticas detalhadas
    lastUpdate: lastCacheTime ? new Date(lastCacheTime).toISOString() : null,
  });
});

// Rotas protegidas - requerem autenticação Tinfoil
app.use("/api", tinfoilAuth);
app.use("/download", tinfoilAuth);

// --- ESTADO GLOBAL DO SERVIDOR ---
let cachedGames = [];
let isIndexing = false;
let indexingProgress = "0%";
let lastCacheTime = 0;
const CACHE_DURATION = 60 * 60 * 1000; // 1 hora

// ✅ Função para recarregar cache do banco (usada após indexação incremental)
export async function refreshCacheFromDB() {
  try {
    const savedCache = await getGameCache();
    if (savedCache.games.length > 0) {
      cachedGames = savedCache.games;
      lastCacheTime = savedCache.lastUpdate || Date.now();
      log.info(`🔄 Cache em memória atualizado: ${cachedGames.length} jogos`);
    }
  } catch (err) {
    log.error("Erro ao recarregar cache do banco:", err.message);
  }
}

// ═══════════════════════════════════════════════
// CLASSIFICAÇÃO E CONTAGEM DE JOGOS
// ═══════════════════════════════════════════════

/**
 * Identifica o tipo de jogo baseado no Title ID
 * @param {string} titleId - Title ID do jogo (16 caracteres hex)
 * @returns {string} - 'BASE', 'UPDATE', 'DLC' ou 'UNKNOWN'
 */
function getGameType(titleId) {
  if (!titleId || titleId.length !== 16) return "UNKNOWN";

  const suffix = titleId.slice(-3).toUpperCase();
  if (suffix === "800") return "UPDATE";
  if (suffix === "000") return "BASE";
  return "DLC";
}

/**
 * Conta jogos por tipo
 * @param {Array} games - Lista de jogos
 * @returns {Object} - { base: number, dlc: number, update: number, total: number }
 */
function countGamesByType(games) {
  const counts = {
    base: 0,
    dlc: 0,
    update: 0,
    unknown: 0,
    total: games.length,
  };

  games.forEach((game) => {
    const type = getGameType(game.id);
    if (type === "BASE") counts.base++;
    else if (type === "DLC") counts.dlc++;
    else if (type === "UPDATE") counts.update++;
    else counts.unknown++;
  });

  return counts;
}

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
      // Aqui é onde o Rate Limit geralmente explode
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
    // Se for erro 429, vai aparecer no log agora
    const errorMsg =
      e.error && e.error.error_summary ? e.error.error_summary : e.message;
    console.log(
      `[API DROPBOX] ❌ Erro no arquivo: ${path} | Motivo: ${errorMsg}`
    );
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

    // ✅ Ajuste Agressivo de Throughput
    // Dropbox Free aguenta mal 15 reqs simultâneas de criação de link.
    // Vamos ser conservadores para garantir a indexação.
    const BATCH_SIZE = 4; // Reduzido de 15 para 4 (Rate Limit Safe)
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
              // Log já foi feito dentro do getDirectLink
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

      // ✅ Aumentar Delay entre lotes
      // Dropbox Rate Limit "esfria" rápido, mas precisa de respiro.
      // 2000ms garante que não sejamos banidos temporariamente.
      if (i + BATCH_SIZE < validFiles.length) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }

    cachedGames = games;
    lastCacheTime = Date.now();
    await saveGameCache(cachedGames);

    const successCount = cachedGames.length;
    const failedCount = validFiles.length - successCount;
    const counts = countGamesByType(cachedGames);

    log.info(`✅ INDEXAÇÃO CONCLUÍDA!`);
    log.info(`   📊 Estatísticas:`);
    log.info(`   ✅ Total indexado: ${successCount} arquivos`);
    log.info(`   🎮 Jogos base: ${counts.base}`);
    log.info(`   📦 DLCs: ${counts.dlc}`);
    log.info(`   🔄 Updates: ${counts.update}`);
    log.info(`   ❌ Falhas: ${failedCount}`);
    log.info(`   📁 Total de arquivos: ${validFiles.length}`);

    indexingProgress = `Concluído (${counts.base} jogos base, ${counts.dlc} DLCs, ${counts.update} updates)`;
  } catch (e) {
    log.error("FALHA INDEXAÇÃO:", e);
    indexingProgress = `Erro: ${e.message || "Erro desconhecido"}`;
  } finally {
    isIndexing = false;
  }
}

// --- ROTAS DA LOJA ---
// Endpoint principal da API Tinfoil (requer autenticação)
// Funciona na raiz (/) para api.rossetti.eng.br e também em /api para compatibilidade
// Aplica autenticação diretamente na rota da raiz, e /api já tem via app.use
app.get("/", tinfoilAuth, async (req, res) => {
  console.log(`[API] ✅ Autenticação passou, processando requisição GET /`);
  // ✅ Se o cache está vazio, tenta recarregar do banco primeiro (indexação incremental)
  if (cachedGames.length === 0 && !isIndexing) {
    const savedCache = await getGameCache();
    if (savedCache.games.length > 0) {
      cachedGames = savedCache.games;
      lastCacheTime = savedCache.lastUpdate || Date.now();
      log.info(`🔄 Cache recarregado do banco: ${cachedGames.length} jogos`);
    } else {
      // Se o banco também está vazio, inicia indexação completa
      buildGameIndex();
    }
  }

  if (isIndexing && cachedGames.length === 0) {
    console.log(
      `[API] ⏳ Indexação em andamento, retornando mensagem de espera`
    );
    return res.json({
      success: `Loja Iniciando... (${indexingProgress})`,
      files: [],
    });
  }

  // Tinfoil lê esse JSON. O campo "id" ajuda ele a achar a capa sozinho no Switch!
  const counts = countGamesByType(cachedGames);
  console.log(`[API] 📦 Retornando ${cachedGames.length} jogos para o Tinfoil`);
  res.setHeader("Content-Type", "application/json");
  const response = {
    files: cachedGames,
    success: `Capivara Shop (${counts.base} jogos base, ${counts.dlc} DLCs, ${counts.update} updates)`,
    stats: counts, // Estatísticas detalhadas
  };
  console.log(`[API] ✅ Resposta enviada com ${cachedGames.length} jogos`);
  res.json(response);
});

// Rota /api também (compatibilidade - middleware já aplicado via app.use)
app.get(["/api", "/api/"], async (req, res) => {
  // ✅ Se o cache está vazio, tenta recarregar do banco primeiro (indexação incremental)
  if (cachedGames.length === 0 && !isIndexing) {
    const savedCache = await getGameCache();
    if (savedCache.games.length > 0) {
      cachedGames = savedCache.games;
      lastCacheTime = savedCache.lastUpdate || Date.now();
      log.info(`🔄 Cache recarregado do banco: ${cachedGames.length} jogos`);
    } else {
      // Se o banco também está vazio, inicia indexação completa
      buildGameIndex();
    }
  }

  if (isIndexing && cachedGames.length === 0) {
    return res.json({
      success: `Loja Iniciando... (${indexingProgress})`,
      files: [],
    });
  }

  // Tinfoil lê esse JSON. O campo "id" ajuda ele a achar a capa sozinho no Switch!
  const counts = countGamesByType(cachedGames);
  res.setHeader("Content-Type", "application/json");
  res.json({
    files: cachedGames,
    success: `Capivara Shop (${counts.base} jogos base, ${counts.dlc} DLCs, ${counts.update} updates)`,
    stats: counts, // Estatísticas detalhadas
  });
});

// Endpoint para forçar indexação (requer autenticação Tinfoil)
// Protegido pelo middleware tinfoilAuth aplicado em /api
// A rota /refresh também funciona (mantida para compatibilidade)
app.get("/refresh", tinfoilAuth, (req, res) => {
  buildGameIndex();
  res.json({ success: true, message: "Indexação iniciada." });
});

// Endpoint bridge para forçar indexação (requer JWT - apenas admin)
app.post("/bridge/refresh-index", requireAuth, (req, res) => {
  // Verifica se é admin
  if (req.user.role !== "admin") {
    return res
      .status(403)
      .json({ error: "Apenas administradores podem forçar indexação" });
  }
  buildGameIndex();
  res.json({ success: true, message: "Indexação iniciada." });
});

// Endpoint para o Dashboard (Site)
app.get("/bridge/games", requireAuth, (req, res) => {
  const counts = countGamesByType(cachedGames);
  res.json({
    games: cachedGames,
    stats: counts, // Estatísticas para o dashboard
  });
});

// ✅ Sistema de Eventos: "Ouvido" para sincronização automática
// Quando o bridge gritar, a gente recarrega o cache do banco para a RAM
bridgeEvents.on("new_game_indexed", async () => {
  log.info("🔔 Notificação recebida: Recarregando cache em memória...");
  await refreshCacheFromDB();
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
  app.listen(PORT, "0.0.0.0", () => {
    log.info(`🚀 Mana Shop rodando na porta ${PORT}`);
    log.info(`🌐 Servidor escutando em todas as interfaces (0.0.0.0:${PORT})`);
    log.info(`📡 Endpoints disponíveis:`);
    log.info(`   - GET / (Tinfoil API - requer auth)`);
    log.info(`   - GET /api (Tinfoil API - requer auth)`);
    log.info(`   - GET /health (público)`);
    log.info(`   - GET /indexing-status (público)`);
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
