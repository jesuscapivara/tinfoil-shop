/**
 * Telegram Indexer Service
 * Integração com bot do Telegram para busca e download de jogos
 */

import { TelegramClient } from "telegram";
import dotenv from "dotenv";

dotenv.config();

// Configurações do Telegram
const apiId = parseInt(process.env.TG_API_ID);
const apiHash = process.env.TG_API_HASH;
const stringSession = process.env.TG_SESSION;
const targetBot = process.env.TARGET_BOT_USERNAME?.toLowerCase();

let telegramClient = null;
let isConnecting = false;
let StringSessionClass = null;
let NewMessageClass = null;

/**
 * Carrega as classes necessárias do Telegram (importação dinâmica para ES modules)
 */
async function loadTelegramClasses() {
  if (StringSessionClass && NewMessageClass) {
    return { StringSession: StringSessionClass, NewMessage: NewMessageClass };
  }

  try {
    // Importações dinâmicas para compatibilidade com ES modules
    // Usa caminhos completos para evitar erro de importação de diretório
    const sessionsModule = await import("telegram/sessions/index.js");
    StringSessionClass = sessionsModule.StringSession;

    const eventsModule = await import("telegram/events/index.js");
    NewMessageClass = eventsModule.NewMessage;

    return {
      StringSession: StringSessionClass,
      NewMessage: NewMessageClass,
    };
  } catch (error) {
    console.error("[TELEGRAM] Erro ao carregar classes:", error);
    throw new Error(`Falha ao carregar módulos do Telegram: ${error.message}`);
  }
}

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
    // Carrega as classes necessárias
    const { StringSession } = await loadTelegramClasses();

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
  const { NewMessage } = await loadTelegramClasses();

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
  const { NewMessage } = await loadTelegramClasses();

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

          // Extrai trackers do arquivo .torrent original
          const trackers = new Set(); // Usa Set para evitar duplicatas

          // Adiciona trackers do announce (pode ser string ou array)
          if (torrentInfo.announce) {
            if (Array.isArray(torrentInfo.announce)) {
              torrentInfo.announce.forEach((tr) => trackers.add(tr));
            } else {
              trackers.add(torrentInfo.announce);
            }
          }

          // Adiciona trackers do announceList (array de arrays)
          if (
            torrentInfo.announceList &&
            Array.isArray(torrentInfo.announceList)
          ) {
            torrentInfo.announceList.forEach((trackerGroup) => {
              if (Array.isArray(trackerGroup)) {
                trackerGroup.forEach((tr) => trackers.add(tr));
              } else {
                trackers.add(trackerGroup);
              }
            });
          }

          // Converte Set para Array e adiciona trackers essenciais se não houver nenhum
          let trackersArray = Array.from(trackers);

          // Se não encontrou trackers no arquivo, adiciona os essenciais
          if (trackersArray.length === 0) {
            console.log(
              "[TELEGRAM] ⚠️ Nenhum tracker encontrado no arquivo, usando trackers padrão"
            );
            trackersArray = [
              "http://retracker.local/announce",
              "http://bt2.t-ru.org/ann?pk=e325e7a94cd8e7a73e5696b21b6c448a",
            ];
          } else {
            // Adiciona os trackers essenciais no início da lista (se ainda não estiverem)
            const essentialTrackers = [
              "http://retracker.local/announce",
              "http://bt2.t-ru.org/ann?pk=e325e7a94cd8e7a73e5696b21b6c448a",
            ];
            essentialTrackers.forEach((tr) => {
              if (!trackersArray.includes(tr)) {
                trackersArray.unshift(tr); // Adiciona no início
              }
            });
          }

          console.log(
            `[TELEGRAM] 📡 ${trackersArray.length} tracker(s) extraído(s) do arquivo`
          );

          const gameName = msg.file?.name?.replace(/\.torrent$/, "") || "Game";
          let magnetURI = `magnet:?xt=urn:btih:${torrentInfo.infoHash}`;
          magnetURI += `&dn=${encodeURIComponent(gameName)}`;
          trackersArray.forEach(
            (tr) => (magnetURI += `&tr=${encodeURIComponent(tr)}`)
          );

          console.log(
            `[TELEGRAM] ✅ Magnet link gerado: ${magnetURI.substring(0, 50)}...`
          );

          // Extrai nomes dos arquivos do torrent para verificação de duplicatas
          const fileNames = [];
          if (torrentInfo.files && Array.isArray(torrentInfo.files)) {
            torrentInfo.files.forEach((file) => {
              if (file.path) {
                // Se for array, pega o último elemento (nome do arquivo)
                const fileName = Array.isArray(file.path)
                  ? file.path[file.path.length - 1]
                  : file.path;
                fileNames.push(fileName);
              } else if (file.name) {
                fileNames.push(file.name);
              }
            });
          } else if (torrentInfo.name) {
            // Se não tiver array de files, usa o nome do torrent
            fileNames.push(torrentInfo.name);
          }

          console.log(
            `[TELEGRAM] 📁 ${fileNames.length} arquivo(s) encontrado(s) no torrent`
          );

          resolve({
            type: "magnet",
            link: magnetURI,
            filename: msg.file?.name || "game.torrent",
            fileNames: fileNames, // Lista de nomes de arquivos para verificação
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
