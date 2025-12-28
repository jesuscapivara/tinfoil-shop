import express from "express";
import { Dropbox } from "dropbox";
import fetch from "isomorphic-fetch";
import dotenv from "dotenv";
import path from "path";

dotenv.config();

const PORT = process.env.PORT || 8080;
// A pasta raiz onde tudo começa
const ROOT_GAMES_FOLDER = "/Games_Switch";
const DOMAIN = process.env.DOMINIO || `localhost:${PORT}`;

const dbx = new Dropbox({
  clientId: process.env.DROPBOX_APP_KEY,
  clientSecret: process.env.DROPBOX_APP_SECRET,
  refreshToken: process.env.DROPBOX_REFRESH_TOKEN,
  fetch,
});

const app = express();

app.use((req, res, next) => {
  req.setTimeout(30000);
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

/**
 * ROTA PRINCIPAL (/)
 * Agora aceita um parametro '?folder=' para saber em qual pasta estamos
 */
app.get("/", async (req, res) => {
  // Se não vier parametro folder, usa a raiz.
  // O parametro folder vem da navegação do próprio Tinfoil/Browser
  const currentPath = req.query.folder || ROOT_GAMES_FOLDER;

  try {
    const response = await dbx.filesListFolder({ path: currentPath });

    // Ordena: Pastas primeiro, depois arquivos
    const entries = response.result.entries.sort((a, b) => {
      if (a[".tag"] === b[".tag"]) return a.name.localeCompare(b.name);
      return a[".tag"] === "folder" ? -1 : 1;
    });

    let html = `
        <!DOCTYPE html>
        <html>
        <head>
            <title>Mana Shop</title>
            <meta charset="utf-8">
        </head>
        <body>
        <h1>Index of ${currentPath}</h1>
        <pre>
        `;

    // Adiciona botão de "Voltar" se não estiver na raiz
    if (currentPath !== ROOT_GAMES_FOLDER) {
      // Lógica simples para pegar o pai: remove o último segmento após a barra
      const parentPath = currentPath.substring(0, currentPath.lastIndexOf("/"));
      // Se o pai ficar vazio (bug de string), força a raiz
      const safeParent =
        parentPath.length < ROOT_GAMES_FOLDER.length
          ? ROOT_GAMES_FOLDER
          : parentPath;

      // O link aponta para a própria rota '/' mas muda o parametro folder
      html += `<a href="/?folder=${encodeURIComponent(
        safeParent
      )}">../ (Voltar)</a>\n`;
    }

    const validExtensions = [".nsp", ".nsz", ".xci"];

    entries.forEach((entry) => {
      const protocol = process.env.DOMINIO ? "https" : "http";

      if (entry[".tag"] === "folder") {
        // SE FOR PASTA: O link recarrega a página atual apontando para a nova pasta
        const folderUrl = `${protocol}://${DOMAIN}/?folder=${encodeURIComponent(
          entry.path_lower
        )}`;
        html += `📁 <a href="${folderUrl}">${entry.name}/</a>\n`;
      } else if (entry[".tag"] === "file") {
        // SE FOR ARQUIVO: Verifica extensão e gera link de download
        const isGame = validExtensions.some((ext) =>
          entry.name.toLowerCase().endsWith(ext)
        );

        if (isGame) {
          const downloadUrl = `${protocol}://${DOMAIN}/download?path=${encodeURIComponent(
            entry.path_lower
          )}`;
          const sizeGB = (entry.size / 1024 / 1024 / 1024).toFixed(2);
          html += `💾 <a href="${downloadUrl}">${entry.name}</a>           ${sizeGB} GB\n`;
        }
      }
    });

    html += `</pre></body></html>`;
    res.send(html);
  } catch (error) {
    console.error("Erro:", error);
    res.status(500).send(`Erro ao abrir pasta: ${JSON.stringify(error)}`);
  }
});

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
  console.log(`🚀 Mana Shop v2 (Navigation Mode) rodando.`);
});
