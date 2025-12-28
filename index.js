import express from "express";
import { Dropbox } from "dropbox";
import fetch from "isomorphic-fetch";
import dotenv from "dotenv";

dotenv.config();

const PORT = process.env.PORT || 8080;
const ROOT_GAMES_FOLDER = "/Games_Switch";

// Logs
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

// Middleware para confiar no Proxy da Discloud (Importante para req.protocol funcionar)
app.enable("trust proxy");

app.use((req, res, next) => {
  req.setTimeout(60000);
  if (req.url.includes("/download")) log.info(`📥 Req: ${req.url}`);
  next();
});

const toBase64 = (str) => Buffer.from(str).toString("base64");
const fromBase64 = (str) => Buffer.from(str, "base64").toString("utf-8");

// Cache Simples
let fileCache = null;
let lastCacheTime = 0;
const CACHE_DURATION = 15 * 60 * 1000;

async function getAllFilesFromDropbox() {
  const now = Date.now();
  if (fileCache && now - lastCacheTime < CACHE_DURATION) return fileCache;

  log.info("🔄 Atualizando Cache Dropbox...");
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
    log.error("Erro Scan:", e);
    return [];
  }
}

// ============== ROTA API (AUTO-DISCOVERY) ==============
app.get("/api", async (req, res) => {
  try {
    const files = await getAllFilesFromDropbox();

    // AUTO-DISCOVERY: Pega o domínio e protocolo direto da requisição
    // Não depende mais do .env DOMINIO
    const host = req.get("host"); // ex: tinfoilapp.discloud.app
    const protocol = req.protocol; // ex: https

    const baseUrl = `${protocol}://${host}`;

    const tinfoilJson = {
      files: [],
      success: `Mana Shop v11 (Auto-Host: ${host})`,
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
    log.error("Erro API:", error);
    res.status(500).json({ error: "Erro API" });
  }
});

// ============== ROTA DOWNLOAD ==============
app.get("/download/:filename", async (req, res) => {
  const encodedPath = req.query.data;
  if (!encodedPath) return res.status(400).send("Missing data");

  try {
    const realPath = fromBase64(encodedPath);

    // Pega link do Dropbox
    const tempLink = await dbx.filesGetTemporaryLink({ path: realPath });
    let finalLink = tempLink.result.link;

    // Força DL=1 (Download direto)
    if (finalLink.includes("?")) {
      finalLink += "&dl=1";
    } else {
      finalLink += "?dl=1";
    }

    log.info(
      `🔗 Redirecionando para Dropbox: ${finalLink.substring(0, 30)}...`
    );

    // Headers Binários
    res.setHeader("Content-Type", "application/octet-stream");
    res.redirect(302, finalLink);
  } catch (error) {
    log.error(`❌ Erro Link:`, error);
    if (error.status === 409) return res.status(404).send("Path not found");
    res.status(500).send("Erro");
  }
});

app.listen(PORT, () => {
  log.info(`🚀 Mana Shop v11 rodando na porta ${PORT}`);
});
