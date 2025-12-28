import fetch from "node-fetch";

const SHOP_URL = "https://tinfoilapp.discloud.app/api";

// Cores para facilitar leitura
const c = {
  cyan: (txt) => `\x1b[36m${txt}\x1b[0m`,
  red: (txt) => `\x1b[31m${txt}\x1b[0m`,
  green: (txt) => `\x1b[32m${txt}\x1b[0m`,
  yellow: (txt) => `\x1b[33m${txt}\x1b[0m`,
  dim: (txt) => `\x1b[2m${txt}\x1b[0m`,
};

const log = (step, msg) => console.log(`${c.cyan(`[${step}]`)} ${msg}`);

async function dumpResponseDetails(res, label) {
  console.log(c.dim(`--- DETALHES DA RESPOSTA (${label}) ---`));
  console.log(
    `Status: ${res.ok ? c.green(res.status) : c.red(res.status)} ${
      res.statusText
    }`
  );
  console.log(`Content-Type: ${c.yellow(res.headers.get("content-type"))}`);
  console.log(
    `Location Header: ${c.yellow(res.headers.get("location") || "N/A")}`
  );

  // Se não for binário, lemos o corpo para ver o erro
  const type = res.headers.get("content-type") || "";
  if (
    type.includes("json") ||
    type.includes("text") ||
    type.includes("html") ||
    type.includes("xml")
  ) {
    try {
      const text = await res.text();
      console.log(c.red(`CORPO DA RESPOSTA (BODY):`));
      console.log(text.substring(0, 1000)); // Limita a 1000 caracteres para não floodar
    } catch (e) {
      console.log(`Erro ao ler corpo: ${e.message}`);
    }
  } else {
    console.log(
      c.green(
        `[BINÁRIO DETECTADO] Tamanho aprox: ${
          res.headers.get("content-length") || "Desconhecido"
        } bytes`
      )
    );
  }
  console.log(c.dim("----------------------------------------\n"));
}

async function runForensics() {
  console.log(c.cyan("🕵️  INICIANDO ANÁLISE FORENSE DO MANA SHOP  🕵️\n"));

  // 1. API JSON
  log("PASSO 1", `Consultando API: ${SHOP_URL}`);
  let targetUrl = "";
  try {
    const res = await fetch(SHOP_URL);
    await dumpResponseDetails(res.clone(), "API"); // Clone para não consumir o stream

    if (!res.ok) throw new Error("API Falhou");

    const json = await res.json();
    if (json.files.length === 0) throw new Error("Nenhum arquivo listado");

    targetUrl = json.files[0].url;
    log("INFO", `URL capturada para teste: ${targetUrl}`);
  } catch (e) {
    console.log(c.red(`FATAL API: ${e.message}`));
    return;
  }

  // 2. PRIMEIRO SALTO (Seu Servidor)
  log("PASSO 2", "Simulando Tinfoil acessando seu servidor...");
  let nextLink = "";

  try {
    // Redirect manual para inspecionar o 302
    const res1 = await fetch(targetUrl, {
      redirect: "manual",
      headers: {
        "User-Agent": "Tinfoil/17.0", // Finge ser o Switch
        Accept: "*/*",
      },
    });

    await dumpResponseDetails(res1, "SERVIDOR DISCLOUD");

    if (res1.status >= 300 && res1.status < 400) {
      nextLink = res1.headers.get("location");
      log("INFO", `Redirecionamento apontou para: ${nextLink}`);
    } else if (res1.status === 200) {
      console.log(
        c.yellow("ALERTA: Servidor respondeu 200 (Stream?) em vez de Redirect.")
      );
      // Se for stream, paramos aqui
      return;
    } else {
      throw new Error(`Servidor respondeu com erro ${res1.status}`);
    }
  } catch (e) {
    console.log(c.red(`FATAL SERVIDOR: ${e.message}`));
    return;
  }

  if (!nextLink) {
    console.log(c.red("ABORTANDO: Não há link para seguir."));
    return;
  }

  // 3. SEGUNDO SALTO (Dropbox)
  log("PASSO 3", "Seguindo para o destino final (Dropbox)...");

  try {
    const res2 = await fetch(nextLink, {
      method: "GET", // Tentamos baixar de verdade
      redirect: "manual", // Queremos ver se ele redireciona de novo (para o uc...)
      headers: {
        "User-Agent": "Tinfoil/17.0",
        // Alguns servidores exigem cookie ou referer, vamos ver se o erro acusa isso
      },
    });

    await dumpResponseDetails(res2, "DROPBOX FINAL");

    // ANÁLISE DE CAUSA RAIZ
    const finalType = res2.headers.get("content-type") || "";

    if (finalType.includes("json")) {
      console.log(
        c.red(
          "🚨 DIAGNÓSTICO: O Dropbox rejeitou o link e retornou um ERRO JSON."
        )
      );
      console.log(
        "Leia o 'CORPO DA RESPOSTA' acima para saber o motivo exato (ex: shared_link_not_found, restricted, etc)."
      );
    } else if (finalType.includes("html")) {
      console.log(
        c.red(
          "🚨 DIAGNÓSTICO: O Dropbox retornou uma página HTML (Provavelmente 'Aviso de Vírus' ou 'Login')."
        )
      );
    } else if (res2.status === 302 || res2.status === 301) {
      console.log(
        c.green(
          "✅ SINAL POSITIVO: O Dropbox tentou redirecionar para o raw stream (uc...)."
        )
      );
      console.log(`Link Raw: ${res2.headers.get("location")}`);
    } else if (res2.status === 200) {
      console.log(
        c.green("✅ SUCESSO TEÓRICO: O Dropbox entregou o arquivo (200 OK).")
      );
    }
  } catch (e) {
    console.log(c.red(`FATAL DROPBOX: ${e.message}`));
  }
}

runForensics();
