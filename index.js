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

// ============== DEBUG HELPERS ==============
const log = {
  info: (msg, data = "") =>
    console.log(`[INFO] ${new Date().toISOString()} | ${msg}`, data),
  warn: (msg, data = "") =>
    console.warn(`[WARN] ${new Date().toISOString()} | ${msg}`, data),
  error: (msg, data = "") =>
    console.error(`[ERROR] ${new Date().toISOString()} | ${msg}`, data),
  debug: (msg, data = "") =>
    console.log(`[DEBUG] ${new Date().toISOString()} | ${msg}`, data),
};

// ============== INICIALIZAÇÃO ==============
log.info("========================================");
log.info("🚀 MANA SHOP v8 (Debug Mode) INICIANDO");
log.info("========================================");
log.info(`📁 Pasta raiz: ${ROOT_GAMES_FOLDER}`);
log.info(`🌐 Domínio configurado: ${DOMAIN}`);
log.info(
  `🔑 Dropbox App Key: ${
    process.env.DROPBOX_APP_KEY ? "✅ Configurada" : "❌ FALTANDO"
  }`
);
log.info(
  `🔑 Dropbox App Secret: ${
    process.env.DROPBOX_APP_SECRET ? "✅ Configurada" : "❌ FALTANDO"
  }`
);
log.info(
  `🔑 Dropbox Refresh Token: ${
    process.env.DROPBOX_REFRESH_TOKEN ? "✅ Configurada" : "❌ FALTANDO"
  }`
);

const dbx = new Dropbox({
  clientId: process.env.DROPBOX_APP_KEY,
  clientSecret: process.env.DROPBOX_APP_SECRET,
  refreshToken: process.env.DROPBOX_REFRESH_TOKEN,
  fetch,
});

const app = express();

// Middleware de logging para TODAS as requisições
app.use((req, res, next) => {
  req.setTimeout(60000);
  log.info(
    `📥 ${req.method} ${req.url}`,
    `| IP: ${req.ip || req.connection.remoteAddress}`
  );
  next();
});

// Funções de apoio Base64
const toBase64 = (str) => Buffer.from(str).toString("base64");
const fromBase64 = (str) => Buffer.from(str, "base64").toString("utf-8");

async function getAllFilesFromDropbox() {
  const now = Date.now();

  // Verifica cache
  if (fileCache && now - lastCacheTime < CACHE_DURATION) {
    const cacheAge = Math.round((now - lastCacheTime) / 1000);
    log.info(
      `📦 Usando CACHE (${fileCache.length} arquivos, idade: ${cacheAge}s)`
    );
    return fileCache;
  }

  log.info("🔄 Iniciando scan recursivo do Dropbox...");
  const startTime = Date.now();
  let allFiles = [];

  try {
    let response = await dbx.filesListFolder({
      path: ROOT_GAMES_FOLDER,
      recursive: true,
      limit: 2000,
    });
    allFiles = allFiles.concat(response.result.entries);
    log.debug(`   Lote 1: ${response.result.entries.length} itens`);

    let batchCount = 1;
    while (response.result.has_more) {
      batchCount++;
      response = await dbx.filesListFolderContinue({
        cursor: response.result.cursor,
      });
      allFiles = allFiles.concat(response.result.entries);
      log.debug(
        `   Lote ${batchCount}: +${response.result.entries.length} itens`
      );
    }

    // Filtra arquivos válidos
    const validFiles = allFiles.filter(
      (entry) =>
        entry[".tag"] === "file" && entry.name.match(/\.(nsp|nsz|xci)$/i)
    );

    const elapsed = Date.now() - startTime;
    log.info(`✅ Scan concluído em ${elapsed}ms`);
    log.info(`   📊 Total de itens encontrados: ${allFiles.length}`);
    log.info(`   🎮 Jogos válidos (.nsp/.nsz/.xci): ${validFiles.length}`);

    // Lista os primeiros 5 jogos como amostra
    if (validFiles.length > 0) {
      log.debug("   📋 Amostra dos primeiros arquivos:");
      validFiles.slice(0, 5).forEach((f, i) => {
        log.debug(
          `      ${i + 1}. ${f.name} (${(f.size / 1024 / 1024 / 1024).toFixed(
            2
          )} GB)`
        );
      });
    }

    fileCache = validFiles;
    lastCacheTime = now;
    return validFiles;
  } catch (e) {
    log.error("❌ Erro no scan do Dropbox:", e.message);
    log.error("   Stack:", e.stack);
    return [];
  }
}

// ============== ROTA DE HEALTH CHECK ==============
app.get("/health", (req, res) => {
  const status = {
    status: "online",
    version: "v8-debug",
    cache: fileCache ? `${fileCache.length} arquivos` : "vazio",
    cacheAge: fileCache
      ? `${Math.round((Date.now() - lastCacheTime) / 1000)}s`
      : "N/A",
    uptime: `${Math.round(process.uptime())}s`,
  };
  log.info("💓 Health check:", JSON.stringify(status));
  res.json(status);
});

// ============== ROTA API (JSON para Tinfoil) ==============
app.get("/api", async (req, res) => {
  log.info("🎮 Requisição /api recebida (Tinfoil JSON)");

  try {
    const files = await getAllFilesFromDropbox();
    const protocol = process.env.DOMINIO ? "https" : "http";

    if (files.length === 0) {
      log.warn("⚠️ Nenhum arquivo encontrado! Retornando JSON vazio.");
    }

    const tinfoilJson = {
      files: [],
      success: "Mana Shop v8 (Debug)",
    };

    files.forEach((file, index) => {
      // SANITIZAÇÃO: Remove "(X.XX GB)" ou "(X.XX MB)" do nome
      const cleanName = file.name.replace(/\s*\([0-9.]+\s*(GB|MB)\)/gi, "");

      const safeFileName = encodeURIComponent(cleanName);
      const path64 = toBase64(file.path_lower);
      const downloadUrl = `${protocol}://${DOMAIN}/download/${safeFileName}?data=${path64}`;

      // Log detalhado para os primeiros 3 arquivos
      if (index < 3) {
        log.debug(`   📄 Arquivo ${index + 1}:`);
        log.debug(`      Original: ${file.name}`);
        log.debug(`      Limpo: ${cleanName}`);
        log.debug(`      URL: ${downloadUrl.substring(0, 80)}...`);
        log.debug(`      Size: ${file.size} bytes`);
      }

      tinfoilJson.files.push({
        url: downloadUrl,
        size: file.size,
        name: cleanName,
      });
    });

    log.info(`✅ JSON gerado com ${tinfoilJson.files.length} arquivos`);
    res.json(tinfoilJson);
  } catch (error) {
    log.error("❌ Erro na rota /api:", error.message);
    log.error("   Stack:", error.stack);
    res.status(500).json({ error: "Erro API", details: error.message });
  }
});

// ============== ROTA DOWNLOAD ==============
app.get("/download/:filename", async (req, res) => {
  const filename = req.params.filename;
  const encodedPath = req.query.data;

  log.info(`📥 Download solicitado: ${decodeURIComponent(filename)}`);

  if (!encodedPath) {
    log.error("❌ Parâmetro 'data' ausente na URL!");
    return res.status(400).send("Missing data parameter");
  }

  try {
    const realPath = fromBase64(encodedPath);
    log.debug(`   📂 Path decodificado: ${realPath}`);

    log.debug("   🔗 Gerando link temporário do Dropbox...");
    const tempLink = await dbx.filesGetTemporaryLink({ path: realPath });

    log.info(`   ✅ Link gerado! Redirecionando...`);
    log.debug(`   🔗 Link: ${tempLink.result.link.substring(0, 60)}...`);

    res.redirect(302, tempLink.result.link);
  } catch (error) {
    log.error(`❌ Erro no download de "${filename}":`, error.message);

    if (error.error) {
      log.error("   Dropbox error:", JSON.stringify(error.error));
    }

    // Erros comuns do Dropbox
    if (error.status === 409) {
      log.error("   ⚠️ Arquivo não encontrado no Dropbox! Verifique o path.");
    } else if (error.status === 401) {
      log.error("   ⚠️ Token expirado ou inválido!");
    }

    res.status(500).send(`Erro ao gerar link: ${error.message}`);
  }
});

// ============== ROTA 404 ==============
app.use((req, res) => {
  log.warn(`⚠️ Rota não encontrada: ${req.method} ${req.url}`);
  res.status(404).send("Rota não encontrada");
});

// ============== START SERVER ==============
app.listen(PORT, async () => {
  log.info("========================================");
  log.info(`🚀 SERVIDOR ONLINE na porta ${PORT}`);
  log.info("========================================");
  log.info("📌 Rotas disponíveis:");
  log.info(`   GET /api     → JSON para Tinfoil`);
  log.info(`   GET /health  → Status do servidor`);
  log.info(`   GET /download/:file → Download de arquivos`);
  log.info("========================================");

  // Faz um scan inicial para popular o cache
  log.info("🔄 Executando scan inicial do Dropbox...");
  const files = await getAllFilesFromDropbox();
  if (files.length > 0) {
    log.info(`✅ Cache populado com ${files.length} jogos!`);
  } else {
    log.warn("⚠️ Nenhum jogo encontrado. Verifique a pasta do Dropbox.");
  }
  log.info("========================================");
  log.info("✅ MANA SHOP PRONTA PARA RECEBER CONEXÕES!");
  log.info("========================================");
});
