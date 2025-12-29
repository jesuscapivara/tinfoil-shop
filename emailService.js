/**
 * EMAIL SERVICE - Envio de notificações
 * Mana Shop v1.0
 */

import nodemailer from "nodemailer";
import dotenv from "dotenv";

dotenv.config();

// Configura o transportador com suas variáveis de ambiente
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || "smtp.gmail.com",
  port: parseInt(process.env.SMTP_PORT) || 587,
  secure: false, // true para 465, false para outras portas
  auth: {
    user: process.env.SMTP_USER, // Seu email (ex: capivara@rossetti...)
    pass: process.env.SMTP_PASS, // Sua senha de app
  },
});

const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
const DOMAIN = process.env.DOMINIO || "capivara.rossetti.eng.br";

export async function sendNewUserAlert(newUserEmail) {
  try {
    await transporter.sendMail({
      from: `"Mana Shop" <${process.env.SMTP_USER}>`,
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
  try {
    await transporter.sendMail({
      from: `"Mana Shop" <${process.env.SMTP_USER}>`,
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
