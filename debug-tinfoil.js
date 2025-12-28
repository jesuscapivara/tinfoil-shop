import fetch from "node-fetch";

const SHOP_URL = "https://tinfoilapp.discloud.app/api";

const log = (label, msg) => console.log(`\x1b[36m[${label}]\x1b[0m`, msg);
const err = (label, msg) => console.log(`\x1b[31m[${label}]\x1b[0m`, msg);
const success = (label, msg) => console.log(`\x1b[32m[${label}]\x1b[0m`, msg);

async function runDiagnostics() {
  console.log("🔍 DIAGNÓSTICO v16 (STREAM MODE)...\n");

  // 1. BAIXAR JSON
  log("STEP 1", `Baixando índice...`);
  let jsonData;
  try {
    const response = await fetch(SHOP_URL);
    jsonData = await response.json();
    success("PASS", `JSON OK: "${jsonData.success}"`);
  } catch (error) {
    err("CRITICAL", `Falha API: ${error.message}`);
    return;
  }

  if (!jsonData.files?.length) {
    err("WARN", "Zero arquivos.");
    return;
  }

  // 2. VERIFICAR NOVA ESTRUTURA DE URL
  const game = jsonData.files[0];
  log("STEP 2", `URL Gerada: ${game.url}`);

  if (game.url.includes("?data=")) {
    err(
      "FAIL",
      "⚠️ A URL ainda está no formato antigo (v15)! O deploy da v16 não funcionou."
    );
    return;
  } else {
    success("PASS", "URL no formato novo (Path Style).");
  }

  // 3. TESTE DE STREAM (HEAD REQUEST)
  log("STEP 3", "Testando conexão direta (Stream)...");

  try {
    // Usa HEAD para não baixar o arquivo todo, apenas ver os headers
    const res = await fetch(game.url, {
      method: "HEAD",
      headers: { "User-Agent": "Tinfoil/17.0" },
    });

    console.log(`Status: ${res.status} ${res.statusText}`);
    console.log(`Type: ${res.headers.get("content-type")}`);
    console.log(`Size: ${res.headers.get("content-length")}`);

    if (res.status === 200) {
      if (res.headers.get("content-type")?.includes("octet-stream")) {
        success("SUCCESS", "✅ STREAM FUNCIONANDO! O Tinfoil vai aceitar.");
      } else {
        err("WARN", "O servidor respondeu 200, mas o tipo não é octet-stream.");
      }
    } else if (res.status === 302) {
      err(
        "FAIL",
        "⚠️ O servidor fez Redirect. A v16 (Stream) NÃO deveria fazer redirect."
      );
    } else {
      err("FAIL", `Erro HTTP: ${res.status}`);
    }
  } catch (e) {
    err("CRITICAL", `Erro conexão: ${e.message}`);
  }
}

runDiagnostics();
