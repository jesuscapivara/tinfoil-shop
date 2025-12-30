/**
 * EMAIL SERVICE - Envio de notificações
 * Mana Shop v1.0
 */

import nodemailer from "nodemailer";
import dotenv from "dotenv";

dotenv.config();

const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
const DOMAIN = process.env.DOMINIO || "capivara.rossetti.eng.br";

// Suporta tanto EMAIL_USER/EMAIL_PASS quanto SMTP_USER/SMTP_PASS
const EMAIL_USER = process.env.EMAIL_USER || process.env.SMTP_USER;
const EMAIL_PASS = process.env.EMAIL_PASS || process.env.SMTP_PASS;

// KingHost SMTPi (SMTP Internacional) - Recomendado para uso fora do Brasil
// Se não especificado, usa SMTPi da KingHost
const USE_SMTPI = process.env.USE_SMTPI !== "false"; // Por padrão usa SMTPi
const SMTP_HOST =
  process.env.SMTP_HOST ||
  (USE_SMTPI ? "smtpi.kinghost.net" : "smtp.kinghost.net");
const SMTP_PORT = parseInt(process.env.SMTP_PORT) || 587; // Porta padrão KingHost: 587 (sem SSL) ou 465 (com SSL)

// Verifica se as credenciais SMTP estão configuradas
const isEmailConfigured = EMAIL_USER && EMAIL_PASS;

// Configura o transportador apenas se as credenciais existirem
let transporter = null;
if (isEmailConfigured) {
  try {
    // Para KingHost: porta 587 = sem SSL, porta 465 = com SSL/TLS
    const secure = SMTP_PORT === 465;

    transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: secure, // true para 465 (SSL/TLS), false para 587 (STARTTLS)
      auth: {
        user: EMAIL_USER,
        pass: EMAIL_PASS,
      },
      // ✅ TLS seguro: valida certificados (removido rejectUnauthorized: false)
      // Se precisar aceitar certificados auto-assinados em desenvolvimento,
      // configure apenas para ambiente local via variável de ambiente
      tls: {
        rejectUnauthorized: process.env.NODE_ENV !== "development", // Valida em produção, permite auto-assinados apenas em dev
      },
    });
    console.log(
      `[EMAIL] ✅ Serviço de e-mail configurado (${SMTP_HOST}:${SMTP_PORT}, ${
        secure ? "SSL/TLS" : "STARTTLS"
      })`
    );
    if (USE_SMTPI) {
      console.log(`[EMAIL] ℹ️ Usando SMTPi (SMTP Internacional) da KingHost`);
    }
  } catch (e) {
    console.error("[EMAIL] ❌ Erro ao configurar transporter:", e.message);
  }
} else {
  console.log("[EMAIL] ⚠️ SMTP não configurado. E-mails não serão enviados.");
  console.log(
    "[EMAIL] ⚠️ Configure EMAIL_USER e EMAIL_PASS (ou SMTP_USER e SMTP_PASS) no .env para habilitar."
  );
}

export async function sendNewUserAlert(newUserEmail) {
  if (!transporter || !isEmailConfigured) {
    console.log(
      `[EMAIL] ⚠️ E-mail não enviado (SMTP não configurado). Novo usuário: ${newUserEmail}`
    );
    return;
  }

  try {
    await transporter.sendMail({
      from: EMAIL_USER,
      to: ADMIN_EMAIL,
      subject: "🔔 Novo Usuário Aguardando Aprovação",
      html: `
                <h3>Nova solicitação de acesso!</h3>
                <p>O usuário <b>${newUserEmail}</b> acabou de se cadastrar.</p>
                <p>Acesse o <a href="https://${DOMAIN}/admin">Painel Admin</a> para aprovar ou rejeitar.</p>
            `,
    });
    console.log(`[EMAIL] ✅ Alerta enviado para admin sobre ${newUserEmail}`);
  } catch (e) {
    console.error("[EMAIL] ❌ Erro ao enviar alerta:", e.message);
  }
}

export async function sendApprovalEmail(userEmail, tinfoilUser, tinfoilPass) {
  if (!transporter || !isEmailConfigured) {
    console.log(
      `[EMAIL] ⚠️ E-mail não enviado (SMTP não configurado). Usuário aprovado: ${userEmail}`
    );
    console.log(
      `[EMAIL] ⚠️ Credenciais Tinfoil: User=${tinfoilUser} Pass=${tinfoilPass}`
    );
    return;
  }

  try {
    await transporter.sendMail({
      from: EMAIL_USER,
      to: userEmail,
      subject: "✅ Seu acesso foi APROVADO!",
      html: `
                <div style="font-family: sans-serif; color: #333;">
                    <h2>Bem-vindo à Mana Shop! 🎮</h2>
                    <p>Sua conta foi aprovada pelo administrador.</p>
                    <hr>
                    <h3>Suas Credenciais Tinfoil:</h3>
                    <p><b>Protocol:</b> https</p>
                    <p><b>Host:</b> ${DOMAIN}</p>
                    <p><b>Username:</b> <code style="background: #f0f0f0; padding: 4px 8px; border-radius: 4px;">${tinfoilUser}</code></p>
                    <p><b>Password:</b> <code style="background: #f0f0f0; padding: 4px 8px; border-radius: 4px;">${tinfoilPass}</code></p>
                    <hr>
                    <p>Configure isso na aba "File Browser" do seu Tinfoil.</p>
                    <p>Você também pode acessar o <a href="https://${DOMAIN}/admin">Painel Web</a> para ver o status da loja e fazer pedidos.</p>
                </div>
            `,
    });
    console.log(`[EMAIL] ✅ Aprovação enviada para ${userEmail}`);
  } catch (e) {
    console.error("[EMAIL] ❌ Erro ao enviar aprovação:", e.message);
  }
}
