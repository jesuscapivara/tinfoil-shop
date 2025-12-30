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

        // Estratégia de Indexação Dupla para Auto-Discovery

        // 1. Chave Normalizada (ex: "supermarioodyssey")
        const cleanName = normalize(game.name);
        if (cleanName) {
          // Só sobrescreve se ainda não existe (prioridade para a primeira fonte)
          if (!titleDbMap.has(cleanName)) {
            titleDbMap.set(cleanName, game.id);
          }
        }

        // 2. Chave Exata Lowercase (ex: "super mario odyssey")
        // Útil para matches parciais mais precisos
        const exactName = game.name.toLowerCase();
        if (!titleDbMap.has(exactName)) {
          titleDbMap.set(exactName, game.id);
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
 * @param {string} gameName - Nome do jogo (ex: "Mario Kart 8 Deluxe")
 * @returns {string|null} - Title ID se encontrado, null caso contrário
 */
export function findTitleIdByName(gameName) {
  if (!gameName || titleDbMap.size === 0) return null;

  // Normaliza o nome para busca
  const normalized = normalize(gameName);
  if (normalized && titleDbMap.has(normalized)) {
    return titleDbMap.get(normalized);
  }

  // Fallback: busca exata lowercase
  const exactName = gameName.toLowerCase();
  if (titleDbMap.has(exactName)) {
    return titleDbMap.get(exactName);
  }

  // Tenta busca parcial (remove palavras comuns)
  const cleanName = gameName
    .toLowerCase()
    .replace(/\b(the|a|an|and|or|but|in|on|at|to|for|of|with|by)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();

  const cleanNormalized = normalize(cleanName);
  if (cleanNormalized && titleDbMap.has(cleanNormalized)) {
    return titleDbMap.get(cleanNormalized);
  }

  return null;
}
