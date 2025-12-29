import { validateTinfoilCredentials, User } from "./database.js";

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

  // Verifica credenciais E aprovação
  try {
    const foundUser = await User.findOne({
      tinfoilUser: user,
      tinfoilPass: pass,
    });

    if (foundUser) {
      if (foundUser.isApproved) {
        next(); // Sucesso
      } else {
        console.log(`[AUTH] 🚫 Usuário pendente tentou acessar: ${user}`);
        setTimeout(
          () =>
            res
              .status(403)
              .json({ error: "Conta aguardando aprovação do Admin." }),
          1000
        );
      }
    } else {
      console.log(`[AUTH] 🚫 Credenciais inválidas: ${user}`);
      setTimeout(
        () => res.status(401).json({ error: "Credenciais Inválidas" }),
        1000
      );
    }
  } catch (err) {
    console.error("[AUTH] Erro:", err);
    res.status(500).send("Erro interno de auth");
  }
}
