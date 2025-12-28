import fetch from "node-fetch"; // Se der erro, use 'npm install node-fetch' ou rode com Node 18+ nativo

// 🔧 CONFIGURAÇÃO: Coloque a URL da sua API na Discloud
const SHOP_URL = "https://tinfoilapp.discloud.app/api";

const log = (label, msg) => console.log(`\x1b[36m[${label}]\x1b[0m`, msg);
const err = (label, msg) => console.log(`\x1b[31m[${label}]\x1b[0m`, msg);
const success = (label, msg) => console.log(`\x1b[32m[${label}]\x1b[0m`, msg);

async function runDiagnostics() {
  console.log("🔍 INICIANDO DIAGNÓSTICO DO TINFOIL SHOP...\n");

  // 1. TESTE DO JSON (Aba New Games)
  log("STEP 1", `Baixando índice JSON de: ${SHOP_URL}`);

  let jsonData;
  try {
    const response = await fetch(SHOP_URL);

    if (!response.ok) throw new Error(`Status HTTP: ${response.status}`);

    const text = await response.text();
    try {
      jsonData = JSON.parse(text);
    } catch (e) {
      err("FAIL", "A resposta NÃO é um JSON válido. O servidor retornou:");
      console.log(text.substring(0, 500)); // Mostra o começo do erro (HTML?)
      return;
    }

    success("PASS", "JSON baixado e parseado com sucesso.");
    console.log("---------------------------------------------------");
    console.log(`📂 Mensagem de Sucesso: "${jsonData.success}"`);
    console.log(`🎮 Total de Arquivos: ${jsonData.files.length}`);
    console.log("---------------------------------------------------");
  } catch (error) {
    err("CRITICAL", `Erro ao conectar na API: ${error.message}`);
    return;
  }

  if (jsonData.files.length === 0) {
    err("WARN", "Nenhum arquivo encontrado no JSON. Verifique o Dropbox.");
    return;
  }

  // 2. ANÁLISE ESTRUTURAL
  const firstGame = jsonData.files[0];
  log("STEP 2", "Analisando estrutura do primeiro jogo encontrado:");
  console.log(JSON.stringify(firstGame, null, 2));

  if (!firstGame.url || !firstGame.size || !firstGame.name) {
    err(
      "FAIL",
      "Estrutura do JSON inválida! Faltam campos obrigatórios (url, size, name)."
    );
    return;
  }

  // Validação do Nome Visual
  if (firstGame.name.includes(".nsp") || firstGame.name.includes("[")) {
    success("PASS", "Nome visual parece correto (contém extensão ou TitleID).");
  } else {
    err("WARN", "Nome visual estranho. Pode não aparecer capa.");
  }

  // 3. SIMULAÇÃO DE DOWNLOAD (O Pulo do Gato)
  log("STEP 3", "Simulando tentativa de download do Tinfoil...");
  log("LINK", firstGame.url);

  try {
    // O Tinfoil não segue redirects automaticamente sem checar headers, mas o fetch segue.
    // Vamos desativar o redirect automático para analisar o "pulo".
    const redirectResponse = await fetch(firstGame.url, { redirect: "manual" });

    if (redirectResponse.status === 302 || redirectResponse.status === 301) {
      success(
        "PASS",
        `Servidor respondeu com Redirect ${redirectResponse.status} (Correto).`
      );

      const finalLocation = redirectResponse.headers.get("location");
      console.log(`🔗 Destino do Redirect: ${finalLocation}`);

      if (!finalLocation) {
        err(
          "FAIL",
          "Header 'Location' vazio! O redirect não leva a lugar nenhum."
        );
        return;
      }

      // 4. VERIFICAÇÃO DO DESTINO FINAL (Dropbox)
      log("STEP 4", "Verificando o que o Dropbox entrega no final...");

      // Fazemos uma requisição HEAD (ou GET com range curto) para não baixar gigas
      const finalResp = await fetch(finalLocation, { method: "HEAD" });

      const contentType = finalResp.headers.get("content-type");
      const contentLength = finalResp.headers.get("content-length");

      console.log(`📄 Tipo de Conteúdo (Content-Type): ${contentType}`);
      console.log(`📏 Tamanho (Content-Length): ${contentLength}`);

      if (contentType.includes("html")) {
        err("FATAL ERROR", "O LINK FINAL É UMA PÁGINA WEB (HTML)!");
        console.log(
          "O Tinfoil não consegue instalar HTML. O parâmetro ?dl=1 falhou ou o link expirou."
        );
      } else if (
        contentType.includes("octet-stream") ||
        contentType.includes("application/zip") ||
        contentType.includes("binary")
      ) {
        success(
          "SUCCESS",
          "O link final é BINÁRIO/STREAM. O Tinfoil deve aceitar!"
        );
      } else {
        err(
          "WARN",
          `Tipo de conteúdo desconhecido: ${contentType}. Pode falhar.`
        );
      }
    } else if (redirectResponse.status === 200) {
      err(
        "FAIL",
        "O servidor NÃO redirecionou (Status 200). Ele tentou entregar o arquivo direto?"
      );
      // Se for HTML, erro. Se for binário, ok (mas via proxy Discloud é arriscado).
    } else {
      err("FAIL", `Status inesperado: ${redirectResponse.status}`);
    }
  } catch (error) {
    err("CRITICAL", `Erro ao tentar baixar: ${error.message}`);
  }
}

runDiagnostics();
