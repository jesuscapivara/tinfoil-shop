/**
 * Telegram Indexer Service
 * Integração com bot do Telegram para busca e download de jogos
 */

import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";
import { NewMessage } from "telegram/events";
import dotenv from "dotenv";

dotenv.config();

// Configurações do Telegram
const apiId = parseInt(process.env.TG_API_ID);
const apiHash = process.env.TG_API_HASH;
const stringSession = process.env.TG_SESSION;
const targetBot = process.env.TARGET_BOT_USERNAME?.toLowerCase();

let telegramClient = null;
let isConnecting = false;

/**
 * Inicializa o cliente do Telegram
 */
async function initTelegramClient() {
  if (telegramClient) {
    return telegramClient;
  }

  if (isConnecting) {
    // Aguarda a conexão em andamento
    while (isConnecting) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return telegramClient;
  }

  if (!apiId || !apiHash || !stringSession || !targetBot) {
    throw new Error(
      "Telegram não configurado. Configure TG_API_ID, TG_API_HASH, TG_SESSION e TARGET_BOT_USERNAME no .env"
    );
  }

  isConnecting = true;

  try {
    const session = new StringSession(stringSession);
    telegramClient = new TelegramClient(session, apiId, apiHash, {
      connectionRetries: 5,
    });

    await telegramClient.connect();
    await telegramClient.getDialogs({ limit: 10 });

    console.log("[TELEGRAM] ✅ Cliente conectado com sucesso");
    isConnecting = false;
    return telegramClient;
  } catch (error) {
    isConnecting = false;
    console.error("[TELEGRAM] ❌ Erro ao conectar:", error.message);
    throw error;
  }
}

/**
 * Busca lista de jogos no bot
 * @param {string} searchTerm - Termo de busca
 * @returns {Promise<Array>} Lista de jogos encontrados
 */
export async function searchGames(searchTerm) {
  if (!searchTerm || searchTerm.trim().length === 0) {
    throw new Error("Termo de busca não pode ser vazio");
  }

  const client = await initTelegramClient();

  console.log(`[TELEGRAM] 🔎 Buscando: "${searchTerm}"...`);

  await client.sendMessage(targetBot, { message: searchTerm.trim() });

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      client.removeEventHandler(handler);
      reject(new Error("Timeout: O bot não retornou lista em 30 segundos."));
    }, 30000);

    const handler = async (event) => {
      const msg = event.message;
      if (msg.out) return;

      if (msg.message && msg.message.includes("Download: /download")) {
        console.log("[TELEGRAM] ✅ Lista recebida");
        clearTimeout(timeout);
        client.removeEventHandler(handler);
        const games = parseBotResponse(msg.message);
        resolve(games);
      }
    };

    client.addEventHandler(handler, new NewMessage({}));
  });
}

/**
 * Faz download do torrent/magnet link de um jogo específico
 * @param {string} downloadCommand - Comando de download (ex: /download1)
 * @returns {Promise<{type: string, link?: string, filename?: string, media?: any}>}
 */
export async function fetchGameTorrent(downloadCommand) {
  const client = await initTelegramClient();

  console.log(`[TELEGRAM] ⬇️ Enviando comando: ${downloadCommand}...`);

  await client.sendMessage(targetBot, { message: downloadCommand });

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      client.removeEventHandler(handler);
      reject(new Error("Timeout esperando arquivo/magnet link."));
    }, 30000);

    const handler = async (event) => {
      const msg = event.message;
      if (msg.out) return;

      // Se recebeu um arquivo .torrent
      if (msg.media && msg.media.document) {
        clearTimeout(timeout);
        client.removeEventHandler(handler);

        try {
          // Baixa o arquivo
          const buffer = await client.downloadMedia(msg.media);

          // Importa parse-torrent dinamicamente
          const parseTorrentModule = await import("parse-torrent");
          const parseTorrent =
            typeof parseTorrentModule.default === "function"
              ? parseTorrentModule.default
              : parseTorrentModule;

          // Faz parse do torrent
          const torrentInfo = await parseTorrent(buffer);

          if (!torrentInfo || !torrentInfo.infoHash) {
            throw new Error("Parse falhou: Objeto torrentInfo inválido.");
          }

          // Constrói magnet link
          const trackers = [
            "udp://tracker.opentrackr.org:1337/announce",
            "udp://open.stealth.si:80/announce",
            "udp://tracker.torrent.eu.org:451/announce",
          ];

          const gameName = msg.file?.name?.replace(/\.torrent$/, "") || "Game";
          let magnetURI = `magnet:?xt=urn:btih:${torrentInfo.infoHash}`;
          magnetURI += `&dn=${encodeURIComponent(gameName)}`;
          trackers.forEach(
            (tr) => (magnetURI += `&tr=${encodeURIComponent(tr)}`)
          );

          console.log(
            `[TELEGRAM] ✅ Magnet link gerado: ${magnetURI.substring(0, 50)}...`
          );

          resolve({
            type: "magnet",
            link: magnetURI,
            filename: msg.file?.name || "game.torrent",
          });
        } catch (error) {
          console.error("[TELEGRAM] ❌ Erro ao processar torrent:", error);
          reject(error);
        }
      }
      // Se recebeu um magnet link direto
      else if (msg.message && msg.message.includes("magnet:")) {
        clearTimeout(timeout);
        client.removeEventHandler(handler);
        const match = msg.message.match(
          /magnet:\?xt=urn:btih:[a-zA-Z0-9]*[^\s]*/
        );
        const link = match ? match[0] : msg.message.trim();
        console.log(`[TELEGRAM] ✅ Magnet link recebido diretamente`);
        resolve({ type: "magnet", link: link });
      }
    };

    client.addEventHandler(handler, new NewMessage({}));
  });
}

/**
 * Parse da resposta do bot em lista de jogos
 * @param {string} rawText - Texto da resposta do bot
 * @returns {Array} Lista de jogos com nome, comando e tamanho
 */
function parseBotResponse(rawText) {
  const games = [];
  const lines = rawText.split("\n");
  let currentGame = {};

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    if (line.includes("Download: /download")) {
      const cmdMatch = line.match(/(\/download\d+)/);
      if (cmdMatch) {
        currentGame.command = cmdMatch[1];

        // Tenta encontrar o nome do jogo nas linhas anteriores
        if (!currentGame.name) {
          for (let k = 1; k <= 5; k++) {
            const candidate = lines[i - k];
            if (
              candidate &&
              candidate.trim().length > 3 &&
              !candidate.includes("Tamanho:") &&
              !candidate.includes("No torrent") &&
              !candidate.includes("Download:")
            ) {
              currentGame.name = candidate.trim();
              break;
            }
          }
          if (!currentGame.name) currentGame.name = "Nome Desconhecido";
        }

        if (currentGame.command) {
          games.push({
            name: currentGame.name,
            command: currentGame.command,
            size: currentGame.size || "N/A",
          });
          currentGame = {};
        }
      }
    } else if (line.startsWith("Tamanho:")) {
      currentGame.size = line.replace("Tamanho:", "").trim();
    }
  }

  return games;
}

/**
 * Fecha a conexão do Telegram (opcional, para cleanup)
 */
export async function disconnectTelegram() {
  if (telegramClient) {
    try {
      await telegramClient.disconnect();
      telegramClient = null;
      console.log("[TELEGRAM] 🔌 Desconectado");
    } catch (error) {
      console.error("[TELEGRAM] ❌ Erro ao desconectar:", error);
    }
  }
}
