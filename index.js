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
  if (req.url.includes("/download")) log.info(`📥 Req: ${req.url}`);
  next();
});

const toBase64 = (str) => Buffer.from(str).toString("base64");
const fromBase64 = (str) => Buffer.from(str, "base64").toString("utf-8");

// Cache
let fileCache = null;
let lastCacheTime = 0;
const CACHE_DURATION = 15 * 60 * 1000;

async function getAllFilesFromDropbox() {
  const now = Date.now();
  if (fileCache && now - lastCacheTime < CACHE_DURATION) return fileCache;

  log.info("🔄 Atualizando Cache...");
  let allFiles = [];
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

    fileCache = validFiles;
    lastCacheTime = now;
    return validFiles;
  } catch (e) {
    log.error("Scan Error:", e);
    return [];
  }
}

// ============== ROTA API ==============
app.get("/api", async (req, res) => {
  try {
    const files = await getAllFilesFromDropbox();
    const host = req.get("host") || process.env.DOMINIO || `localhost:${PORT}`;
    const baseUrl = `https://${host}`;

    const tinfoilJson = {
      files: [],
      success: `Mana Shop v14 (Stability Fix)`,
    };

    files.forEach((file) => {
      const displayName = file.name
        .replace(/\s*\([0-9.]+\s*(GB|MB)\)/gi, "")
        .trim();
      const safeUrlName = displayName.replace(/[^a-zA-Z0-9.-]/g, "_");
      const path64 = encodeURIComponent(toBase64(file.path_lower));

      const downloadUrl = `${baseUrl}/download/${safeUrlName}?data=${path64}`;

      tinfoilJson.files.push({
        url: downloadUrl,
        size: file.size,
        name: displayName,
      });
    });

    res.json(tinfoilJson);
  } catch (error) {
    log.error("API Error:", error);
    res.status(500).json({ error: "Server Error" });
  }
});

// ============== ROTA DOWNLOAD (CORREÇÃO DE LÓGICA) ==============
app.get("/download/:filename", async (req, res) => {
  const encodedPath = req.query.data;
  if (!encodedPath) return res.status(400).send("Missing data");

  try {
    const realPath = fromBase64(encodedPath);
    let sharedLink = "";

    // PASSO 1: VERIFICA SE JÁ EXISTE (Para evitar erro 409)
    const listResponse = await dbx.sharingListSharedLinks({ path: realPath });

    if (listResponse.result.links.length > 0) {
      // Cenário A: Link já existe, pega o primeiro
      sharedLink = listResponse.result.links[0].url;
      log.info("♻️ Link existente reutilizado.");
    } else {
      // Cenário B: Não existe, cria um novo
      log.info("🆕 Criando novo link compartilhado...");
      const createResponse = await dbx.sharingCreateSharedLinkWithSettings({
        path: realPath,
      });
      sharedLink = createResponse.result.url;
    }

    // PASSO 2: CONVERSÃO CDN (www -> dl)
    // Isso garante o download direto sem página HTML
    let directLink = sharedLink.replace(
      "www.dropbox.com",
      "dl.dropboxusercontent.com"
    );
    directLink = directLink.replace("dropbox.com", "dl.dropboxusercontent.com"); // Garantia extra

    // Remove params de tracking (?dl=0)
    directLink = directLink.split("?")[0];

    log.info(`🔗 CDN Link: ${directLink}`);

    // PASSO 3: REDIRECT
    res.setHeader("Content-Type", "application/octet-stream");
    res.redirect(302, directLink);
  } catch (error) {
    log.error(`❌ Erro Crítico:`, error);
    res.status(500).send("Erro ao processar link.");
  }
});

app.listen(PORT, () => {
  log.info(`🚀 Mana Shop v14 rodando na porta ${PORT}`);
});
