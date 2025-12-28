import express from "express";
import { Dropbox } from "dropbox";
import fetch from "isomorphic-fetch";
import dotenv from "dotenv";

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
    log.warn("Indexação já está rodando. Ignorando solicitação.");
    return;
  }

  isIndexing = true;
  indexingProgress = "Iniciando Scan...";
  const startTime = Date.now();

  log.info("🚀 INICIANDO INDEXAÇÃO COMPLETA (BACKGROUND TASK)...");

  try {
    // 1. Escaneamento Recursivo
    let allFiles = [];
    let response = await dbx.filesListFolder({
      path: ROOT_GAMES_FOLDER,
      recursive: true,
      limit: 2000,
    });
    allFiles = allFiles.concat(response.result.entries);

    while (response.result.has_more) {
      log.info("...buscando mais arquivos...");
      response = await dbx.filesListFolderContinue({
        cursor: response.result.cursor,
      });
      allFiles = allFiles.concat(response.result.entries);
    }

    const validFiles = allFiles.filter(
      (entry) =>
        entry[".tag"] === "file" && entry.name.match(/\.(nsp|nsz|xci)$/i)
    );

    log.info(
      `📁 Total encontrado: ${validFiles.length} jogos. Iniciando geração de links...`
    );

    // 2. Processamento em Lotes (BATCHING) - A SOLUÇÃO DO CRASH
    // Processa apenas 5 por vez.
    const games = await processInBatches(validFiles, 5, async (file) => {
      const directUrl = await getDirectLink(file.path_lower);
      if (!directUrl) return null;

      const displayName = file.name
        .replace(/\s*\([0-9.]+\s*(GB|MB)\)/gi, "")
        .trim();

      return {
        url: directUrl,
        size: file.size,
        name: displayName,
      };
    });

    // Finalização
    cachedGames = games.filter((g) => g !== null);
    lastCacheTime = Date.now();
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);

    log.info(
      `✅ INDEXAÇÃO CONCLUÍDA em ${duration}s! ${cachedGames.length} jogos prontos.`
    );
    isIndexing = false;
    indexingProgress = "Concluído";
  } catch (e) {
    log.error("FALHA FATAL NA INDEXAÇÃO:", e);
    isIndexing = false;
    indexingProgress = "Erro";
  }
}

// --- ROTAS ---

app.get("/api", (req, res) => {
  // Se o cache estiver vazio e não estiver indexando (ex: crashou antes), força reindex
  if (cachedGames.length === 0 && !isIndexing) {
    buildGameIndex();
  }

  if (isIndexing && cachedGames.length === 0) {
    // Resposta provisória enquanto carrega
    return res.json({
      success: `Mana Shop Iniciando... Aguarde. (${indexingProgress})`,
      files: [],
    });
  }

  res.json({
    files: cachedGames,
    success: `Mana Shop v19 (Online | ${cachedGames.length} jogos)`,
  });
});

// Endpoint para forçar atualização manual se precisar
app.get("/refresh", (req, res) => {
  buildGameIndex();
  res.send("Indexação iniciada em background. Acompanhe os logs.");
});

// --- STARTUP ---

app.listen(PORT, () => {
  log.info(`🚀 Mana Shop v19 rodando na porta ${PORT}`);
  // DISPARA A INDEXAÇÃO IMEDIATAMENTE AO LIGAR O SERVIDOR
  buildGameIndex();
});
