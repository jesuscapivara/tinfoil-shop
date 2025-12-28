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

const dbx = new Dropbox({
  clientId: process.env.DROPBOX_APP_KEY,
  clientSecret: process.env.DROPBOX_APP_SECRET,
  refreshToken: process.env.DROPBOX_REFRESH_TOKEN,
  fetch,
});

const app = express();

app.use((req, res, next) => {
  req.setTimeout(60000);
  next();
});

// Funções de apoio Base64
const toBase64 = (str) => Buffer.from(str).toString("base64");
const fromBase64 = (str) => Buffer.from(str, "base64").toString("utf-8");

async function getAllFilesFromDropbox() {
  const now = Date.now();
  if (fileCache && now - lastCacheTime < CACHE_DURATION) return fileCache;

  console.log("🔄 Scan Dropbox...");
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
    console.error("Erro Scan:", e);
    return [];
  }
}

// --- ROTA API (JSON) ---
app.get("/api", async (req, res) => {
  try {
    const files = await getAllFilesFromDropbox();
    const protocol = process.env.DOMINIO ? "https" : "http";

    const tinfoilJson = {
      files: [],
      success: "Mana Shop v7 (Auto-Clean)",
    };

    files.forEach((file) => {
      // SANITIZAÇÃO: Remove "(X.XX GB)" ou "(X.XX MB)" do nome
      // Isso permite que o Tinfoil leia corretamente o [TitleID][Version]
      // Antes: "Hades 2 [0100A...][v0] (4.22 GB).nsz"
      // Depois: "Hades 2 [0100A...][v0].nsz"
      const cleanName = file.name.replace(/\s*\([0-9.]+\s*(GB|MB)\)/gi, "");

      const safeFileName = encodeURIComponent(cleanName);
      const path64 = toBase64(file.path_lower);

      // A URL final fica: https://.../download/Hades%20[v0].nsz?data=XYZ
      const downloadUrl = `${protocol}://${DOMAIN}/download/${safeFileName}?data=${path64}`;

      tinfoilJson.files.push({
        url: downloadUrl,
        size: file.size,
        name: cleanName, // Nome LIMPO para o Tinfoil processar o TitleID
      });
    });

    res.json(tinfoilJson);
  } catch (error) {
    res.status(500).json({ error: "Erro API" });
  }
});

// --- ROTA DOWNLOAD ---
// O Express é esperto. Ele aceita /download/QUALQUER_COISA_AQUI
// Nós ignoramos o nome na URL (que serve só pro Tinfoil ler) e usamos o ?data=
app.get("/download/:filename", async (req, res) => {
  const encodedPath = req.query.data;
  if (!encodedPath) return res.status(400).send("Missing data");

  try {
    const realPath = fromBase64(encodedPath);
    const tempLink = await dbx.filesGetTemporaryLink({ path: realPath });
    res.redirect(302, tempLink.result.link);
  } catch (error) {
    console.error("Download Error:", error);
    res.status(500).send("Erro ao gerar link");
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Mana Shop v7 (Auto-Clean) rodando.`);
});
