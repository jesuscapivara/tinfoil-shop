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
      success: `Mana Shop v13 (Direct CDN)`,
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

// ============== ROTA DOWNLOAD (ARQUITETURA NOVA) ==============
app.get("/download/:filename", async (req, res) => {
  const encodedPath = req.query.data;
  if (!encodedPath) return res.status(400).send("Missing data");

  try {
    const realPath = fromBase64(encodedPath);
    let sharedLink = "";

    // ESTRATÉGIA BLINDADA: Tenta criar link, se já existir, pega o existente.
    try {
      // Tenta criar um link novo
      const response = await dbx.sharingCreateSharedLinkWithSettings({
        path: realPath,
      });
      sharedLink = response.result.url;
    } catch (shareError) {
      // Se der erro "shared_link_already_exists", buscamos o link que já existe
      if (
        shareError.error &&
        shareError.error[".tag"] === "shared_link_already_exists"
      ) {
        const listResponse = await dbx.sharingListSharedLinks({
          path: realPath,
          direct_only: true,
        });
        if (listResponse.result.links.length > 0) {
          sharedLink = listResponse.result.links[0].url;
        } else {
          throw new Error("Falha ao recuperar link existente.");
        }
      } else {
        throw shareError;
      }
    }

    // TRANSFORMAÇÃO MÁGICA PARA CDN (DIRECT DOWNLOAD)
    // Link original: https://www.dropbox.com/s/xyz/game.nsp?dl=0
    // Link CDN:      https://dl.dropboxusercontent.com/s/xyz/game.nsp

    // 1. Troca o dominio
    let directLink = sharedLink.replace(
      "www.dropbox.com",
      "dl.dropboxusercontent.com"
    );

    // 2. Remove parâmetros antigos (?dl=0)
    directLink = directLink.split("?")[0];

    // 3. Log para validação
    log.info(`🔗 CDN Link: ${directLink}`);

    // 4. Redirect
    res.setHeader("Content-Type", "application/octet-stream");
    res.redirect(302, directLink);
  } catch (error) {
    log.error(`❌ Download Error:`, error);
    res.status(500).send("Erro ao gerar link CDN.");
  }
});

app.listen(PORT, () => {
  log.info(`🚀 Mana Shop v13 rodando na porta ${PORT}`);
});
