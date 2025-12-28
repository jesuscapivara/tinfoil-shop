import express from "express";
import { Dropbox } from "dropbox";
import fetch from "isomorphic-fetch";
import dotenv from "dotenv";

dotenv.config();

// CONFIGURAÇÕES
const PORT = process.env.PORT || 8080;
const ROOT_GAMES_FOLDER = "/Games_Switch";
const DOMAIN = process.env.DOMINIO || `localhost:${PORT}`;

// Cache em Memória (Simples) para evitar estourar limites do Dropbox
// O cache dura 15 minutos.
let fileCache = null;
let lastCacheTime = 0;
const CACHE_DURATION = 15 * 60 * 1000; // 15 min

const dbx = new Dropbox({
  clientId: process.env.DROPBOX_APP_KEY,
  clientSecret: process.env.DROPBOX_APP_SECRET,
  refreshToken: process.env.DROPBOX_REFRESH_TOKEN,
  fetch,
});

const app = express();

app.use((req, res, next) => {
  req.setTimeout(60000); // 60s timeout para listas grandes
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// --- FUNÇÕES AUXILIARES ---

async function getAllFilesFromDropbox() {
  // Se o cache ainda for válido, retorna ele instantaneamente
  const now = Date.now();
  if (fileCache && now - lastCacheTime < CACHE_DURATION) {
    console.log("📦 Usando Cache de Arquivos");
    return fileCache;
  }

  console.log("🔄 Atualizando lista do Dropbox (Scan Recursivo)...");
  let allFiles = [];

  // O parametro recursive: true faz a mágica de pegar subpastas
  let response = await dbx.filesListFolder({
    path: ROOT_GAMES_FOLDER,
    recursive: true,
    limit: 2000, // Aumenta o lote
  });

  allFiles = allFiles.concat(response.result.entries);

  // Paginação: Se tiver mais de 2000 arquivos, continua buscando
  while (response.result.has_more) {
    console.log("...buscando mais arquivos...");
    response = await dbx.filesListFolderContinue({
      cursor: response.result.cursor,
    });
    allFiles = allFiles.concat(response.result.entries);
  }

  // Filtra apenas arquivos válidos
  const validFiles = allFiles.filter(
    (entry) =>
      entry[".tag"] === "file" &&
      (entry.name.endsWith(".nsp") ||
        entry.name.endsWith(".nsz") ||
        entry.name.endsWith(".xci"))
  );

  // Salva no cache
  fileCache = validFiles;
  lastCacheTime = now;
  console.log(`✅ Scan concluído. ${validFiles.length} jogos encontrados.`);

  return validFiles;
}

// --- ROTAS ---

/**
 * ROTA API (/api) - O CÉREBRO DA LOJA
 * Retorna JSON formatado para o Tinfoil popular a aba "New Games"
 */
app.get("/api", async (req, res) => {
  try {
    const files = await getAllFilesFromDropbox();
    const protocol = process.env.DOMINIO ? "https" : "http";

    // Estrutura padrão Tinfoil JSON
    const tinfoilJson = {
      files: [],
      success: "Mana Private Shop Connected",
    };

    files.forEach((file) => {
      // Gera a URL de download apontando para nossa API
      const downloadUrl = `${protocol}://${DOMAIN}/download?path=${encodeURIComponent(
        file.path_lower
      )}`;

      // Adiciona ao JSON
      tinfoilJson.files.push({
        url: downloadUrl, // Tinfoil usa isso para baixar
        size: file.size, // Tamanho em bytes
        name: file.name, // O Tinfoil usa o nome para regex do TitleID e baixar capa
      });
    });

    res.json(tinfoilJson);
  } catch (error) {
    console.error("Erro na API:", error);
    res.status(500).json({ error: "Falha ao gerar índice", details: error });
  }
});

/**
 * ROTA NAVEGADOR (/) - MODO PASTAS
 * Mantivemos essa rota para caso você queira navegar manualmente pelo File Browser
 * Nota: Essa rota NÃO usa o modo recursivo para ser rápida na navegação folder-by-folder
 */
app.get("/", async (req, res) => {
  const currentPath = req.query.folder || ROOT_GAMES_FOLDER;

  try {
    const response = await dbx.filesListFolder({ path: currentPath });

    // Ordena: Pastas primeiro
    const entries = response.result.entries.sort((a, b) => {
      if (a[".tag"] === b[".tag"]) return a.name.localeCompare(b.name);
      return a[".tag"] === "folder" ? -1 : 1;
    });

    let html = `<!DOCTYPE html><html><head><title>Mana Shop</title></head><body><h1>Index of ${currentPath}</h1><pre>`;

    // Botão Voltar
    if (currentPath !== ROOT_GAMES_FOLDER) {
      const parentPath =
        currentPath.substring(0, currentPath.lastIndexOf("/")) ||
        ROOT_GAMES_FOLDER;
      html += `<a href="/?folder=${encodeURIComponent(
        parentPath
      )}">../ (Voltar)</a>\n`;
    }

    const validExtensions = [".nsp", ".nsz", ".xci"];
    const protocol = process.env.DOMINIO ? "https" : "http";

    entries.forEach((entry) => {
      if (entry[".tag"] === "folder") {
        const folderUrl = `${protocol}://${DOMAIN}/?folder=${encodeURIComponent(
          entry.path_lower
        )}`;
        html += `📁 <a href="${folderUrl}">${entry.name}/</a>\n`;
      } else if (
        entry[".tag"] === "file" &&
        validExtensions.some((ext) => entry.name.endsWith(ext))
      ) {
        const downloadUrl = `${protocol}://${DOMAIN}/download?path=${encodeURIComponent(
          entry.path_lower
        )}`;
        const sizeGB = (entry.size / 1024 / 1024 / 1024).toFixed(2);
        html += `💾 <a href="${downloadUrl}">${entry.name}</a>           ${sizeGB} GB\n`;
      }
    });
    html += `</pre></body></html>`;
    res.send(html);
  } catch (error) {
    res.status(500).send(`Erro: ${JSON.stringify(error)}`);
  }
});

/**
 * ROTA DOWNLOAD (/download)
 * Gera link temporário e redireciona
 */
app.get("/download", async (req, res) => {
  const filePath = req.query.path;
  if (!filePath) return res.status(400).send("Path inválido.");

  try {
    const tempLink = await dbx.filesGetTemporaryLink({ path: filePath });
    res.redirect(302, tempLink.result.link);
  } catch (error) {
    console.error("Erro Download:", error);
    res.status(500).send("Erro ao gerar link.");
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Mana Shop v3 (Hybrid JSON/HTML) rodando na porta ${PORT}`);
});
