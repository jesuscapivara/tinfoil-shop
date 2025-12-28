import express from "express";
import { Dropbox } from "dropbox";
import fetch from "isomorphic-fetch";
import dotenv from "dotenv";

dotenv.config();

const PORT = process.env.PORT || 8080;
const ROOT_GAMES_FOLDER = "/Games_Switch";
const DOMAIN = process.env.DOMINIO || `localhost:${PORT}`;

// Cache 15 min
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
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// --- FUNÇÕES AUXILIARES ---

// Função segura para codificar/decodificar Base64 (evita problemas com Unicode)
const toBase64 = (str) => Buffer.from(str).toString("base64");
const fromBase64 = (str) => Buffer.from(str, "base64").toString("utf-8");

async function getAllFilesFromDropbox() {
  const now = Date.now();
  if (fileCache && now - lastCacheTime < CACHE_DURATION) {
    return fileCache;
  }

  console.log("🔄 Scan Dropbox iniciado...");
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
    console.log(`✅ Scan OK: ${validFiles.length} jogos.`);
    return validFiles;
  } catch (e) {
    console.error("Erro Scan:", e);
    return [];
  }
}

// --- ROTAS ---

/**
 * ROTA API (/api) - GERA JSON PARA TINFOIL
 */
app.get("/api", async (req, res) => {
  try {
    const files = await getAllFilesFromDropbox();
    const protocol = process.env.DOMINIO ? "https" : "http";

    const tinfoilJson = {
      files: [],
      success: "Mana Shop Online",
    };

    files.forEach((file) => {
      // TRUQUE DO BASE64:
      // 1. Codifica o caminho real do arquivo em Base64 para não quebrar a URL
      // 2. Cria um nome "limpo" para a URL (remove espaços e colchetes APENAS da URL, não do nome exibido)
      // 3. Mantém a extensão correta

      const path64 = toBase64(file.path_lower);
      // Cria um nome de arquivo "fictício" seguro para URL, mas mantendo a extensão
      // Ex: "Hades 2 [v0].nsp" vira "game.nsp" na URL, mas o parametro carrega o dado real
      // O Tinfoil só precisa ver que termina em .nsp

      const ext = file.name.split(".").pop();
      const safeUrlName = `install_game.${ext}`;

      const downloadUrl = `${protocol}://${DOMAIN}/download/${safeUrlName}?data=${path64}`;

      tinfoilJson.files.push({
        url: downloadUrl,
        size: file.size,
        name: file.name, // O nome AQUI deve ser o original com [TitleID] para a capa aparecer
      });
    });

    // Força cabeçalho JSON
    res.setHeader("Content-Type", "application/json");
    res.json(tinfoilJson);
  } catch (error) {
    res.status(500).json({ error: "Erro API" });
  }
});

/**
 * ROTA DOWNLOAD (/download/:fakeName)
 * O :fakeName é ignorado, usamos o query param ?data (Base64)
 */
app.get("/download/:fakeName", async (req, res) => {
  const encodedPath = req.query.data;

  if (!encodedPath) return res.status(400).send("Missing data");

  try {
    // Decodifica o Base64 para pegar o caminho real do Dropbox
    const realPath = fromBase64(encodedPath);
    console.log(`⬇️ Solicitando: ${realPath}`);

    const tempLink = await dbx.filesGetTemporaryLink({ path: realPath });

    // REDIRECT CRÍTICO
    // Tinfoil segue redirects, mas precisa ser rápido.
    res.redirect(302, tempLink.result.link);
  } catch (error) {
    console.error("Erro Link:", error);
    res.status(500).send("Erro ao gerar link");
  }
});

/**
 * ROTA RAIZ (Opcional - Apenas status)
 */
app.get("/", (req, res) => {
  res.send("Mana Shop Backend is Running. Use /api in Tinfoil.");
});

app.listen(PORT, () => {
  console.log(`🚀 Mana Shop v5 (Base64) rodando.`);
});
