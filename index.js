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
};

const dbx = new Dropbox({
  clientId: process.env.DROPBOX_APP_KEY,
  clientSecret: process.env.DROPBOX_APP_SECRET,
  refreshToken: process.env.DROPBOX_REFRESH_TOKEN,
  fetch,
});

const app = express();
app.enable("trust proxy");

app.use((req, res, next) => {
  req.setTimeout(60000);
  next();
});

// CACHE PODEROSO
// Agora o cache guarda não só o nome, mas o LINK FINAL do Dropbox
let cachedGames = [];
let lastCacheTime = 0;
const CACHE_DURATION = 30 * 60 * 1000; // 30 minutos

// Função auxiliar para gerar link CDN
async function getDirectLink(path) {
  try {
    let sharedLink = "";
    // 1. Tenta listar links existentes
    const listResponse = await dbx.sharingListSharedLinks({ path: path });

    if (listResponse.result.links.length > 0) {
      sharedLink = listResponse.result.links[0].url;
    } else {
      // 2. Se não existir, cria
      const createResponse = await dbx.sharingCreateSharedLinkWithSettings({
        path: path,
      });
      sharedLink = createResponse.result.url;
    }

    // 3. Converte para CDN Direct (mantendo rlkey)
    const cdnUrl = new URL(sharedLink);
    cdnUrl.hostname = "dl.dropboxusercontent.com";
    cdnUrl.searchParams.delete("dl");
    cdnUrl.searchParams.delete("preview");

    return cdnUrl.toString();
  } catch (e) {
    log.error(`Falha ao gerar link para ${path}:`, e);
    return null;
  }
}

async function refreshGameList() {
  const now = Date.now();
  // Retorna cache se estiver quente
  if (cachedGames.length > 0 && now - lastCacheTime < CACHE_DURATION) {
    return cachedGames;
  }

  log.info(
    "🔄 Atualizando Lista e Gerando Links (Isso pode demorar um pouco)..."
  );
  let allFiles = [];

  // 1. Escaneia arquivos
  try {
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

    log.info(
      `📁 Encontrados ${validFiles.length} jogos. Gerando links diretos...`
    );

    // 2. Gera link direto para CADA jogo
    // Usamos Promise.all para fazer em paralelo (mais rápido)
    const processedGames = await Promise.all(
      validFiles.map(async (file) => {
        const directLink = await getDirectLink(file.path_lower);

        if (!directLink) return null; // Pula se der erro

        const displayName = file.name
          .replace(/\s*\([0-9.]+\s*(GB|MB)\)/gi, "")
          .trim();

        return {
          // AQUI ESTÁ A MÁGICA: O JSON JÁ VAI COM O LINK DO DROPBOX
          // O Tinfoil vai baixar direto daqui. Sem redirects da Discloud.
          url: directLink,
          size: file.size,
          name: displayName,
        };
      })
    );

    // Remove nulos
    cachedGames = processedGames.filter((g) => g !== null);
    lastCacheTime = now;

    log.info(`✅ Cache atualizado com ${cachedGames.length} jogos prontos.`);
    return cachedGames;
  } catch (e) {
    log.error("Erro fatal no Scan:", e);
    return [];
  }
}

// ============== ROTA API (AGORA É A ÚNICA QUE IMPORTA) ==============
app.get("/api", async (req, res) => {
  try {
    // Aumenta timeout desta rota específica pois ela pode demorar gerando links
    req.setTimeout(120000);

    const games = await refreshGameList();

    const tinfoilJson = {
      files: games,
      success: "Mana Shop v18 (Direct Architecture)",
    };

    res.json(tinfoilJson);
  } catch (error) {
    log.error("API Error:", error);
    res.status(500).json({ error: "Server Error" });
  }
});

app.listen(PORT, () => {
  log.info(`🚀 Mana Shop v18 (Direct Link) rodando na porta ${PORT}`);
});
