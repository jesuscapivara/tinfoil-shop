import { validateTinfoilCredentials, User } from "./database.js";

// Timeout para queries MongoDB (evita travamento)
const DB_TIMEOUT = 5000; // 5 segundos

export async function tinfoilAuth(req, res, next) {
  const authHeader = req.headers.authorization;

  // Se não tem header de autenticação, retorna 401 com WWW-Authenticate
  if (!authHeader) {
    console.log(`[AUTH] 🔒 Requisição sem credenciais: ${req.path}`);
    return res
      .status(401)
      .set("WWW-Authenticate", 'Basic realm="Mana Shop"')
      .json({
        error: "Autenticação Necessária. Configure User/Senha no Tinfoil.",
      });
  }

  // Decoda Basic Auth (base64)
  const [scheme, credentials] = authHeader.split(" ");
  if (!/Basic/i.test(scheme)) {
    console.log(`[AUTH] ❌ Scheme inválido: ${scheme}`);
    return res
      .status(401)
      .set("WWW-Authenticate", 'Basic realm="Mana Shop"')
      .json({ error: "Auth inválida" });
  }

  let user, pass;
  try {
    [user, pass] = Buffer.from(credentials, "base64").toString().split(":");
  } catch (e) {
    console.log(`[AUTH] ❌ Erro ao decodificar credenciais`);
    return res
      .status(401)
      .set("WWW-Authenticate", 'Basic realm="Mana Shop"')
      .json({ error: "Credenciais inválidas" });
  }

  // Verifica credenciais E aprovação com timeout
  try {
    // Cria uma Promise com timeout
    const findUserPromise = User.findOne({
      tinfoilUser: user,
      tinfoilPass: pass,
    });

    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Timeout MongoDB")), DB_TIMEOUT)
    );

    const foundUser = await Promise.race([findUserPromise, timeoutPromise]);

    if (foundUser) {
      if (foundUser.isApproved) {
        console.log(`[AUTH] ✅ Acesso autorizado: ${user}`);
        next(); // Sucesso
      } else {
        console.log(`[AUTH] 🚫 Usuário pendente tentou acessar: ${user}`);
        return res.status(403).json({
          error: "Conta aguardando aprovação do Admin.",
        });
      }
    } else {
      console.log(`[AUTH] 🚫 Credenciais inválidas: ${user}`);
      // IMPORTANTE: Retorna WWW-Authenticate para o Tinfoil pedir senha novamente
      return res
        .status(401)
        .set("WWW-Authenticate", 'Basic realm="Mana Shop"')
        .json({ error: "Credenciais Inválidas" });
    }
  } catch (err) {
    console.error(`[AUTH] ❌ Erro ao verificar credenciais:`, err.message);
    // Em caso de erro (timeout, etc), retorna 401 com WWW-Authenticate
    return res
      .status(401)
      .set("WWW-Authenticate", 'Basic realm="Mana Shop"')
      .json({ error: "Erro ao verificar credenciais. Tente novamente." });
  }
}
