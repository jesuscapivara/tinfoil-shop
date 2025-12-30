/**
 * SERVICE: TitleDB Aggregator
 * Arquitetura: Consumo de Raw Data (Multi-Region / Multi-Source)
 * Baseado na lógica de agregação do Blawar/Tinfoil.
 */

import fetch from "isomorphic-fetch";

// Fontes de Verdade (Raw Data)
// ⚠️ Nota: Usamos tinfoil.media como primário pois o github do blawar removeu os arquivos .json
const SOURCES = [
  {
    id: "US_EN",
    url: "https://tinfoil.media/titledb/titles.US.en.json",
    headers: { "User-Agent": "Tinfoil/17.0" }, // Necessário para passar no WAF
    priority: 1,
  },
  {
    id: "JP_JA",
    url: "https://tinfoil.media/titledb/titles.JP.ja.json",
    headers: { "User-Agent": "Tinfoil/17.0" },
    priority: 2,
  },
  // Fallback Mirror (caso o oficial caia)
  {
    id: "MIRROR_US",
    url: "https://raw.githubusercontent.com/julesontheroad/titledb/master/titles.US.en.json",
    priority: 3,
  },
];

// O "Cérebro" unificado na memória RAM (Mais rápido que FS no Discloud)
let titleDbMap = new Map();

const log = {
  info: (msg) => console.log(`[AGGREGATOR] ${msg}`),
  error: (msg, err) => console.error(`[AGGREGATOR] ❌ ${msg}`, err || ""),
  warn: (msg) => console.log(`[AGGREGATOR] ⚠️ ${msg}`),
};

/**
 * Normaliza strings para chave de busca (remove espaços, simbolos)
 */
function normalize(str) {
  if (!str) return "";
  return str.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Motor de Agregação Paralela
 */
export async function loadTitleDB() {
  console.time("AggregationTime");
  log.info(`🚀 Iniciando agregação de ${SOURCES.length} bases de dados...`);

  titleDbMap.clear();

  // Dispara requests em paralelo (non-blocking)
  const promises = SOURCES.map(async (source) => {
    try {
      const res = await fetch(source.url, { headers: source.headers || {} });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      return { source: source.id, data, priority: source.priority };
    } catch (err) {
      log.warn(`Falha na fonte ${source.id}: ${err.message}`);
      return null;
    }
  });

  const results = await Promise.all(promises);
  let totalProcessed = 0;

  // Processamento e Normalização (Merge Strategy)
  // Ordenamos por prioridade para que US_EN sobrescreva JP_JA em caso de conflito de nomes
  results
    .filter((r) => r !== null)
    .sort((a, b) => a.priority - b.priority)
    .forEach((result) => {
      const { data, source } = result;
      let entries = [];

      // Detecta formato (Array vs Object)
      if (Array.isArray(data)) {
        entries = data;
      } else if (typeof data === "object") {
        entries = Object.values(data);
      }

      log.info(`📦 Processando ${source}: ${entries.length} registros.`);

      entries.forEach((game) => {
        if (!game.id || !game.name) return;

        // Estratégia de Indexação Múltipla para Auto-Discovery
        // Indexa o mesmo jogo com várias chaves diferentes para aumentar chances de match

        // 1. Chave Normalizada (ex: "supermarioodyssey")
        const cleanName = normalize(game.name);
        if (cleanName) {
          if (!titleDbMap.has(cleanName)) {
            titleDbMap.set(cleanName, game.id);
          }
        }

        // 2. Chave Exata Lowercase (ex: "super mario odyssey™")
        const exactName = game.name.toLowerCase();
        if (!titleDbMap.has(exactName)) {
          titleDbMap.set(exactName, game.id);
        }

        // 3. Chave sem símbolos especiais (remove ™, ©, etc)
        const withoutSymbols = game.name
          .toLowerCase()
          .replace(/[™©®]/g, "")
          .trim();
        if (
          withoutSymbols &&
          withoutSymbols !== exactName &&
          !titleDbMap.has(withoutSymbols)
        ) {
          titleDbMap.set(withoutSymbols, game.id);
        }

        // 4. Chave normalizada sem símbolos
        const normalizedWithoutSymbols = normalize(withoutSymbols);
        if (
          normalizedWithoutSymbols &&
          normalizedWithoutSymbols !== cleanName &&
          !titleDbMap.has(normalizedWithoutSymbols)
        ) {
          titleDbMap.set(normalizedWithoutSymbols, game.id);
        }

        // 5. Indexa também por palavras principais (primeiras 2-3 palavras)
        const words = game.name
          .toLowerCase()
          .split(/\s+/)
          .filter((w) => w.length > 2);
        if (words.length >= 2) {
          const keyPhrase = words.slice(0, 3).join(" ");
          if (keyPhrase && !titleDbMap.has(keyPhrase)) {
            titleDbMap.set(keyPhrase, game.id);
          }

          const keyPhrase2 = words.slice(0, 2).join(" ");
          if (
            keyPhrase2 &&
            keyPhrase2 !== keyPhrase &&
            !titleDbMap.has(keyPhrase2)
          ) {
            titleDbMap.set(keyPhrase2, game.id);
          }
        }

        totalProcessed++;
      });
    });

  console.timeEnd("AggregationTime");
  log.info(`✅ Base unificada gerada na RAM!`);
  log.info(`📊 Total de Títulos Indexados: ${titleDbMap.size}`);

  if (titleDbMap.size === 0) {
    log.error(
      "❌ AVISO: Nenhuma base de dados foi carregada. O Auto-Discovery não funcionará."
    );
  }
}

export function getDbStatus() {
  return titleDbMap.size > 0
    ? `Online (${titleDbMap.size} títulos)`
    : "Offline (Mode File-Only)";
}

/**
 * Parser Inteligente que consulta o DB Agregado
 */
export function parseGameInfo(fileName) {
  // 1. Tenta pegar ID explícito no nome [0100...]
  const regexId = /\[([0-9A-Fa-f]{16})\]/i;
  let titleId = null;
  const matchId = fileName.match(regexId);
  if (matchId) titleId = matchId[1].toUpperCase();

  // 2. Tenta pegar Versão [v1234]
  const regexVersion = /[\[\(]v(\d+)[\]\)]/i;
  let version = 0;
  const matchVersion = fileName.match(regexVersion);
  if (matchVersion) version = parseInt(matchVersion[1], 10);

  // 3. Limpeza do Nome
  let cleanName = fileName
    .replace(/\.(nsp|nsz|xci)$/i, "")
    .replace(regexId, "")
    .replace(regexVersion, "")
    .replace(/\s*\([0-9.]+\s*(GB|MB)\)/gi, "")
    .replace(/\[\s*\]/g, "")
    .replace(/\(\s*\)/g, "")
    .replace(/\s+/g, " ")
    .trim();

  // 4. Consulta ao "Cérebro" Agregado
  if (!titleId && titleDbMap.size > 0) {
    const searchKey = normalize(cleanName);

    if (titleDbMap.has(searchKey)) {
      titleId = titleDbMap.get(searchKey);
    } else {
      // Fallback: Tenta busca exata lowercase
      const simpleKey = cleanName.toLowerCase();
      if (titleDbMap.has(simpleKey)) {
        titleId = titleDbMap.get(simpleKey);
      }
    }
  }

  return { name: cleanName, id: titleId, version };
}

/**
 * Busca Title ID pelo nome do jogo (para jogos da busca do Telegram)
 * @param {string} gameName - Nome do jogo (ex: "Mario Kart 8 Deluxe [🇧🇷MOD]")
 * @returns {string|null} - Title ID se encontrado, null caso contrário
 */
export function findTitleIdByName(gameName) {
  if (!gameName || titleDbMap.size === 0) return null;

  // 1. Limpa o nome: remove emojis, flags, modificadores como [MOD], [🇧🇷MOD], etc
  let cleanName = gameName
    .replace(/\[🇧🇷MOD\]/gi, "")
    .replace(/\[MOD\]/gi, "")
    .replace(/\[.*?\]/g, "") // Remove qualquer coisa entre colchetes
    .replace(/\(.*?\)/g, "") // Remove qualquer coisa entre parênteses
    .replace(/[\u{1F300}-\u{1F9FF}]/gu, "") // Remove emojis Unicode
    .replace(/[\u{1F1E0}-\u{1F1FF}]/gu, "") // Remove flags Unicode
    .replace(/\s+/g, " ")
    .trim();

  if (!cleanName) return null;

  // 2. Tenta busca normalizada (remove espaços e símbolos)
  const normalized = normalize(cleanName);
  if (normalized && titleDbMap.has(normalized)) {
    return titleDbMap.get(normalized);
  }

  // 3. Tenta busca exata lowercase
  const exactName = cleanName.toLowerCase();
  if (titleDbMap.has(exactName)) {
    return titleDbMap.get(exactName);
  }

  // 4. Tenta sem símbolos especiais (™, ©, etc)
  const withoutSymbols = cleanName.toLowerCase().replace(/[™©®]/g, "").trim();
  if (withoutSymbols && titleDbMap.has(withoutSymbols)) {
    return titleDbMap.get(withoutSymbols);
  }

  // 5. Tenta normalizada sem símbolos
  const normalizedWithoutSymbols = normalize(withoutSymbols);
  if (normalizedWithoutSymbols && titleDbMap.has(normalizedWithoutSymbols)) {
    return titleDbMap.get(normalizedWithoutSymbols);
  }

  // 6. Tenta remover palavras comuns e buscar novamente
  const withoutCommonWords = cleanName
    .toLowerCase()
    .replace(
      /\b(the|a|an|and|or|but|in|on|at|to|for|of|with|by|vs|versus|plus|and)\b/g,
      ""
    )
    .replace(/\s+/g, " ")
    .trim();

  if (withoutCommonWords) {
    const withoutCommonNormalized = normalize(withoutCommonWords);
    if (withoutCommonNormalized && titleDbMap.has(withoutCommonNormalized)) {
      return titleDbMap.get(withoutCommonNormalized);
    }
  }

  // 7. Busca parcial: tenta encontrar por palavras-chave principais
  // Pega as primeiras 2-3 palavras significativas
  const words = cleanName
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 2);
  if (words.length >= 2) {
    // Tenta combinações de palavras principais (já indexadas durante o carregamento)
    const keyPhrases = [
      words.slice(0, 3).join(" "), // Primeiras 3 palavras
      words.slice(0, 2).join(" "), // Primeiras 2 palavras
    ];

    for (const phrase of keyPhrases) {
      if (titleDbMap.has(phrase)) {
        return titleDbMap.get(phrase);
      }
      const phraseNormalized = normalize(phrase);
      if (phraseNormalized && titleDbMap.has(phraseNormalized)) {
        return titleDbMap.get(phraseNormalized);
      }
    }
  }

  return null;
}
