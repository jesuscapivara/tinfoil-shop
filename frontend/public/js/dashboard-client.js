// Dashboard Client-Side JavaScript
// Extraído do templates.js para modularização

let selectedFile = null;
let knownIds = new Set();
let allGames = []; // Armazena todos os jogos para filtro

// ✅ Função de escape HTML para prevenir XSS
function escapeHtml(text) {
  if (!text) return text;
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function showNotification(message, type = "info") {
  const existing = document.querySelector(".notification");
  if (existing) existing.remove();

  const notif = document.createElement("div");
  notif.className = "notification " + type;
  notif.textContent = message;
  document.body.appendChild(notif);

  setTimeout(() => notif.remove(), 4000);
}

async function cancelDownload(id) {
  if (!confirm("Tem certeza que deseja cancelar este download?")) {
    return;
  }

  try {
    const res = await fetch(`/bridge/cancel/${id}`, {
      method: "POST",
      credentials: "include",
    });

    if (res.status === 401) return (window.location.href = "/admin/login");

    const data = await res.json();

    if (res.ok) {
      showNotification(data.message || "Download cancelado", "info");
      loadStatus();
    } else {
      showNotification(data.error || "Erro ao cancelar", "error");
    }
  } catch (e) {
    console.error(e);
    showNotification("Erro de conexão ao cancelar", "error");
  }
}

async function removeDownload(id) {
  try {
    const res = await fetch(`/bridge/cancel/${id}`, {
      method: "POST",
      credentials: "include",
    });

    if (res.status === 401) return (window.location.href = "/admin/login");

    const data = await res.json();

    if (res.ok) {
      showNotification(data.message || "Download removido", "info");
      loadStatus();
    } else {
      showNotification(data.error || "Erro ao remover", "error");
    }
  } catch (e) {
    console.error(e);
    showNotification("Erro ao remover download", "error");
  }
}

function switchInputTab(tab) {
  document
    .querySelectorAll(".tabs .tab")
    .forEach((t) => t.classList.remove("active"));
  event.target.classList.add("active");

  if (tab === "magnet") {
    document.getElementById("magnet-section").classList.remove("hidden");
    document.getElementById("torrent-section").classList.remove("active");
  } else {
    document.getElementById("magnet-section").classList.add("hidden");
    document.getElementById("torrent-section").classList.add("active");
  }
}

function switchSection(section) {
  document
    .querySelectorAll(".section-tab")
    .forEach((t) => t.classList.remove("active"));
  event.target.classList.add("active");
  document
    .querySelectorAll(".section")
    .forEach((s) => s.classList.remove("active"));
  document.getElementById(section + "-section").classList.add("active");

  // Carrega jogos quando a aba for clicada
  if (section === "games") {
    loadGames();
  }
}

function handleFileSelect(input) {
  if (input.files && input.files[0]) {
    selectedFile = input.files[0];
    document.getElementById("selectedFile").textContent =
      "✓ " + selectedFile.name;
    document.getElementById("uploadTorrentBtn").classList.add("show");
  }
}

// Drag and Drop handlers
const dropZone = document.getElementById("torrent-section");
if (dropZone) {
  dropZone.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropZone.classList.add("dragover");
  });
  dropZone.addEventListener("dragleave", () =>
    dropZone.classList.remove("dragover")
  );
  dropZone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropZone.classList.remove("dragover");
    if (e.dataTransfer.files[0]?.name.endsWith(".torrent")) {
      document.getElementById("torrentFile").files = e.dataTransfer.files;
      handleFileSelect(document.getElementById("torrentFile"));
    } else {
      alert("Apenas arquivos .torrent são permitidos!");
    }
  });
}

// Função para formatar tamanho
function formatSize(bytes) {
  if (bytes > 1024 * 1024 * 1024) {
    return (bytes / 1024 / 1024 / 1024).toFixed(2) + " GB";
  }
  return (bytes / 1024 / 1024).toFixed(2) + " MB";
}

// Função para exibir modal de preview
function showTorrentPreview(info, onConfirm) {
  const modal = document.createElement("div");
  modal.className = "modal-overlay";
  modal.innerHTML = `
    <div class="modal-content" style="max-width: 600px; max-height: 80vh; overflow-y: auto;">
      <div class="modal-header">
        <h2>📋 Pré-visualização do Torrent</h2>
        <button class="modal-close" onclick="this.closest('.modal-overlay').remove()">✕</button>
      </div>
      <div class="modal-body">
        <div style="margin-bottom: 20px;">
          <strong>Nome:</strong> ${escapeHtml(info.name || "Desconhecido")}
        </div>
        <div style="margin-bottom: 20px;">
          <strong>Info Hash:</strong> <code style="font-size: 0.85em;">${
            info.infoHash || "N/A"
          }</code>
        </div>
        <div style="margin-bottom: 20px;">
          <strong>Total de arquivos:</strong> ${info.totalFiles}
          ${
            info.gameFiles > 0
              ? ` • <span style="color: var(--success);">🎮 ${info.gameFiles} jogos</span>`
              : ""
          }
        </div>
        <div style="margin-bottom: 20px;">
          <strong>Tamanho total:</strong> ${formatSize(info.totalSize)}
          ${
            info.gameFiles > 0
              ? ` • <span style="color: var(--success);">Jogos: ${formatSize(
                  info.totalGameSize
                )}</span>`
              : ""
          }
        </div>
        <div style="margin-top: 20px;">
          <strong>Arquivos:</strong>
          <div style="max-height: 300px; overflow-y: auto; margin-top: 10px; padding: 10px; background: var(--card); border-radius: 8px; border: 1px solid var(--border);">
            ${info.files
              .map(
                (f, i) => `
              <div style="padding: 5px 0; border-bottom: 1px solid var(--border); font-size: 0.9em;">
                ${f.isGame ? "🎮" : "📄"} ${escapeHtml(
                  f.name
                )} <span style="color: var(--text-muted);">(${formatSize(
                  f.size
                )})</span>
              </div>
            `
              )
              .join("")}
          </div>
        </div>
      </div>
      <div class="modal-footer" style="display: flex; gap: 10px; justify-content: flex-end; margin-top: 20px;">
        <button onclick="this.closest('.modal-overlay').remove()" style="padding: 10px 20px; background: var(--card); border: 1px solid var(--border); border-radius: 8px; cursor: pointer;">
          Cancelar
        </button>
        <button id="confirm-download-btn" style="padding: 10px 20px; background: var(--primary); color: white; border: none; border-radius: 8px; cursor: pointer; font-weight: bold;">
          ✅ Confirmar Download
        </button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  // Adiciona handler de confirmação
  const confirmBtn = modal.querySelector("#confirm-download-btn");
  confirmBtn.addEventListener("click", () => {
    modal.remove();
    onConfirm();
  });

  // Fecha ao clicar fora
  modal.addEventListener("click", (e) => {
    if (e.target === modal) modal.remove();
  });
}

async function uploadMagnet() {
  const magnet = document.getElementById("magnet").value.trim();
  if (!magnet) return alert("Cole um magnet link!");

  const btn = document.getElementById("uploadBtn");
  btn.innerText = "Analisando...";
  btn.disabled = true;

  try {
    // Primeiro, faz preview do torrent
    const previewRes = await fetch("/bridge/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ magnet }),
    });

    if (previewRes.status === 401)
      return (window.location.href = "/admin/login");

    const previewData = await previewRes.json();

    if (!previewRes.ok) {
      alert(previewData.error || "Erro ao analisar torrent");
      btn.innerText = "🚀 Iniciar";
      btn.disabled = false;
      return;
    }

    // Mostra preview e aguarda confirmação
    showTorrentPreview(previewData.info, async () => {
      btn.innerText = "Enviando...";

      try {
        const res = await fetch("/bridge/upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ magnet }),
        });

        if (res.status === 401) return (window.location.href = "/admin/login");

        const data = await res.json();
        if (res.ok) {
          document.getElementById("magnet").value = "";
          if (data.queued) {
            showNotification(
              `📋 Adicionado à fila (posição ${data.position})`,
              "info"
            );
          } else {
            showNotification("🚀 Download iniciado!", "success");
          }
          loadStatus();
        } else {
          alert(data.error || "Erro ao iniciar.");
        }
      } catch (e) {
        console.error(e);
        alert("Erro de conexão");
      }

      btn.innerText = "🚀 Iniciar";
      btn.disabled = false;
    });

    btn.innerText = "🚀 Iniciar";
    btn.disabled = false;
  } catch (e) {
    console.error(e);
    alert("Erro ao analisar torrent");
    btn.innerText = "🚀 Iniciar";
    btn.disabled = false;
  }
}

async function uploadTorrentFile() {
  if (!selectedFile) return alert("Selecione um arquivo .torrent!");

  const btn = document.getElementById("uploadTorrentBtn");
  btn.innerText = "Analisando...";
  btn.disabled = true;

  try {
    // Converte arquivo para base64 para preview
    const reader = new FileReader();
    reader.onload = async (e) => {
      const base64 = e.target.result.split(",")[1];

      try {
        // Primeiro, faz preview do torrent
        const previewRes = await fetch("/bridge/preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ torrentFile: base64 }),
        });

        if (previewRes.status === 401)
          return (window.location.href = "/admin/login");

        const previewData = await previewRes.json();

        if (!previewRes.ok) {
          alert(previewData.error || "Erro ao analisar torrent");
          btn.innerText = "🚀 Enviar";
          btn.disabled = false;
          return;
        }

        // Mostra preview e aguarda confirmação
        showTorrentPreview(previewData.info, async () => {
          btn.innerText = "Enviando...";

          const formData = new FormData();
          formData.append("torrentFile", selectedFile);

          try {
            const res = await fetch("/bridge/upload-torrent", {
              method: "POST",
              credentials: "include",
              body: formData,
            });

            if (res.status === 401)
              return (window.location.href = "/admin/login");

            const data = await res.json();
            if (res.ok) {
              document.getElementById("torrentFile").value = "";
              document.getElementById("selectedFile").textContent = "";
              document
                .getElementById("uploadTorrentBtn")
                .classList.remove("show");
              selectedFile = null;
              if (data.queued) {
                showNotification(
                  `📋 Adicionado à fila (posição ${data.position})`,
                  "info"
                );
              } else {
                showNotification("🚀 Download iniciado!", "success");
              }
              loadStatus();
            } else {
              alert(data.error || "Erro ao processar.");
            }
          } catch (e) {
            console.error(e);
            alert("Erro de conexão");
          }

          btn.innerText = "🚀 Enviar";
          btn.disabled = false;
        });

        btn.innerText = "🚀 Enviar";
        btn.disabled = false;
      } catch (e) {
        console.error(e);
        alert("Erro ao analisar torrent");
        btn.innerText = "🚀 Enviar";
        btn.disabled = false;
      }
    };

    reader.readAsDataURL(selectedFile);
  } catch (e) {
    console.error(e);
    alert("Erro ao ler arquivo");
    btn.innerText = "🚀 Enviar";
    btn.disabled = false;
  }
}

function getPhaseLabel(phase) {
  const labels = {
    connecting: "Conectando",
    downloading: "Baixando",
    uploading: "Enviando",
    done: "Concluído",
    error: "Erro",
  };
  return labels[phase] || phase;
}

function formatDuration(seconds) {
  if (seconds < 60) return seconds + "s";
  const mins = Math.floor(seconds / 60);
  if (mins < 60) return mins + "min";
  const hours = Math.floor(mins / 60);
  return hours + "h " + (mins % 60) + "m";
}

function formatTime(isoString) {
  const date = new Date(isoString);
  return date.toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

async function loadStatus() {
  try {
    const res = await fetch("/bridge/status", { credentials: "include" });
    if (res.status === 401) return (window.location.href = "/admin/login");

    const data = await res.json();
    const activeList = data.active || [];
    const queueList = data.queue || [];
    const completedList = data.completed || [];

    document.getElementById("active-count").textContent = activeList.length;
    document.getElementById("queue-count").textContent = queueList.length;
    document.getElementById("completed-count").textContent =
      completedList.length;

    // Render active downloads
    const container = document.getElementById("downloads-list");

    if (activeList.length === 0) {
      container.innerHTML =
        '<div class="empty">Nenhum download em andamento</div>';
      knownIds.clear();
    } else {
      const currentIds = new Set(activeList.map((item) => item.id));

      activeList.forEach((item) => {
        const existingCard = document.getElementById("card-" + item.id);
        const cardHtml = buildActiveCard(item);

        if (existingCard) {
          existingCard.className = "card " + item.phase;
          existingCard.innerHTML = cardHtml;
        } else {
          const div = document.createElement("div");
          div.id = "card-" + item.id;
          div.className = "card " + item.phase;
          div.innerHTML = cardHtml;

          const empty = container.querySelector(".empty");
          if (empty) empty.remove();

          container.appendChild(div);
        }
      });

      knownIds.forEach((id) => {
        if (!currentIds.has(id)) {
          const card = document.getElementById("card-" + id);
          if (card) card.remove();
        }
      });

      knownIds = currentIds;
    }

    // Render queue
    const queueContainer = document.getElementById("queue-list");
    if (queueList.length === 0) {
      queueContainer.innerHTML =
        '<div class="empty">Fila vazia - próximo download inicia automaticamente</div>';
    } else {
      queueContainer.innerHTML = queueList
        .map(
          (item) => `
                <div class="queue-card">
                    <div class="queue-info">
                        <div class="queue-name">${escapeHtml(item.name)}</div>
                        <div class="queue-meta">
                            ${
                              item.source === "magnet"
                                ? "🔗 Magnet"
                                : "📁 Torrent"
                            } • 
                            Adicionado às ${formatTime(item.addedAt)}
                        </div>
                    </div>
                    <span class="queue-position">#${item.position}</span>
                </div>
            `
        )
        .join("");
    }

    // Render completed
    const completedContainer = document.getElementById("completed-list");
    if (completedList.length === 0) {
      completedContainer.innerHTML =
        '<div class="empty">Nenhum download finalizado ainda</div>';
    } else {
      completedContainer.innerHTML = completedList
        .map(
          (item) => `
                <div class="completed-card">
                    <div class="completed-info">
                        <div class="completed-name">${escapeHtml(
                          item.name
                        )}</div>
                        <div class="completed-meta">
                            ${item.files} arquivo(s) • ${
            item.size
          } • ${formatDuration(item.duration)}
                        </div>
                    </div>
                    <span class="completed-badge">✓ Disponível</span>
                </div>
            `
        )
        .join("");
    }
  } catch (e) {
    console.error(e);
  }
}

function buildActiveCard(item) {
  const dl = item.download;
  const up = item.upload;
  const isError = item.phase === "error";
  const isDone = item.phase === "done";
  const isConnecting = item.phase === "connecting";
  const isDownloading = item.phase === "downloading";
  const isUploading = item.phase === "uploading";

  const downloadClass = dl.done
    ? "done"
    : isDownloading
    ? "download"
    : "inactive";
  const uploadClass = up.done ? "done" : isUploading ? "upload" : "inactive";

  // Calcula progresso do upload baseado no arquivo atual (melhorado)
  let uploadDisplayPercent = up.percent || 0;
  if (isUploading && up.currentFileProgress > 0 && up.totalFiles) {
    // Progresso = (arquivos completos + progresso do atual) / total
    const completedFiles = (up.fileIndex || 1) - 1;
    const currentProgress = up.currentFileProgress / 100;
    uploadDisplayPercent = parseFloat(
      (((completedFiles + currentProgress) / up.totalFiles) * 100).toFixed(1)
    );
  }

  // Status dinâmico baseado na fase (melhorado com mais detalhes)
  let statusText = "";
  if (isConnecting) {
    statusText = "🔍 Procurando peers...";
  } else if (isDownloading) {
    statusText = `📥 ${dl.downloaded} / ${dl.total} • ${dl.peers} peers • ETA: ${dl.eta}`;
  } else if (isUploading) {
    // Informações detalhadas do upload
    const fileIndex = up.fileIndex || 1;
    const totalFiles = up.totalFiles || 1;
    const currentFile = up.currentFile || "arquivo";
    const fileProgress = up.currentFileProgress || 0;
    const uploadedBytes = up.uploadedBytes || "0 MB";
    const uploadTotal = up.uploadTotal || "0 MB";
    const speed = up.speed || "-- MB/s";

    if (totalFiles > 1) {
      // Múltiplos arquivos: mostra arquivo atual e progresso
      const shortFileName =
        currentFile.length > 30
          ? currentFile.substring(0, 27) + "..."
          : currentFile;
      statusText = `📤 Arquivo ${fileIndex}/${totalFiles}: ${shortFileName} (${fileProgress.toFixed(
        1
      )}% - ${uploadedBytes}/${uploadTotal}) @ ${speed}`;
    } else {
      // Arquivo único: mostra progresso direto
      statusText = `📤 ${currentFile} (${fileProgress.toFixed(
        1
      )}% - ${uploadedBytes}/${uploadTotal}) @ ${speed}`;
    }
  } else if (isDone) {
    statusText = "✅ Disponível na loja!";
  }

  return `
        <div class="card-main">
            <div class="card-header">
                <div class="card-header-left">
                    <span class="game-name">${escapeHtml(item.name)}</span>
                    <span class="phase-badge phase-${
                      item.phase
                    }">${getPhaseLabel(item.phase)}</span>
                </div>
                ${
                  !isDone && !isError
                    ? `
                    <button class="cancel-btn" onclick="cancelDownload('${item.id}')" title="Cancelar download">
                        ✕ Cancelar
                    </button>
                `
                    : ""
                }
            </div>
            
            <div class="progress-group">
                <div class="progress-label">
                    <span class="title"><span class="icon">📥</span> Download</span>
                    <span class="value">${dl.percent}% ${
    dl.done ? "✓" : ""
  }</span>
                </div>
                <div class="progress-bar">
                    <div class="progress-fill ${downloadClass}" style="width: ${
    dl.percent
  }%"></div>
                </div>
            </div>

            <div class="progress-group">
                <div class="progress-label">
                    <span class="title"><span class="icon">📤</span> Upload Dropbox</span>
                    <span class="value">${uploadDisplayPercent}% ${
    up.done ? "✓" : ""
  }</span>
                </div>
                <div class="progress-bar">
                    <div class="progress-fill ${uploadClass}" style="width: ${uploadDisplayPercent}%"></div>
                </div>
            </div>
            
            <div class="status-text">${statusText}</div>
            
            ${
              isError
                ? `
                <div class="error-msg">❌ ${escapeHtml(item.error)}</div>
                <button class="remove-btn" onclick="removeDownload('${
                  item.id
                }')" title="Remover da lista">
                    🗑️ Remover
                </button>
                `
                : ""
            }
        </div>
        
        <div class="stats-row">
            <div class="stat">
                <span class="stat-icon">⚡</span>
                <span class="stat-value">${
                  isDownloading ? dl.speed : isUploading ? up.speed : "--"
                }</span>
            </div>
            <div class="stat">
                <span class="stat-icon">📊</span>
                <span class="stat-value">${
                  isUploading
                    ? up.uploaded + " / " + up.total
                    : dl.downloaded + " / " + dl.total
                }</span>
            </div>
            <div class="stat">
                <span class="stat-icon">${isUploading ? "📁" : "👥"}</span>
                <span class="stat-value">${
                  isUploading
                    ? up.currentFile
                      ? up.currentFile.substring(0, 20) + "..."
                      : "--"
                    : dl.peers + " peers"
                }</span>
            </div>
            <div class="stat">
                <span class="stat-icon">⏱️</span>
                <span class="stat-value">${
                  isDownloading ? dl.eta : isDone ? "Concluído" : "--:--"
                }</span>
            </div>
        </div>
    `;
}

// ═══════════════════════════════════════════════
// INDEX STATUS & REFRESH
// ═══════════════════════════════════════════════

async function loadIndexStatus() {
  try {
    const res = await fetch("/indexing-status");
    const data = await res.json();

    const badge = document.getElementById("index-status-badge");
    const countEl = document.getElementById("index-games-count");
    const lastUpdateEl = document.getElementById("index-last-update");
    const progressEl = document.getElementById("index-progress-text");
    const btn = document.getElementById("refresh-btn");

    // Exibe apenas jogos BASE na contagem principal
    if (data.stats) {
      countEl.textContent = data.stats.base || 0;
      // Opcional: adicionar tooltip ou texto adicional com detalhes
      countEl.title = `${data.stats.base} jogos base • ${data.stats.dlc} DLCs • ${data.stats.update} updates • ${data.stats.total} total`;
    } else {
      countEl.textContent = data.totalGames || 0;
    }

    if (data.lastUpdate) {
      const date = new Date(data.lastUpdate);
      lastUpdateEl.textContent =
        date.toLocaleTimeString("pt-BR", {
          hour: "2-digit",
          minute: "2-digit",
        }) +
        " - " +
        date.toLocaleDateString("pt-BR");
    } else {
      lastUpdateEl.textContent = "Nunca";
    }

    if (data.isIndexing) {
      badge.className = "status-badge indexing";
      badge.textContent = "Indexando...";
      progressEl.textContent = " • " + data.progress;
      btn.disabled = true;
      btn.classList.add("loading");
      btn.innerHTML = '<span class="icon">🔄</span> Indexando...';
    } else {
      badge.className = "status-badge online";
      badge.textContent = "Online";
      progressEl.textContent = "";
      btn.disabled = false;
      btn.classList.remove("loading");
      btn.innerHTML = '<span class="icon">🔄</span> Atualizar Índice';
    }
  } catch (e) {
    console.error("Erro ao carregar status do índice:", e);
  }
}

async function refreshIndex() {
  const btn = document.getElementById("refresh-btn");
  btn.disabled = true;
  btn.classList.add("loading");
  btn.innerHTML = '<span class="icon">🔄</span> Iniciando...';

  try {
    await fetch("/refresh");
    // Espera um pouco e recarrega o status
    setTimeout(loadIndexStatus, 500);
  } catch (e) {
    console.error("Erro ao iniciar refresh:", e);
    btn.disabled = false;
    btn.classList.remove("loading");
    btn.innerHTML = '<span class="icon">🔄</span> Atualizar Índice';
  }
}

// ═══════════════════════════════════════════════
// CREDENTIALS LOADER
// ═══════════════════════════════════════════════

async function loadUser() {
  try {
    const res = await fetch("/bridge/me", { credentials: "include" });
    if (res.status === 401) return (window.location.href = "/admin/login");

    const user = await res.json();
    const box = document.getElementById("user-status-box");
    box.classList.remove("hidden");

    if (user.isAdmin) {
      // É ADMIN
      document.getElementById("admin-panel").classList.remove("hidden");
      loadPendingUsers();
      box.innerHTML = `
                <h3>👑 Admin Master</h3>
                <p style="color: var(--text-muted); margin-top: 10px;">Você tem controle total do sistema.</p>
            `;
    } else if (user.isApproved) {
      // É USUÁRIO APROVADO
      box.style.borderColor = "var(--success)";
      box.innerHTML = `
                <h3>🔑 Suas Credenciais Tinfoil</h3>
                <div class="cred-grid">
                    <div class="cred-item">
                        <label>Protocol</label>
                        <code>https</code>
                    </div>
                    <div class="cred-item">
                        <label>Host</label>
                        <code>${escapeHtml(user.host)}</code>
                    </div>
                    <div class="cred-item">
                        <label>Username</label>
                        <code>${escapeHtml(user.tinfoilUser)}</code>
                    </div>
                    <div class="cred-item">
                        <label>Password</label>
                        <code id="tinfoil-pass-display" style="color: var(--warning); letter-spacing: 2px;">••••••</code>
                    </div>
                </div>
                <div class="cred-footer" style="display: flex; justify-content: space-between; align-items: center; margin-top: 15px;">
                    <span>Configure isso na aba "File Browser" do Switch.</span>
                    <button onclick="regenerateCreds()" style="background: transparent; border: 1px solid var(--text-muted); padding: 6px 12px; font-size: 0.75rem; cursor: pointer; border-radius: 4px; color: var(--text);">
                        🔄 Gerar Nova Senha
                    </button>
                </div>
            `;
    } else {
      // É USUÁRIO PENDENTE
      box.style.borderColor = "var(--warning)";
      box.innerHTML = `
                <h3 style="color: var(--warning)">⏳ Aguardando Aprovação</h3>
                <p style="color: var(--text-muted); margin-top: 10px;">
                    Seu cadastro foi recebido. Você receberá um e-mail com suas credenciais assim que o administrador aprovar.
                </p>
            `;
      // Esconde ferramentas de upload
      const tabs = document.querySelector(".tabs");
      const addBox = document.querySelector(".add-box");
      if (tabs) tabs.style.display = "none";
      if (addBox) addBox.style.display = "none";
    }
  } catch (e) {
    console.error("Erro ao carregar usuário:", e);
  }
}

async function loadPendingUsers() {
  try {
    const res = await fetch("/bridge/users/pending", {
      credentials: "include",
    });
    if (res.status === 401) return;

    const users = await res.json();
    const list = document.getElementById("pending-list");

    if (users.length === 0) {
      list.innerHTML = '<div class="empty">Nenhuma solicitação pendente.</div>';
      return;
    }

    list.innerHTML = users
      .map(
        (u) => `
            <div class="card">
                <div class="card-header">
                    <span class="game-name">${escapeHtml(u.email)}</span>
                    <div>
                        <button class="approve-btn" onclick="approveUser('${
                          u._id
                        }')">✅ Aprovar</button>
                        <button class="reject-btn" onclick="rejectUser('${
                          u._id
                        }')">❌ Rejeitar</button>
                    </div>
                </div>
                <div class="status-text">
                    Cadastrado em ${new Date(u.createdAt).toLocaleString(
                      "pt-BR"
                    )}
                </div>
            </div>
        `
      )
      .join("");
  } catch (e) {
    console.error("Erro ao carregar pendentes:", e);
  }
}

async function approveUser(id) {
  if (!confirm("Aprovar este usuário e enviar email com credenciais?")) return;
  try {
    const res = await fetch("/bridge/users/approve/" + id, {
      method: "POST",
      credentials: "include",
    });
    if (res.ok) {
      showNotification("✅ Usuário aprovado! Email enviado.", "success");
      loadPendingUsers();
    } else {
      showNotification("Erro ao aprovar", "error");
    }
  } catch (e) {
    console.error(e);
    showNotification("Erro de conexão", "error");
  }
}

async function rejectUser(id) {
  if (!confirm("Rejeitar e deletar este usuário?")) return;
  try {
    const res = await fetch("/bridge/users/reject/" + id, {
      method: "POST",
      credentials: "include",
    });
    if (res.ok) {
      showNotification("❌ Usuário rejeitado", "info");
      loadPendingUsers();
    } else {
      showNotification("Erro ao rejeitar", "error");
    }
  } catch (e) {
    console.error(e);
    showNotification("Erro de conexão", "error");
  }
}

// Função para identificar tipo de jogo
function getGameType(titleId) {
  if (!titleId || titleId.length !== 16) return "UNKNOWN";
  const suffix = titleId.slice(-3).toUpperCase();
  if (suffix === "800") return "UPDATE";
  if (suffix === "000") return "BASE";
  return "DLC";
}

// Função para contar jogos por tipo
function countGamesByType(games) {
  const counts = {
    base: 0,
    dlc: 0,
    update: 0,
    unknown: 0,
    total: games.length,
  };
  games.forEach((game) => {
    const type = getGameType(game.id);
    if (type === "BASE") counts.base++;
    else if (type === "DLC") counts.dlc++;
    else if (type === "UPDATE") counts.update++;
    else counts.unknown++;
  });
  return counts;
}

// Função para carregar jogos
async function loadGames() {
  try {
    const res = await fetch("/bridge/games", { credentials: "include" });
    if (res.status === 401) return (window.location.href = "/admin/login");

    const data = await res.json();
    allGames = data.games || [];

    // Conta apenas jogos BASE para exibição
    const counts = countGamesByType(allGames);
    document.getElementById("games-count").textContent = counts.base;

    // Se houver stats no response, mostra detalhes
    if (data.stats) {
      const statsText = `${counts.base} base${
        counts.dlc > 0 ? ` • ${counts.dlc} DLCs` : ""
      }${counts.update > 0 ? ` • ${counts.update} updates` : ""}`;
      // Pode adicionar um tooltip ou texto adicional se quiser
    }

    renderGames(allGames);
  } catch (e) {
    console.error("Erro ao carregar jogos:", e);
    document.getElementById("games-list").innerHTML =
      '<div class="empty">Erro ao carregar jogos</div>';
  }
}

// Função para renderizar jogos (LÓGICA DE IDS REFINADA v2)
function renderGames(games) {
  const list = document.getElementById("games-list");

  if (games.length === 0) {
    list.innerHTML = '<div class="empty">Nenhum jogo encontrado</div>';
    return;
  }

  list.innerHTML = games
    .map((game) => {
      const sizeGB = (game.size / 1024 / 1024 / 1024).toFixed(2);
      const sizeMB = (game.size / 1024 / 1024).toFixed(2);
      const sizeDisplay =
        game.size > 1024 * 1024 * 1024 ? `${sizeGB} GB` : `${sizeMB} MB`;

      let imgUrl =
        "https://upload.wikimedia.org/wikipedia/commons/a/ac/No_image_available.svg";
      let badgeHtml = "";
      let tinfoilUrl = "#";

      if (game.id) {
        // Padrão Nintendo: 16 chars Hex
        const suffix = game.id.slice(-3).toUpperCase();

        // 1. Definição do Tipo (Base, Update, DLC)
        let type = "BASE";
        if (suffix === "800") type = "UPDATE";
        else if (suffix !== "000") type = "DLC";

        // 2. Lógica para encontrar o ID da Imagem (Capa do Jogo Base)
        let imageId = game.id; // Por padrão tenta o próprio ID

        if (type === "UPDATE") {
          // Update é fácil: muda final 800 para 000
          imageId = game.id.substring(0, 13) + "000";
          badgeHtml = `<span class="type-badge badge-upd">UPDATE</span>`;
        } else if (type === "DLC") {
          badgeHtml = `<span class="type-badge badge-dlc">DLC</span>`;

          // --- ESTRATÉGIA HÍBRIDA PARA CAPA DE DLC ---

          // A) Tentativa de encontrar o Pai na lista atual (Application Group Match)
          // Os primeiros 12 caracteres (Application Group) geralmente são iguais
          const appGroup = game.id.substring(0, 12);

          // Procura na memória global (allGames) algum jogo que comece igual e termine em 000
          const parentGame = allGames.find(
            (g) => g.id && g.id.startsWith(appGroup) && g.id.endsWith("000")
          );

          if (parentGame) {
            // [Sucesso Absoluto] Encontramos o pai na lista
            imageId = parentGame.id;
          } else {
            // B) Fallback Heurístico (Engenharia Reversa de Nibble)
            // Muitas vezes a DLC incrementa o 13º digito. Ex: Base ...E000 -> DLC ...F001
            // Vamos tentar subtrair 1 do 13º digito hexadecimal
            try {
              const nibbleChar = game.id[12]; // 13º char (índice 12)
              const nibbleVal = parseInt(nibbleChar, 16);

              if (!isNaN(nibbleVal) && nibbleVal > 0) {
                const prevNibble = (nibbleVal - 1).toString(16).toUpperCase();
                imageId = appGroup + prevNibble + "000";
              } else {
                // Se for 0 ou falhar, fallback burro para o padrão
                imageId = game.id.substring(0, 13) + "000";
              }
            } catch (e) {
              imageId = game.id.substring(0, 13) + "000";
            }
          }
        }

        // Define URLs finais
        imgUrl = `https://tinfoil.media/ti/${imageId}/256/256/`;
        tinfoilUrl = `https://tinfoil.io/Title/${imageId}`; // Link info aponta pro base
      }

      return `
      <div class="card" style="display: flex; gap: 15px; padding: 15px; align-items: center;">
        
        <div style="flex-shrink: 0; position: relative; width: 80px; height: 80px;">
          <img src="${escapeHtml(imgUrl)}" 
               alt="${escapeHtml(game.name)}" 
               style="width: 100%; height: 100%; border-radius: 8px; object-fit: cover; background: #000;"
               onerror="this.src='https://upload.wikimedia.org/wikipedia/commons/a/ac/No_image_available.svg'">
          
          ${badgeHtml}
        </div>

        <div style="flex: 1; min-width: 0;">
          <div class="card-header" style="margin-bottom: 5px;">
            <span class="game-name" title="${escapeHtml(
              game.name
            )}" style="font-size: 1rem;">${escapeHtml(game.name)}</span>
          </div>
          
          <div style="display: flex; gap: 10px; font-size: 0.8rem; color: var(--text-muted); align-items: center;">
            <span class="status-badge online">${sizeDisplay}</span>
            ${
              game.id
                ? `<span class="status-badge" style="font-family: monospace; opacity: 0.7;">${escapeHtml(
                    game.id
                  )}</span>`
                : ""
            }
          </div>
          
          <div style="margin-top: 10px; display: flex; gap: 10px;">
            <button onclick="window.open('${escapeHtml(
              game.url
            )}', '_blank')" style="padding: 6px 12px; font-size: 0.75rem;">
              📥 Download
            </button>
            ${
              game.id
                ? `
              <button onclick="window.open('${escapeHtml(
                tinfoilUrl
              )}', '_blank')" style="padding: 6px 12px; font-size: 0.75rem; background: #222; border: 1px solid #444;">
                🔗 Info
              </button>
            `
                : ""
            }
          </div>
        </div>
      </div>
    `;
    })
    .join("");
}

// Função para filtrar jogos
function filterGames() {
  const searchTerm = document
    .getElementById("game-search")
    .value.toLowerCase()
    .trim();

  if (!searchTerm) {
    renderGames(allGames);
    return;
  }

  const filtered = allGames.filter((game) =>
    game.name.toLowerCase().includes(searchTerm)
  );

  renderGames(filtered);
}

// ═══════════════════════════════════════════════
// REGENERAR CREDENCIAIS TINFOIL
// ═══════════════════════════════════════════════

async function regenerateCreds() {
  if (
    !confirm(
      "⚠️ ATENÇÃO: Isso vai invalidar sua senha atual no Switch.\n\nO servidor vai gerar uma nova senha aleatória e te mostrar UMA VEZ.\n\nDeseja continuar?"
    )
  ) {
    return;
  }

  const btn = event.target;
  const originalText = btn.innerText;
  btn.disabled = true;
  btn.innerText = "Gerando...";

  try {
    const res = await fetch("/bridge/regenerate-credentials", {
      method: "POST",
      credentials: "include",
    });

    const data = await res.json();

    if (res.ok) {
      const codeEl = document.getElementById("tinfoil-pass-display");
      codeEl.innerText = data.newPass;
      codeEl.style.color = "var(--success)";
      codeEl.style.letterSpacing = "normal";

      showNotification("✅ Nova senha gerada! Copie agora.", "success");
      btn.innerText = "Senha Gerada!";

      // Alerta visual extra
      alert(
        `Sua nova senha é: ${data.newPass}\n\nCopie e atualize no Switch agora. Ela não será mostrada novamente.`
      );
    } else {
      showNotification(data.error || "Erro ao gerar senha", "error");
      btn.innerText = originalText;
      btn.disabled = false;
    }
  } catch (e) {
    console.error(e);
    showNotification("Erro de conexão", "error");
    btn.innerText = originalText;
    btn.disabled = false;
  }
}

// ═══════════════════════════════════════════════
// INITIALIZATION
// ═══════════════════════════════════════════════

// Carrega status inicial e atualiza a cada 2 segundos
setInterval(loadStatus, 2000);
loadStatus();

// Enter key handler para magnet input
const magnetInput = document.getElementById("magnet");
if (magnetInput) {
  magnetInput.addEventListener("keypress", (e) => {
    if (e.key === "Enter") uploadMagnet();
  });
}

// Carrega dados iniciais
loadUser();
loadIndexStatus();
setInterval(loadIndexStatus, 2000);
