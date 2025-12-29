/**
 * EMAIL SERVICE - Envio de notificações
 * Mana Shop v1.0
 */

import nodemailer from "nodemailer";
import dotenv from "dotenv";

dotenv.config();

const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
const DOMAIN = process.env.DOMINIO || "capivara.rossetti.eng.br";
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
const SMTP_HOST = process.env.SMTP_HOST || "smtp.gmail.com";
const SMTP_PORT = parseInt(process.env.SMTP_PORT) || 587;

// Verifica se as credenciais SMTP estão configuradas
const isEmailConfigured = SMTP_USER && SMTP_PASS;

// Configura o transportador apenas se as credenciais existirem
let transporter = null;
if (isEmailConfigured) {
  try {
    transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: false, // true para 465, false para outras portas
      auth: {
        user: SMTP_USER,
        pass: SMTP_PASS,
      },
    });
    console.log("[EMAIL] ✅ Serviço de e-mail configurado");
  } catch (e) {
    console.error("[EMAIL] ❌ Erro ao configurar transporter:", e.message);
  }
} else {
  console.log("[EMAIL] ⚠️ SMTP não configurado. E-mails não serão enviados.");
  console.log(
    "[EMAIL] ⚠️ Configure SMTP_USER e SMTP_PASS no .env para habilitar."
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
      from: `"Mana Shop" <${SMTP_USER}>`,
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
      from: `"Mana Shop" <${SMTP_USER}>`,
      to: userEmail,
      subject: "✅ Seu acesso foi APROVADO!",
      html: `
                <div style="font-family: sans-serif; color: #333;">
                    <h2>Bem-vindo à Mana Shop! 🎮</h2>
                    <p>Sua conta foi aprovada pelo administrador.</p>
                    <hr>
                    <h3>Suas Credenciais Tinfoil:</h3>
                    <p><b>Protocol:</b> https</p>
                    <p><b>Host:</b> ${DOMAIN}/api</p>
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
