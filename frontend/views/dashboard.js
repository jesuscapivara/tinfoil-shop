/**
 * Dashboard View
 * HTML limpo sem CSS/JS inline
 */
export function dashboardView() {
  return `
<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Mana Shop | Dashboard</title>
    <link rel="stylesheet" href="/public/css/dashboard.css">
</head>
<body>
    <div class="container">
        <header>
            <h1>🎮 Mana Bridge <span class="badge">v6.0</span></h1>
            <div class="header-actions">
                <a href="/admin/logout" class="logout">Sair</a>
            </div>
        </header>

        <div id="user-status-box" class="credentials-box">
            <h3>🔑 Carregando...</h3>
            <div class="cred-grid">
                <div class="cred-item">
                    <label>Status</label>
                    <code id="user-status">Verificando...</code>
                </div>
            </div>
        </div>

        <div id="admin-panel" class="credentials-box hidden" style="border-color: var(--warning);">
            <h3>👑 Aprovações Pendentes</h3>
            <div id="pending-list" class="grid" style="margin-top: 15px;">
                <div class="empty">Carregando...</div>
            </div>
        </div>

        <div class="index-status">
            <div class="index-info">
                <div class="index-title">
                    📚 Índice de Jogos
                    <span id="index-status-badge" class="status-badge online">Online</span>
                </div>
                <div class="index-meta">
                    <span id="index-games-count">--</span> jogos indexados • 
                    Última atualização: <span id="index-last-update">--</span>
                    <span id="index-progress-text"></span>
                </div>
            </div>
            <button id="refresh-btn" class="refresh-btn" onclick="refreshIndex()">
                <span class="icon">🔄</span> Atualizar Índice
            </button>
        </div>

        <div class="tabs">
            <button class="tab active" onclick="switchInputTab('magnet')">🔗 Magnet</button>
            <button class="tab" onclick="switchInputTab('torrent')">📁 .torrent</button>
        </div>

        <div class="add-box">
            <div id="magnet-section" class="input-row">
                <input type="text" id="magnet" placeholder="Cole o Magnet Link aqui..." autocomplete="off">
                <button id="uploadBtn" onclick="uploadMagnet()">🚀 Iniciar</button>
            </div>
            
            <div id="torrent-section" class="upload-zone" onclick="document.getElementById('torrentFile').click()">
                <input type="file" id="torrentFile" accept=".torrent" onchange="handleFileSelect(this)">
                <div class="icon">📁</div>
                <p>Arraste um arquivo <strong>.torrent</strong></p>
                <div id="selectedFile" class="file-name"></div>
                <button id="uploadTorrentBtn" class="upload-btn" onclick="event.stopPropagation(); uploadTorrentFile()">🚀 Enviar</button>
            </div>
        </div>

        <div class="section-tabs">
            <button class="section-tab active" onclick="switchSection('active')">
                ⚡ Em andamento <span id="active-count" class="count">0</span>
            </button>
            <button class="section-tab" onclick="switchSection('queue')">
                📋 Na Fila <span id="queue-count" class="count">0</span>
            </button>
            <button class="section-tab" onclick="switchSection('completed')">
                ✓ Finalizados <span id="completed-count" class="count">0</span>
            </button>
            <button class="section-tab" onclick="switchSection('games')">
                🎮 Jogos <span id="games-count" class="count">0</span>
            </button>
        </div>

        <div id="active-section" class="section active">
            <div id="downloads-list" class="grid">
                <div class="empty">Nenhum download em andamento</div>
            </div>
        </div>

        <div id="queue-section" class="section">
            <div id="queue-list" class="grid">
                <div class="empty">Fila vazia</div>
            </div>
        </div>

        <div id="completed-section" class="section">
            <div id="completed-list" class="grid">
                <div class="empty">Nenhum download finalizado ainda</div>
            </div>
        </div>

        <div id="games-section" class="section">
            <div class="search-box" style="margin-bottom: 20px;">
                <input type="text" id="game-search" placeholder="🔍 Buscar jogos..." 
                       onkeyup="filterGames()" style="width: 100%; padding: 12px; border-radius: 8px; 
                       border: 1px solid var(--border); background: var(--card); color: var(--text);">
            </div>
            <div id="games-list" class="grid">
                <div class="empty">Carregando jogos...</div>
            </div>
        </div>
    </div>

    <script src="/public/js/dashboard-client.js"></script>
</body>
</html>
`;
}
