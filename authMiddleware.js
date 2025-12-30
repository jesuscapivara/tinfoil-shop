import { User } from "./database.js";
import bcrypt from "bcryptjs";

/**
 * CACHE DE AUTENTICAÇÃO (HOT CACHE)
 * Armazena resultados de validação na RAM para evitar flood no MongoDB.
 * Estrutura: { "user:pass": { valid: boolean, expiresAt: number } }
 */
const AUTH_CACHE = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutos de vida para o cache
const MAX_CACHE_SIZE = 1000; // Proteção contra estouro de RAM

function cleanCache() {
  const now = Date.now();
  for (const [key, value] of AUTH_CACHE.entries()) {
    if (now > value.expiresAt) AUTH_CACHE.delete(key);
  }
}

// Limpeza automática a cada 10 minutos
setInterval(cleanCache, 10 * 60 * 1000);

export async function tinfoilAuth(req, res, next) {
  console.log(`[AUTH] 🔍 Requisição recebida: ${req.method} ${req.path}`);
  console.log(`[AUTH] 📋 Headers:`, {
    authorization: req.headers.authorization ? "Presente" : "Ausente",
    "user-agent": req.headers["user-agent"],
  });

  let user = null;
  let pass = null;

  // 1. EXTRAÇÃO DE CREDENCIAIS (Header ou Query)
  const authHeader = req.headers.authorization;

  if (authHeader && /Basic/i.test(authHeader)) {
    try {
      const credentials = authHeader.split(" ")[1];
      const decoded = Buffer.from(credentials, "base64").toString().split(":");
      user = decoded[0];
      pass = decoded[1];
      console.log(`[AUTH] 🔑 Credenciais extraídas do header Basic Auth`);
    } catch (e) {
      console.log(`[AUTH] ⚠️ Erro ao decodificar Basic Auth:`, e.message);
      // Falha silenciosa no decode, segue para query
    }
  }

  // Fallback para URL params (?u=...&p=...)
  if (!user && req.query.u && req.query.p) {
    user = req.query.u;
    pass = req.query.p;
    console.log(`[AUTH] 🔑 Credenciais extraídas dos query params`);
  }

  // 2. REJEIÇÃO RÁPIDA (Sem credenciais)
  if (!user || !pass) {
    console.log(`[AUTH] 🚫 Sem credenciais - retornando 401`);
    // Retornamos JSON direto. HTML trava o Tinfoil.
    return res.status(401).json({
      error: "Capivara Shop: Autenticação necessária (User/Pass)",
    });
  }

  console.log(`[AUTH] 👤 Tentativa de login: ${user}`);

  // Normaliza usuário para evitar duplicidade no cache
  const normalizedUser = user.toLowerCase().trim();
  const cacheKey = `${normalizedUser}:${pass}`;
  const now = Date.now();

  // 3. VERIFICAÇÃO NO CACHE (RAM - Ultra Rápido)
  if (AUTH_CACHE.has(cacheKey)) {
    const cached = AUTH_CACHE.get(cacheKey);

    // Se o cache ainda é válido
    if (now < cached.expiresAt) {
      if (cached.valid) {
        return next(); // ✅ SUCESSO (Cache)
      } else {
        return res
          .status(403)
          .json({ error: cached.errorReason || "Acesso Negado (Cache)" });
      }
    } else {
      // Cache expirou, remove para consultar DB novamente
      AUTH_CACHE.delete(cacheKey);
    }
  }

  // 4. VALIDAÇÃO NO BANCO DE DADOS (Lento - Apenas se não tiver cache)
  try {
    // ✅ Busca APENAS pelo usuário (que é único)
    const foundUser = await User.findOne({
      tinfoilUser: normalizedUser,
    }).lean(); // .lean() é mais rápido, retorna JSON puro sem métodos do Mongoose

    // Lógica de Validação
    let isValid = false;
    let errorReason = "Credenciais Inválidas";

    if (foundUser) {
      // ✅ Compara a senha enviada (pass) com o hash do banco
      const passMatch = await bcrypt.compare(pass, foundUser.tinfoilPass);

      if (passMatch) {
        if (foundUser.isApproved) {
          isValid = true;
        } else {
          errorReason = "Conta aguardando aprovação do admin";
        }
      }
    }

    // 5. SALVA NO CACHE
    // Se o cache estiver cheio, limpa o mais antigo (simples)
    if (AUTH_CACHE.size >= MAX_CACHE_SIZE) AUTH_CACHE.clear();

    AUTH_CACHE.set(cacheKey, {
      valid: isValid,
      errorReason: isValid ? null : errorReason,
      expiresAt: now + CACHE_TTL,
    });

    // 6. RESPOSTA FINAL
    if (isValid) {
      console.log(`[AUTH] ✅ Login (DB): ${normalizedUser}`);
      next();
    } else {
      console.log(
        `[AUTH] 🚫 Bloqueio (DB): ${normalizedUser} - ${errorReason}`
      );
      res.status(403).json({ error: errorReason });
    }
  } catch (err) {
    console.error(`[AUTH] ❌ Erro Crítico DB: ${err.message}`);
    // Em caso de erro no DB, não negamos direto, retornamos 500 para o Tinfoil tentar de novo
    res.status(500).json({
      error: "Erro interno no servidor de autenticação",
    });
  }
}
