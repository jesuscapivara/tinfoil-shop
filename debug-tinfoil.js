// DEBUGGER v17 (Redirect Checker)
import fetch from "node-fetch";
const SHOP_URL = "https://tinfoilapp.discloud.app/api";

async function run() {
  console.log("🔍 DIAGNÓSTICO v17...");

  // 1. Pega JSON
  const json = await (await fetch(SHOP_URL)).json();
  const game = json.files[0];
  console.log(`URL: ${game.url}`);

  // 2. Simula Tinfoil
  console.log("Seguindo redirect...");
  const res = await fetch(game.url, { redirect: "manual" });

  console.log(`Status do Servidor: ${res.status}`); // Esperado: 302
  const dest = res.headers.get("location");
  console.log(`Destino: ${dest}`); // Esperado: https://uc....dl.dropboxusercontent.com...

  // 3. Verifica o destino final
  if (dest) {
    console.log("Testando link final...");
    const finalCheck = await fetch(dest, { method: "HEAD" });
    console.log(
      `Final Content-Type: ${finalCheck.headers.get("content-type")}`
    );
    // Esperado: application/octet-stream ou application/x-ns-proxy-etc
  }
}
run();
