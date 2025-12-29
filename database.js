/**
 * DATABASE - Conexão e modelos MongoDB
 * Mana Shop v1.0
 */

import mongoose from "mongoose";
import dotenv from "dotenv";

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
  
  // Credenciais geradas para o Tinfoil
  tinfoilUser: { type: String, required: true, unique: true },
  tinfoilPass: { type: String, required: true },
  
  createdAt: { type: Date, default: Date.now }
});

export const User = mongoose.model("User", userSchema);

export async function createUser(email, webPassword, isAdmin = false) {
  if (!isConnected) return null;

  // Gera credenciais Tinfoil
  const tinfoilUser = email
    .split("@")[0]
    .replace(/[^a-zA-Z0-9]/g, "")
    .toLowerCase();
  const tinfoilPass = Math.random().toString(36).slice(-8).toUpperCase(); // Ex: X7K9P2M1

  try {
    const user = new User({
      email,
      password: webPassword, // Em produção real, use bcrypt. Aqui vamos simples.
      isAdmin,
      tinfoilUser,
      tinfoilPass,
    });
    await user.save();
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
  // Verifica se existe alguém com esse user/pass do Tinfoil
  const found = await User.findOne({ tinfoilUser: user, tinfoilPass: pass });
  return !!found;
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

// Schema para cache de jogos indexados
const gameCacheSchema = new mongoose.Schema({
  url: { type: String, required: true },
  size: { type: Number },
  name: { type: String, required: true },
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
// FUNÇÕES AUXILIARES - GAME CACHE
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

    console.log(`[DB] 📚 Cache atualizado: ${games.length} jogos`);
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
      })),
      lastUpdate: meta?.value ? new Date(meta.value).getTime() : null,
    };
  } catch (err) {
    console.error("[DB] Erro ao buscar cache:", err.message);
    return { games: [], lastUpdate: null };
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
