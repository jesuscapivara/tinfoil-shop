import fetch from "node-fetch";

const SHOP_URL = "https://tinfoilapp.discloud.app/api"; // Ajuste se necessário

const log = (label, msg) => console.log(`\x1b[36m[${label}]\x1b[0m`, msg);
const err = (label, msg) => console.log(`\x1b[31m[${label}]\x1b[0m`, msg);
const success = (label, msg) => console.log(`\x1b[32m[${label}]\x1b[0m`, msg);
const warn = (label, msg) => console.log(`\x1b[33m[${label}]\x1b[0m`, msg);

async function runDiagnostics() {
  console.log("🔍 DIAGNÓSTICO AVANÇADO TINFOIL (v2)...\n");

  // 1. BAIXAR JSON
  log("STEP 1", `Baixando índice JSON...`);
  let jsonData;
  try {
    const response = await fetch(SHOP_URL);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    jsonData = await response.json();
    success("PASS", `JSON OK. Versão: "${jsonData.success}"`);
  } catch (error) {
    err("CRITICAL", `Falha na API: ${error.message}`);
    return;
  }

  if (!jsonData.files || jsonData.files.length === 0) {
    err("WARN", "Nenhum arquivo no JSON.");
    return;
  }

  // 2. ESCOLHER ARQUIVO
  const targetGame = jsonData.files[0];
  log("STEP 2", `Testando: ${targetGame.name}`);
  console.log(`URL Inicial: ${targetGame.url}`);

  // 3. SIMULAR DOWNLOAD (FOLLOW REDIRECTS MANUALMENTE)
  log("STEP 3", "Seguindo redirects...");

  let currentUrl = targetGame.url;
  let finalResponse = null;
  let redirectCount = 0;

  try {
    while (redirectCount < 5) {
      // Finge ser um client genérico, não node-fetch
      const res = await fetch(currentUrl, {
        redirect: "manual",
        headers: { "User-Agent": "Tinfoil/17.0" },
      });

      if (res.status >= 300 && res.status < 400) {
        const nextLoc = res.headers.get("location");
        console.log(` ↳ [${res.status}] Redirecionando para: ${nextLoc}`);

        // CHECK DE SEGURANÇA RLKEY
        if (
          nextLoc.includes("dropbox") &&
          nextLoc.includes("/scl/") &&
          !nextLoc.includes("rlkey=")
        ) {
          err(
            "SECURITY ALERT",
            "Link '/scl/' detectado SEM 'rlkey'! Isso vai dar erro 400/403."
          );
        }

        currentUrl = nextLoc;
        redirectCount++;
      } else {
        finalResponse = res;
        break;
      }
    }

    // 4. ANÁLISE DO DESTINO FINAL
    log("STEP 4", "Analisando resposta final...");
    console.log(
      `Status Final: ${finalResponse.status} ${finalResponse.statusText}`
    );

    const contentType = finalResponse.headers.get("content-type");
    console.log(`Content-Type: ${contentType}`);

    if (finalResponse.status === 200) {
      if (
        contentType.includes("application/octet-stream") ||
        contentType.includes("application/zip")
      ) {
        success(
          "SUCCESS",
          "✅ LINK VÁLIDO! É um binário. O Tinfoil deve instalar."
        );
      } else if (contentType.includes("text/html")) {
        err("FAIL", "❌ O link final é uma página HTML.");

        // Tenta ler o título da página de erro para saber o motivo
        const htmlText = await finalResponse.text();
        const titleMatch = htmlText.match(/<title>(.*?)<\/title>/i);
        if (titleMatch) {
          warn("PAGE TITLE", `O Dropbox disse: "${titleMatch[1].trim()}"`);
        }
        console.log(
          "Dica: Se for 'Dropbox - 404' ou 'Error', o rlkey sumiu ou o arquivo foi movido."
        );
      } else {
        warn("WARN", `Tipo de conteúdo suspeito: ${contentType}`);
      }
    } else {
      err("FAIL", `Erro HTTP final: ${finalResponse.status}`);
    }
  } catch (e) {
    err("CRITICAL", `Erro de conexão: ${e.message}`);
  }
}

runDiagnostics();
