import express from "express";
import { Dropbox } from "dropbox";
import fetch from "isomorphic-fetch";
import dotenv from "dotenv";

// Carrega variáveis locais se não estiver em produção
dotenv.config();

// CONFIGURAÇÃO
const PORT = process.env.PORT || 8080;
const GAMES_FOLDER_PATH = "/Games_Switch"; // Ajuste se sua pasta no Dropbox tiver outro nome
const DOMAIN = process.env.DOMINIO || `localhost:${PORT}`;

// Inicializa o cliente Dropbox com credenciais para Refresh Automático
const dbx = new Dropbox({
  clientId: process.env.DROPBOX_APP_KEY,
  clientSecret: process.env.DROPBOX_APP_SECRET,
  refreshToken: process.env.DROPBOX_REFRESH_TOKEN,
  fetch,
});

const app = express();

// Middleware de Log e Timeout (Evitar que o Tinfoil feche a conexão em listas grandes)
app.use((req, res, next) => {
  req.setTimeout(30000); // 30 segundos
  console.log(
    `[${new Date().toISOString()}] ${req.method} ${req.url} - IP: ${req.ip}`
  );
  next();
});

/**
 * ROTA PRINCIPAL (/) - FILE BROWSER
 */
app.get("/", async (req, res) => {
  try {
    // Lista arquivos recursivamente? Para simplificar e performar, vamos listar apenas a raiz da pasta.
    // Se precisar de recursividade: dbx.filesListFolder({ path: GAMES_FOLDER_PATH, recursive: true })
    const response = await dbx.filesListFolder({ path: GAMES_FOLDER_PATH });

    let html = `
        <!DOCTYPE html>
        <html>
        <head>
            <title>Mana Shop</title>
            <meta charset="utf-8">
        </head>
        <body>
        <h1>Mana Architecture Repository</h1>
        <pre>
        `;

    // Filtra apenas arquivos de Switch
    const validExtensions = [".nsp", ".nsz", ".xci"];

    const files = response.result.entries.filter(
      (entry) =>
        entry[".tag"] === "file" &&
        validExtensions.some((ext) => entry.name.toLowerCase().endsWith(ext))
    );

    if (files.length === 0) {
      html += `Nenhum jogo encontrado na pasta ${GAMES_FOLDER_PATH}.`;
    }

    files.forEach((file) => {
      // Constrói a URL absoluta que o Tinfoil vai requisitar
      // Usamos 'https' forçado se estiver na Discloud
      const protocol = process.env.DOMINIO ? "https" : "http";
      const downloadUrl = `${protocol}://${DOMAIN}/download?path=${encodeURIComponent(
        file.path_lower
      )}`;

      // Layout simples que o Tinfoil parseia fácil
      // Mostramos o tamanho em GB para facilitar
      const sizeGB = (file.size / 1024 / 1024 / 1024).toFixed(2);
      html += `<a href="${downloadUrl}">${file.name}</a>                                      ${sizeGB} GB\n`;
    });

    html += `</pre></body></html>`;

    res.send(html);
  } catch (error) {
    console.error("Erro Dropbox:", error);
    // Retorna erro amigável
    res.status(500).send(`
            <h3>Erro de Conexão com Dropbox</h3>
            <p>Verifique o Refresh Token e as Credenciais.</p>
            <pre>${JSON.stringify(error, null, 2)}</pre>
        `);
  }
});

/**
 * ROTA DE DOWNLOAD (/download)
 * Gera o link temporário e redireciona (302)
 */
app.get("/download", async (req, res) => {
  const filePath = req.query.path;

  if (!filePath) return res.status(400).send("Path inválido.");

  try {
    console.log(`Solicitando link para: ${filePath}`);

    // A SDK gerencia a renovação do token aqui se necessário
    const tempLink = await dbx.filesGetTemporaryLink({ path: filePath });

    // Redirecionamento 302 é crucial. O Switch segue isso e baixa do Dropbox.
    res.redirect(302, tempLink.result.link);
  } catch (error) {
    console.error("Erro ao gerar link:", error);
    res.status(500).send("Erro ao gerar link de download.");
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Mana Shop Online em: http://${DOMAIN}`);
  console.log(`📂 Monitorando pasta: ${GAMES_FOLDER_PATH}`);
});
