/**
 * DATABASE - Conexão e modelos MongoDB
 * Mana Shop v1.1 - Com suporte a Versionamento e TitleID
 */

import mongoose from "mongoose";
import dotenv from "dotenv";
import bcrypt from "bcryptjs";

dotenv.config();

const MONGO_URI = process.env.MONGO_URI;

// ═══════════════════════════════════════════════
// CONEXÃO
// ═══════════════════════════════════════════════

let isConnected = false;

export async function connectDB() {
  if (isConnected) return;

  if (!MONGO_URI) {
    console.log("[DB] ⚠️ MONGO_URI não configurado. Usando apenas memória.");
    return;
  }

  try {
    await mongoose.connect(MONGO_URI);
    isConnected = true;
    console.log("[DB] ✅ MongoDB conectado com sucesso!");
  } catch (err) {
    console.error("[DB] ❌ Erro ao conectar MongoDB:", err.message);
  }
}

export function isDBConnected() {
  return isConnected;
}

// ═══════════════════════════════════════════════
// SCHEMAS & MODELS
// ═══════════════════════════════════════════════

// 1. NOVO SCHEMA DE USUÁRIO
const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true }, // Senha do painel web
  isAdmin: { type: Boolean, default: false },
  isApproved: { type: Boolean, default: false }, // ⚠️ NOVO: Aprovação do admin

  // Credenciais geradas para o Tinfoil
  tinfoilUser: { type: String, required: true, unique: true },
  tinfoilPass: { type: String, required: true },

  createdAt: { type: Date, default: Date.now },
});

export const User = mongoose.model("User", userSchema);

export async function createUser(email, webPassword, isAdmin = false) {
  if (!isConnected) return null;

  // Gera base do username Tinfoil
  const baseUser = email
    .split("@")[0]
    .replace(/[^a-zA-Z0-9]/g, "")
    .toLowerCase();

  // Garante que o tinfoilUser seja único
  let tinfoilUser = baseUser;
  let counter = 1;
  let exists = await User.findOne({ tinfoilUser });

  while (exists) {
    tinfoilUser = `${baseUser}${counter}`;
    exists = await User.findOne({ tinfoilUser });
    counter++;

    // Proteção contra loop infinito
    if (counter > 1000) {
      // Se chegar a 1000, usa hash do email
      tinfoilUser = `user${Buffer.from(email)
        .toString("base64")
        .slice(0, 8)
        .replace(/[^a-zA-Z0-9]/g, "")
        .toLowerCase()}`;
      exists = await User.findOne({ tinfoilUser });
      if (!exists) break;
      // Se ainda existir, adiciona timestamp
      tinfoilUser = `user${Date.now().toString().slice(-8)}`;
      break;
    }
  }

  // ✅ Gera senha Tinfoil em texto plano (apenas para retornar no email)
  const tinfoilPassPlain = Math.random().toString(36).slice(-6).toUpperCase(); // 6 caracteres

  try {
    // Hash das senhas com bcrypt
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(webPassword, salt);
    const tinfoilPassHash = await bcrypt.hash(tinfoilPassPlain, salt); // ✅ Hash da senha Tinfoil

    const user = new User({
      email,
      password: hashedPassword, // ✅ Senha web hasheada com bcrypt
      isAdmin,
      isApproved: isAdmin, // Se for admin, já nasce aprovado. Se for user, nasce pendente.
      tinfoilUser,
      tinfoilPass: tinfoilPassHash, // ✅ Senha Tinfoil hasheada (nunca salva texto plano)
    });
    await user.save();
    console.log(
      `[DB] ✅ Usuário criado: ${email} → tinfoilUser: ${tinfoilUser}`
    );

    // ✅ Retorna a senha plain apenas para o email, nunca salva no banco
    user.tinfoilPassPlain = tinfoilPassPlain;
    return user;
  } catch (err) {
    console.error("[DB] Erro ao criar usuário:", err.message);
    return null;
  }
}

export async function findUserByEmail(email) {
  if (!isConnected) return null;
  return await User.findOne({ email });
}

export async function validateTinfoilCredentials(user, pass) {
  if (!isConnected) return false;
  // Verifica se existe alguém com esse user/pass do Tinfoil E se está aprovado
  const found = await User.findOne({
    tinfoilUser: user,
    tinfoilPass: pass,
    isApproved: true, // ⚠️ Só permite se aprovado
  });
  return !!found;
}

// ═══════════════════════════════════════════════
// FUNÇÕES DE APROVAÇÃO DE USUÁRIOS
// ═══════════════════════════════════════════════

export async function getPendingUsers() {
  if (!isConnected) return [];
  try {
    return await User.find({ isApproved: false, isAdmin: false })
      .sort({ createdAt: -1 })
      .lean();
  } catch (err) {
    console.error("[DB] Erro ao buscar pendentes:", err.message);
    return [];
  }
}

export async function approveUser(id) {
  if (!isConnected) return null;
  try {
    return await User.findByIdAndUpdate(
      id,
      { isApproved: true },
      { new: true }
    );
  } catch (err) {
    console.error("[DB] Erro ao aprovar usuário:", err.message);
    return null;
  }
}

export async function deleteUser(id) {
  if (!isConnected) return null;
  try {
    return await User.findByIdAndDelete(id);
  } catch (err) {
    console.error("[DB] Erro ao deletar usuário:", err.message);
    return null;
  }
}

// Schema para histórico de downloads
const downloadHistorySchema = new mongoose.Schema({
  name: { type: String, required: true },
  files: { type: Number, default: 1 },
  size: { type: String },
  folder: { type: String },
  duration: { type: Number }, // em segundos
  completedAt: { type: Date, default: Date.now },
  source: { type: String, enum: ["magnet", "torrent-file"], default: "magnet" },
});

// ⚠️ ATUALIZAÇÃO CRÍTICA AQUI ⚠️
// Schema para cache de jogos indexados
const gameCacheSchema = new mongoose.Schema({
  url: { type: String, required: true },
  size: { type: Number },
  name: { type: String, required: true },
  id: { type: String }, // Title ID Principal

  // NOVOS CAMPOS PARA TINFOIL RECONHECER JOGO NOVO/UPDATE
  titleId: { type: String }, // Redundância que o Tinfoil gosta
  version: { type: Number, default: 0 }, // Essencial para aba New Games / Updates
  filename: { type: String }, // Nome do arquivo original (para evitar erro de parse na URL)

  path: { type: String },
  indexedAt: { type: Date, default: Date.now },
});

// Schema para metadados do sistema
const systemMetaSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  value: { type: mongoose.Schema.Types.Mixed },
  updatedAt: { type: Date, default: Date.now },
});

export const DownloadHistory = mongoose.model(
  "DownloadHistory",
  downloadHistorySchema
);
export const GameCache = mongoose.model("GameCache", gameCacheSchema);
export const SystemMeta = mongoose.model("SystemMeta", systemMetaSchema);

// ═══════════════════════════════════════════════
// FUNÇÕES AUXILIARES - DOWNLOAD HISTORY
// ═══════════════════════════════════════════════

export async function saveDownloadHistory(data) {
  if (!isConnected) return null;

  try {
    const entry = new DownloadHistory(data);
    await entry.save();
    console.log(`[DB] 📥 Download salvo: ${data.name}`);
    return entry;
  } catch (err) {
    console.error("[DB] Erro ao salvar download:", err.message);
    return null;
  }
}

export async function getDownloadHistory(limit = 50) {
  if (!isConnected) return [];

  try {
    return await DownloadHistory.find()
      .sort({ completedAt: -1 })
      .limit(limit)
      .lean();
  } catch (err) {
    console.error("[DB] Erro ao buscar histórico:", err.message);
    return [];
  }
}

// ═══════════════════════════════════════════════
// FUNÇÕES AUXILIARES - GAME CACHE (ATUALIZADO)
// ═══════════════════════════════════════════════

export async function saveGameCache(games) {
  if (!isConnected) return false;

  try {
    // Limpa cache antigo e insere novo
    await GameCache.deleteMany({});

    if (games.length > 0) {
      await GameCache.insertMany(
        games.map((g) => ({
          url: g.url,
          size: g.size,
          name: g.name,
          id: g.id || null,
          // ⚠️ MAPEAMENTO DOS NOVOS CAMPOS
          titleId: g.titleId || g.id,
          version: g.version || 0,
          filename: g.filename || g.name,

          path: g.path || "",
          indexedAt: new Date(),
        }))
      );
    }

    // Salva timestamp da última indexação
    await SystemMeta.findOneAndUpdate(
      { key: "lastIndexTime" },
      { value: new Date().toISOString(), updatedAt: new Date() },
      { upsert: true }
    );

    console.log(
      `[DB] 📚 Cache atualizado no MongoDB: ${games.length} jogos com metadados.`
    );
    return true;
  } catch (err) {
    console.error("[DB] Erro ao salvar cache:", err.message);
    return false;
  }
}

export async function getGameCache() {
  if (!isConnected) return { games: [], lastUpdate: null };

  try {
    const games = await GameCache.find().lean();
    const meta = await SystemMeta.findOne({ key: "lastIndexTime" }).lean();

    return {
      games: games.map((g) => ({
        url: g.url,
        size: g.size,
        name: g.name,
        id: g.id || null,
        // ⚠️ RETORNO DOS NOVOS CAMPOS PARA O FRONT/TINFOIL
        titleId: g.titleId || g.id,
        version: g.version || 0,
        filename: g.filename || g.name,
      })),
      lastUpdate: meta?.value ? new Date(meta.value).getTime() : null,
    };
  } catch (err) {
    console.error("[DB] Erro ao buscar cache:", err.message);
    return { games: [], lastUpdate: null };
  }
}

// ═══════════════════════════════════════════════
// INDEXAÇÃO INCREMENTAL (Event-Driven)
// ═══════════════════════════════════════════════

export async function addOrUpdateGame(gameData) {
  if (!isConnected) return false;

  try {
    // Upsert: Se existe atualiza, se não existe cria
    await GameCache.findOneAndUpdate(
      { path: gameData.path }, // Busca pelo caminho do arquivo (chave única)
      {
        ...gameData,
        indexedAt: new Date(),
      },
      { upsert: true, new: true }
    );

    // Atualiza o timestamp global para outros serviços saberem que houve mudança
    await SystemMeta.findOneAndUpdate(
      { key: "lastIndexTime" },
      { value: new Date().toISOString(), updatedAt: new Date() },
      { upsert: true }
    );

    console.log(`[DB] 🎯 Jogo indexado incrementalmente: ${gameData.name}`);
    return true;
  } catch (err) {
    console.error("[DB] ❌ Erro na indexação incremental:", err.message);
    return false;
  }
}

// ═══════════════════════════════════════════════
// FUNÇÕES AUXILIARES - SYSTEM META
// ═══════════════════════════════════════════════

export async function setMeta(key, value) {
  if (!isConnected) return false;

  try {
    await SystemMeta.findOneAndUpdate(
      { key },
      { value, updatedAt: new Date() },
      { upsert: true }
    );
    return true;
  } catch (err) {
    console.error("[DB] Erro ao salvar meta:", err.message);
    return false;
  }
}

export async function getMeta(key) {
  if (!isConnected) return null;

  try {
    const doc = await SystemMeta.findOne({ key }).lean();
    return doc?.value || null;
  } catch (err) {
    console.error("[DB] Erro ao buscar meta:", err.message);
    return null;
  }
}

// ═══════════════════════════════════════════════
// VERIFICAÇÃO DE DUPLICATAS (Guard Rail)
// ═══════════════════════════════════════════════

/**
 * Verifica se um jogo já existe no banco para evitar duplicatas.
 * Retorna o objeto do jogo se encontrar, ou null se estiver livre.
 */
export async function checkGameExists(filename, titleId, version) {
  if (!isConnected) return null;

  try {
    // 1. Proteção contra Sobrescrita (Mesmo nome de arquivo)
    // Isso evita corromper o arquivo que já está no Dropbox
    // Busca case-insensitive e normalizada
    const normalizedFilename = filename ? filename.trim() : null;
    if (normalizedFilename) {
      // Busca exata primeiro
      let byFilename = await GameCache.findOne({
        filename: normalizedFilename,
      });

      // Se não encontrar, tenta case-insensitive
      if (!byFilename) {
        byFilename = await GameCache.findOne({
          filename: {
            $regex: new RegExp(
              `^${normalizedFilename.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
              "i"
            ),
          },
        });
      }

      if (byFilename) {
        return { type: "filename", found: byFilename };
      }
    }

    // 2. Proteção contra Duplicidade Lógica (Mesmo Jogo e Versão)
    // Se já temos o TitleID na mesma versão, não precisamos baixar de novo
    // (Só verificamos se titleId for válido)
    if (titleId) {
      const byId = await GameCache.findOne({
        titleId: titleId,
        version: version,
      });
      if (byId) {
        return { type: "logic", found: byId };
      }
    }

    return null;
  } catch (err) {
    console.error("[DB] Erro ao verificar duplicidade:", err.message);
    return null; // Em caso de erro, deixamos passar (fail open)
  }
}
