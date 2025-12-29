import { validateTinfoilCredentials, User } from "./database.js";

export async function tinfoilAuth(req, res, next) {
  let user = null;
  let pass = null;

  // 1. Tenta pegar do Header (Padrão HTTP Basic)
  const authHeader = req.headers.authorization;
  if (authHeader && /Basic/i.test(authHeader)) {
    const credentials = authHeader.split(" ")[1];
    try {
      const decoded = Buffer.from(credentials, "base64").toString().split(":");
      user = decoded[0];
      pass = decoded[1];
    } catch (e) {
      console.error("[AUTH] Erro ao decodificar header:", e.message);
    }
  }

  // 2. Tenta pegar da URL (Fallback "Blindado" para Tinfoil)
  // Ex: /api?u=lucas&p=123456
  if (!user && req.query.u && req.query.p) {
    user = req.query.u;
    pass = req.query.p;
    console.log(`[AUTH] 📍 Credenciais via URL: ${user}`);
  }

  // 3. Se não achou credenciais em lugar nenhum
  if (!user || !pass) {
    console.log(`[AUTH] ⚠️ Acesso sem credenciais: ${req.ip}`);
    // Importante: NÃO retornamos 401 puro se tiver parâmetro de URL falho,
    // pois o Tinfoil pode travar. Retornamos erro JSON direto.
    return res.status(401).json({
      error:
        "Autenticação Necessária. Use user/pass no Tinfoil ou ?u=user&p=pass na URL.",
    });
  }

  // 4. Valida no Banco de Dados
  try {
    // Busca usuário (case insensitive para user)
    const foundUser = await User.findOne({
      tinfoilUser: user.toLowerCase(),
      tinfoilPass: pass,
    });

    if (foundUser) {
      if (foundUser.isApproved) {
        console.log(`[AUTH] ✅ Acesso autorizado: ${user}`);
        next(); // ✅ SUCESSO
      } else {
        console.log(`[AUTH] 🚫 Usuário pendente: ${user}`);
        res.status(403).json({ error: "Conta aguardando aprovação." });
      }
    } else {
      console.log(`[AUTH] 🚫 Credenciais inválidas: ${user}`);
      res.status(401).json({ error: "Credenciais Inválidas" });
    }
  } catch (err) {
    console.error("[AUTH] Erro DB:", err);
    res.status(500).json({ error: "Erro interno" });
  }
}
