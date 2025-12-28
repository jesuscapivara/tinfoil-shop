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

// Logs simplificados para produção
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

app.use((req, res, next) => {
  req.setTimeout(60000);
  // Log apenas de erros ou downloads para não poluir
  if (req.url.includes("/download")) log.info(`📥 Req: ${req.url}`);
  next();
});

const toBase64 = (str) => Buffer.from(str).toString("base64");
const fromBase64 = (str) => Buffer.from(str, "base64").toString("utf-8");

async function getAllFilesFromDropbox() {
  const now = Date.now();
  if (fileCache && now - lastCacheTime < CACHE_DURATION) {
    return fileCache;
  }

  log.info("🔄 Refreshing Dropbox Cache...");
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
        entry[".tag"] === "file" && entry.name.match(/\.(nsp|nsz|xci)$/i)
    );

    fileCache = validFiles;
    lastCacheTime = now;
    log.info(`✅ Cache atualizado: ${validFiles.length} jogos.`);
    return validFiles;
  } catch (e) {
    log.error("Erro no Scan Dropbox:", e);
    return [];
  }
}

// ============== ROTA API (JSON) ==============
app.get("/api", async (req, res) => {
  try {
    const files = await getAllFilesFromDropbox();
    const protocol = process.env.DOMINIO ? "https" : "http";

    const tinfoilJson = {
      files: [],
      success: "Mana Shop v9 (Stable)",
    };

    files.forEach((file) => {
      // 1. NOME LIMPO PARA A UI (Display Name)
      // Remove tamanhos desnecessários ex: "(4.GB)"
      const displayName = file.name
        .replace(/\s*\([0-9.]+\s*(GB|MB)\)/gi, "")
        .trim();

      // 2. NOME SEGURO PARA A URL (Slug)
      // Substitui qualquer coisa que não seja letra, numero ou ponto por underline
      // Ex: "Hades 2 [v0].nsp" vira "Hades_2__v0_.nsp"
      // Isso evita erro 400/404 em proxies chatos
      const safeUrlName = displayName.replace(/[^a-zA-Z0-9.-]/g, "_");

      // 3. BASE64 SEGURO
      // Importante: encodeURIComponent no Base64 para preservar o caractere "+"
      const path64 = encodeURIComponent(toBase64(file.path_lower));

      const downloadUrl = `${protocol}://${DOMAIN}/download/${safeUrlName}?data=${path64}`;

      tinfoilJson.files.push({
        url: downloadUrl,
        size: file.size,
        name: displayName, // Mantém [TitleID] para a capa funcionar
      });
    });

    res.json(tinfoilJson);
  } catch (error) {
    log.error("Erro API /api:", error);
    res.status(500).json({ error: "Erro interno" });
  }
});

// ============== ROTA DOWNLOAD ==============
app.get("/download/:filename", async (req, res) => {
  const encodedPath = req.query.data;
  if (!encodedPath) return res.status(400).send("Missing data");

  try {
    const realPath = fromBase64(encodedPath);

    // Pega link cru
    const tempLink = await dbx.filesGetTemporaryLink({ path: realPath });
    let finalLink = tempLink.result.link;

    // Removemos o dl=1 forçado e removemos headers complexos
    // Vamos deixar o Tinfoil lidar com o redirect nativamente
    // Alguns servidores Dropbox já mandam o header correto no link temporário

    log.info(`Redirecting to: ${finalLink.substring(0, 50)}...`);
    res.redirect(302, finalLink);
  } catch (error) {
    log.error(`Erro: ${error.message}`);
    res.status(500).send("Erro");
  }
});

// ROTA DE TESTE DE SANIDADE
app.get('/test-download', (req, res) => {
    // Redireciona para uma imagem qualquer da internet só pra testar o redirect
    // Se o Tinfoil conseguir baixar/abrir (vai dar erro de nsp invalido, mas não "Failed to Open"),
    // significa que a ponte está funcionando.
    log.info('🧪 Teste de Sanidade acionado');
    res.redirect(302, 'https://github.com/blawar/nut/raw/master/nut.png'); 
});

// Rota para debug rápido no navegador
app.get("/", (req, res) =>
  res.send("Mana Shop v9 Online. Acesse /api no Tinfoil.")
);

app.listen(PORT, () => {
  log.info(`🚀 Mana Shop v9 rodando na porta ${PORT}`);
});
