import { validateTinfoilCredentials } from "./database.js";

export async function tinfoilAuth(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return res
      .status(401)
      .set("WWW-Authenticate", 'Basic realm="Mana Shop"')
      .json({
        error: "Autenticação Necessária. Configure User/Senha no Tinfoil.",
      });
  }

  // Decoda Basic Auth (base64)
  const [scheme, credentials] = authHeader.split(" ");
  if (!/Basic/i.test(scheme)) return res.status(401).send("Auth inválida");

  const [user, pass] = Buffer.from(credentials, "base64").toString().split(":");

  // Valida no Banco de Dados
  const isValid = await validateTinfoilCredentials(user, pass);

  if (isValid) {
    next();
  } else {
    console.log(`[AUTH] 🚫 Tentativa falha Tinfoil: ${user}`);
    // Delay artificial para evitar brute-force
    setTimeout(
      () => res.status(401).json({ error: "Credenciais Inválidas" }),
      1000
    );
  }
}
