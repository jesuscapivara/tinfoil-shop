import express from "express";
import { Dropbox } from "dropbox";
import fetch from "isomorphic-fetch"; // Necessário para o Stream
import dotenv from "dotenv";
import https from "https"; // Agente HTTPS otimizado

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

// Aumenta o Timeout global do servidor para downloads longos
const server = app.listen(PORT, () => {
  log.info(`🚀 Mana Shop v16 (Proxy Stream) rodando na porta ${PORT}`);
});
server.setTimeout(0); // Sem timeout

app.use((req, res, next) => {
  // Timeout infinito para a requisição
  req.setTimeout(0);
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
    const protocol = req.secure ? "https" : "https";
    const baseUrl = `${protocol}://${host}`;

    const tinfoilJson = {
      files: [],
      success: `Mana Shop v16 (Streaming)`,
    };

    files.forEach((file) => {
      const displayName = file.name
        .replace(/\s*\([0-9.]+\s*(GB|MB)\)/gi, "")
        .trim();
      // Nova estrutura de URL: Dados no Path, não na Query
      // Isso evita que o Tinfoil corte os parâmetros
      const safeUrlName = displayName.replace(/[^a-zA-Z0-9.-]/g, "_");
      const path64 = encodeURIComponent(toBase64(file.path_lower));

      // Ex: /download/BASE64_DATA/GameName.nsp
      const downloadUrl = `${baseUrl}/download/${path64}/${safeUrlName}`;

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

// ============== ROTA DOWNLOAD (STREAMING TÚNEL) ==============
// Agora aceita parâmetros via PATH: /download/:data/:filename
app.get("/download/:data/:filename", async (req, res) => {
  const encodedPath = req.params.data;
  if (!encodedPath) return res.status(400).send("Missing data");

  try {
    const realPath = fromBase64(decodeURIComponent(encodedPath));
    let directLink = "";

    // 1. Obtém Link (Lógica SCL mantida)
    const listResponse = await dbx.sharingListSharedLinks({ path: realPath });
    let sharedLink = "";
    if (listResponse.result.links.length > 0) {
      sharedLink = listResponse.result.links[0].url;
    } else {
      const createResponse = await dbx.sharingCreateSharedLinkWithSettings({
        path: realPath,
      });
      sharedLink = createResponse.result.url;
    }

    const cdnUrl = new URL(sharedLink);
    cdnUrl.hostname = "dl.dropboxusercontent.com";
    cdnUrl.searchParams.delete("dl");
    cdnUrl.searchParams.delete("preview");
    directLink = cdnUrl.toString();

    log.info(`🌊 Iniciando Stream Proxy do arquivo: ${req.params.filename}`);

    // 2. O GRANDE TRUQUE: STREAMING (PIPE)
    // Em vez de redirect (res.redirect), nós baixamos e repassamos.

    // Faz a requisição ao Dropbox
    const dropBoxReq = fetch(directLink);

    dropBoxReq
      .then((response) => {
        if (!response.ok)
          throw new Error(`Dropbox respondeu ${response.status}`);

        // Copia os headers importantes (Tamanho e Tipo)
        res.setHeader("Content-Length", response.headers.get("content-length"));
        res.setHeader("Content-Type", "application/octet-stream");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="${req.params.filename}"`
        );

        // Conecta o cano: Dropbox Body -> Resposta para o Tinfoil
        if (response.body && typeof response.body.pipe === "function") {
          // Node-fetch v2 style
          response.body.pipe(res);
        } else {
          // Node-fetch v3 / Web Streams adaptation (caso necessario)
          // Mas isomorphic-fetch geralmente age como node stream no backend
          response.body.pipe(res);
        }

        response.body.on("error", (e) => {
          log.error("Erro no stream do Dropbox:", e);
          res.end();
        });

        res.on("finish", () => {
          log.info("✅ Download/Stream concluído com sucesso.");
        });
      })
      .catch((err) => {
        log.error("Erro ao conectar no Dropbox para stream:", err);
        if (!res.headersSent)
          res.status(502).send("Bad Gateway - Dropbox connection failed");
      });
  } catch (error) {
    log.error(`❌ Erro Geral:`, error);
    if (!res.headersSent) res.status(500).send("Erro interno.");
  }
});
