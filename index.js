import express from "express";
import { Dropbox } from "dropbox";
import fetch from "isomorphic-fetch";
import dotenv from "dotenv";

dotenv.config();

const PORT = process.env.PORT || 8080;
const ROOT_GAMES_FOLDER = "/Games_Switch";
const DOMAIN = process.env.DOMINIO || `localhost:${PORT}`;

// Cache para evitar ban do Dropbox (15 min)
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

// --- FUNÇÃO DE SCAN (Mantida igual) ---
async function getAllFilesFromDropbox() {
  const now = Date.now();
  if (fileCache && now - lastCacheTime < CACHE_DURATION) {
    return fileCache;
  }

  console.log("🔄 Atualizando lista do Dropbox...");
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

    // Filtra apenas arquivos de jogo
    const validFiles = allFiles.filter(
      (entry) =>
        entry[".tag"] === "file" &&
        (entry.name.endsWith(".nsp") ||
          entry.name.endsWith(".nsz") ||
          entry.name.endsWith(".xci"))
    );

    fileCache = validFiles;
    lastCacheTime = now;
    return validFiles;
  } catch (e) {
    console.error("Erro no Scan:", e);
    return [];
  }
}

// --- ROTAS ---

/**
 * ROTA API (/api)
 * Gera o JSON para o Tinfoil
 */
app.get("/api", async (req, res) => {
  try {
    const files = await getAllFilesFromDropbox();
    const protocol = process.env.DOMINIO ? "https" : "http";

    const tinfoilJson = {
      files: [],
      success: "Mana Private Shop Connected",
    };

    files.forEach((file) => {
      // TRUQUE DO NOME NA URL:
      // Adicionamos o nome do arquivo na URL para o Tinfoil reconhecer a extensão (.nsp)
      // O Node.js vai ignorar essa parte do meio e ler só o query param ?path
      const fakePath = encodeURIComponent(file.name);
      const downloadUrl = `${protocol}://${DOMAIN}/file/${fakePath}?path=${encodeURIComponent(
        file.path_lower
      )}`;

      tinfoilJson.files.push({
        url: downloadUrl,
        size: file.size,
        name: file.name, // O nome real para o parser de TitleID
      });
    });

    res.json(tinfoilJson);
  } catch (error) {
    res.status(500).json({ error: "Erro API", details: error });
  }
});

/**
 * ROTA NAVEGADOR (/)
 * Visualização HTML Simples
 */
app.get("/", async (req, res) => {
  const currentPath = req.query.folder || ROOT_GAMES_FOLDER;
  try {
    const response = await dbx.filesListFolder({ path: currentPath });
    const entries = response.result.entries.sort((a, b) =>
      a[".tag"] === "folder" ? -1 : 1
    );

    let html = `<!DOCTYPE html><html><body><pre>`;
    if (currentPath !== ROOT_GAMES_FOLDER)
      html += `<a href="/?folder=${encodeURIComponent(
        ROOT_GAMES_FOLDER
      )}">../</a>\n`;

    const protocol = process.env.DOMINIO ? "https" : "http";

    entries.forEach((entry) => {
      if (entry[".tag"] === "folder") {
        html += `📁 <a href="/?folder=${encodeURIComponent(
          entry.path_lower
        )}">${entry.name}/</a>\n`;
      } else if (entry.name.match(/\.(nsp|nsz|xci)$/i)) {
        // Aplica o mesmo truque de URL no HTML
        const fakePath = encodeURIComponent(entry.name);
        const url = `${protocol}://${DOMAIN}/file/${fakePath}?path=${encodeURIComponent(
          entry.path_lower
        )}`;
        html += `💾 <a href="${url}">${entry.name}</a>\n`;
      }
    });
    html += `</pre></body></html>`;
    res.send(html);
  } catch (e) {
    res.send("Erro: " + e);
  }
});

/**
 * ROTA DOWNLOAD (/file/:filename)
 * O Express pega qualquer coisa que vier depois de /file/
 * Ex: /file/Zelda.nsp -> O servidor aceita, mas ignora o "Zelda.nsp" e foca no ?path
 */
app.get("/file/:filename", async (req, res) => {
  const filePath = req.query.path;

  if (!filePath) return res.status(400).send("Path missing");

  try {
    // Pega o link real do Dropbox
    const tempLink = await dbx.filesGetTemporaryLink({ path: filePath });
    // Redireciona
    res.redirect(302, tempLink.result.link);
  } catch (error) {
    console.error("Download Error:", error);
    res.status(500).send("Link Error");
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Mana Shop v4 (URL Masking) rodando.`);
});
