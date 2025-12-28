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
  req.setTimeout(20000);
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

  log.info("🔄 Refreshing Cache...");
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
    const protocol = "https"; // Força HTTPS
    const baseUrl = `${protocol}://${host}`;

    const tinfoilJson = {
      files: [],
      success: `Mana Shop v17 (Link Resolver)`,
    };

    files.forEach((file) => {
      const displayName = file.name
        .replace(/\s*\([0-9.]+\s*(GB|MB)\)/gi, "")
        .trim();
      // Voltamos para query param (?data) que é mais seguro para redirects
      const safeUrlName = displayName.replace(/[^a-zA-Z0-9.-]/g, "_");
      const path64 = encodeURIComponent(toBase64(file.path_lower));

      // Formato v17: /download/NomeDoJogo.nsp?data=...
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

// ============== ROTA DOWNLOAD (RESOLVER) ==============
app.get("/download/:filename", async (req, res) => {
  const encodedPath = req.query.data;
  if (!encodedPath) return res.status(400).send("Missing data");

  try {
    const realPath = fromBase64(encodedPath);
    let sharedLink = "";

    // 1. Obtém Link (SCL com RLKEY)
    const listResponse = await dbx.sharingListSharedLinks({ path: realPath });
    if (listResponse.result.links.length > 0) {
      sharedLink = listResponse.result.links[0].url;
    } else {
      const createResponse = await dbx.sharingCreateSharedLinkWithSettings({
        path: realPath,
      });
      sharedLink = createResponse.result.url;
    }

    // 2. Prepara URL do Dropbox (mantendo rlkey)
    const cdnUrl = new URL(sharedLink);
    cdnUrl.hostname = "dl.dropboxusercontent.com";
    cdnUrl.searchParams.delete("dl");
    cdnUrl.searchParams.delete("preview");
    const initialLink = cdnUrl.toString();

    log.info(`🔍 Resolvendo link final para: ${req.params.filename}`);

    // 3. O PULO DO GATO: Resolver o Redirect no Servidor
    // Fazemos HEAD request com redirect: 'manual' para pegar o header Location
    const headResp = await fetch(initialLink, {
      method: "HEAD",
      redirect: "manual",
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)", // Finge ser browser
      },
    });

    let finalLink = initialLink;

    // Se o Dropbox respondeu com 301/302, pegamos o destino real (uc...)
    if (headResp.status >= 300 && headResp.status < 400) {
      const location = headResp.headers.get("location");
      if (location) {
        finalLink = location;
        log.info('✅ Link final "uc..." encontrado.');
      }
    } else {
      log.info(
        `⚠️ Dropbox não redirecionou (Status ${headResp.status}). Usando link CDN direto.`
      );
    }

    // 4. Redireciona o Tinfoil para o Link Bruto
    // Headers essenciais para o Tinfoil aceitar
    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${req.params.filename}"`
    );
    res.redirect(302, finalLink);
  } catch (error) {
    log.error(`❌ Erro Resolver:`, error);
    res.status(500).send("Erro ao resolver link.");
  }
});

app.listen(PORT, () => {
  log.info(`🚀 Mana Shop v17 rodando na porta ${PORT}`);
});
