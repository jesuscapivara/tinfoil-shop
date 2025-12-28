import express from "express";
import { Dropbox } from "dropbox";
import fetch from "isomorphic-fetch";
import dotenv from "dotenv";

dotenv.config();

const PORT = process.env.PORT || 8080;
const ROOT_GAMES_FOLDER = "/Games_Switch";
const DOMAIN = process.env.DOMINIO || `localhost:${PORT}`;

// Cache (15 min)
let fileCache = null;
let lastCacheTime = 0;
const CACHE_DURATION = 15 * 60 * 1000;

// Logs
const log = {
  info: (msg) => console.log(`[INFO] ${msg}`),
  error: (msg, err) => console.error(`[ERROR] ${msg}`, err || ""),
  debug: (msg) => console.log(`[DEBUG] ${msg}`),
};

const dbx = new Dropbox({
  clientId: process.env.DROPBOX_APP_KEY,
  clientSecret: process.env.DROPBOX_APP_SECRET,
  refreshToken: process.env.DROPBOX_REFRESH_TOKEN,
  fetch,
});

const app = express();

app.use((req, res, next) => {
  req.setTimeout(60000);
  if (req.url.includes("/download")) log.info(`📥 Req: ${req.url}`);
  next();
});

const toBase64 = (str) => Buffer.from(str).toString("base64");
const fromBase64 = (str) => Buffer.from(str, "base64").toString("utf-8");

// --- SCAN (Igual ao anterior) ---
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

// ============== ROTA API ==============
app.get("/api", async (req, res) => {
  try {
    const files = await getAllFilesFromDropbox();
    const protocol = process.env.DOMINIO ? "https" : "http";

    const tinfoilJson = {
      files: [],
      success: "Mana Shop v10 (Force DL)",
    };

    files.forEach((file) => {
      const displayName = file.name
        .replace(/\s*\([0-9.]+\s*(GB|MB)\)/gi, "")
        .trim();
      const safeUrlName = displayName.replace(/[^a-zA-Z0-9.-]/g, "_");
      const path64 = encodeURIComponent(toBase64(file.path_lower));

      // Note que filename aqui é cosmético para a URL
      const downloadUrl = `${protocol}://${DOMAIN}/download/${safeUrlName}?data=${path64}`;

      tinfoilJson.files.push({
        url: downloadUrl,
        size: file.size,
        name: displayName,
      });
    });

    res.json(tinfoilJson);
  } catch (error) {
    res.status(500).json({ error: "Erro API" });
  }
});

// ============== ROTA DOWNLOAD (CRÍTICA) ==============
app.get("/download/:filename", async (req, res) => {
  const encodedPath = req.query.data;
  if (!encodedPath) return res.status(400).send("Missing data");

  try {
    const realPath = fromBase64(encodedPath);

    // 1. Gera link
    const tempLink = await dbx.filesGetTemporaryLink({ path: realPath });
    let finalLink = tempLink.result.link;

    // 2. FORÇA O DOWNLOAD (dl=1)
    // Se já tiver query params (tem quase certeza que sim), usa &, senão usa ?
    if (finalLink.includes("?")) {
      finalLink += "&dl=1";
    } else {
      finalLink += "?dl=1";
    }

    // 3. DEBUG LOG (Para você ver no terminal da Discloud)
    log.info(`🔗 LINK GERADO: ${finalLink}`);

    // 4. Headers de arquivo binário (Para o Tinfoil não pensar que é HTML)
    res.setHeader("Content-Type", "application/octet-stream");

    // 5. Redirect
    res.redirect(302, finalLink);
  } catch (error) {
    log.error(`❌ Erro Link:`, error);
    if (error.status === 409) return res.status(404).send("Path not found");
    res.status(500).send("Erro");
  }
});

// Rota de Teste de Sanidade (Mantida para garantir)
app.get("/test-download", (req, res) => {
  res.redirect(302, "https://github.com/blawar/nut/raw/master/nut.png");
});

app.listen(PORT, () => {
  log.info(`🚀 Mana Shop v10 rodando na porta ${PORT}`);
});
