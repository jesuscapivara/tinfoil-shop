/**
 * SERVICE: TitleDB & Parser
 * Inteligência de reconhecimento via CNMTS (Fonte mais estável)
 */

import fetch from "isomorphic-fetch";

// ✅ FONTE ESTÁVEL: CNMTS.json (Mapeia ID -> Metadados)
// Esse arquivo é mantido pois é essencial para ferramentas como NSC_Builder
const TITLEDB_URL =
  "https://raw.githubusercontent.com/julesontheroad/titledb/master/cnmts.json";

// Cache em memória
let titleDbMap = new Map(); // Nome -> ID
let idToNameMap = new Map(); // ID -> Nome (Opcional, para debug)

const log = {
  info: (msg) => console.log(`[BRAIN] ${msg}`),
  error: (msg, err) => console.error(`[BRAIN] ❌ ${msg}`, err || ""),
};

/**
 * Normaliza nomes para busca (remove espaços, simbolos, lowercase)
 */
function normalize(str) {
  return str.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export async function loadTitleDB() {
  log.info(`Baixando Cérebro de: ${TITLEDB_URL}...`);
  try {
    const res = await fetch(TITLEDB_URL);
    if (!res.ok)
      throw new Error(
        `Status ${res.status} - O arquivo pode ter mudado de lugar.`
      );

    const json = await res.json();
    titleDbMap.clear();
    idToNameMap.clear();

    // O formato do cnmts.json é:
    // { "0100000000010000": { "name": "Super Mario Odyssey", ... }, ... }

    let count = 0;
    for (const [id, data] of Object.entries(json)) {
      if (data && data.name) {
        const cleanName = normalize(data.name);

        // Mapeia Nome -> ID (para quando o arquivo não tem ID)
        titleDbMap.set(cleanName, id);

        // Se quiser mapear também variações (ex: remove "The")
        if (cleanName.startsWith("the")) {
          titleDbMap.set(cleanName.substring(3), id);
        }

        // Mapeia ID -> Nome (para debug futuro)
        idToNameMap.set(id, data.name);

        count++;
      }
    }

    log.info(`✅ Cérebro Ativo! ${count} jogos indexados via CNMTS.`);
  } catch (e) {
    log.error("Falha Crítica no TitleDB:", e.message);
    log.error(
      "Sua loja funcionará apenas com jogos que já tenham [ID] no nome do arquivo."
    );
  }
}

export function getDbStatus() {
  return titleDbMap.size > 0
    ? `Online (${titleDbMap.size} títulos)`
    : "Offline (Usando apenas nomes de arquivo)";
}

export function parseGameInfo(fileName) {
  // 1. Tenta pegar ID do nome do arquivo [0100...]
  const regexId = /\[([0-9A-Fa-f]{16})\]/i;
  let titleId = null;
  const matchId = fileName.match(regexId);
  if (matchId) titleId = matchId[1].toUpperCase();

  // 2. Tenta pegar Versão [v1234]
  const regexVersion = /[\[\(]v(\d+)[\]\)]/i;
  let version = 0;
  const matchVersion = fileName.match(regexVersion);
  if (matchVersion) version = parseInt(matchVersion[1], 10);

  // 3. Limpa o nome visualmente
  let cleanName = fileName
    .replace(/\.(nsp|nsz|xci)$/i, "")
    .replace(regexId, "")
    .replace(regexVersion, "")
    .replace(/\s*\([0-9.]+\s*(GB|MB)\)/gi, "")
    .replace(/\[\s*\]/g, "")
    .replace(/\(\s*\)/g, "")
    .replace(/\s+/g, " ")
    .trim();

  // 4. AUTO-DISCOVERY: Se não tem ID, busca no mapa
  if (!titleId && titleDbMap.size > 0) {
    const searchKey = normalize(cleanName);

    if (titleDbMap.has(searchKey)) {
      titleId = titleDbMap.get(searchKey);
      // console.log(`[AUTO] Match encontrado: "${cleanName}" -> ${titleId}`);
    } else {
      // Tentativa de "Fuzzy Match" simples (contém)
      // Cuidado: pode ser lento se tiver muitos jogos, mas ajuda em nomes parciais
      // Descomente se precisar de mais "força bruta"
      /*
      for (const [key, id] of titleDbMap.entries()) {
        if (key.includes(searchKey) || searchKey.includes(key)) {
           titleId = id;
           break;
        }
      }
      */
    }
  }

  return { name: cleanName, id: titleId, version };
}
