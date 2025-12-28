/**
 * TEMPLATES HTML/CSS - Mana Bridge Frontend
 * Separado do backend para melhor organização
 */

export function loginTemplate() {
  return `
<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Mana Shop | Login</title>
    <style>
        :root { 
            --bg: #0f172a; 
            --card: #1e293b; 
            --text: #f1f5f9; 
            --primary: #3b82f6; 
            --error: #ef4444; 
        }
        * { box-sizing: border-box; }
        body { 
            background: var(--bg); 
            color: var(--text); 
            font-family: 'Segoe UI', sans-serif; 
            display: flex; 
            align-items: center; 
            justify-content: center; 
            height: 100vh; 
            margin: 0; 
        }
        .login-card { 
            background: var(--card); 
            padding: 2.5rem; 
            border-radius: 16px; 
            width: 100%; 
            max-width: 350px; 
            box-shadow: 0 10px 25px rgba(0,0,0,0.3); 
            text-align: center; 
        }
        h2 { 
            margin-bottom: 1.5rem; 
            font-weight: 600; 
            color: #fff; 
        }
        input { 
            width: 100%; 
            padding: 12px; 
            margin-bottom: 15px; 
            background: #334155; 
            border: 1px solid #475569; 
            border-radius: 8px; 
            color: white; 
            outline: none; 
        }
        input:focus { border-color: var(--primary); }
        button { 
            width: 100%; 
            padding: 12px; 
            background: var(--primary); 
            color: white; 
            border: none; 
            border-radius: 8px; 
            cursor: pointer; 
            font-weight: bold; 
            transition: 0.2s; 
        }
        button:hover { opacity: 0.9; }
        button:disabled { opacity: 0.5; cursor: not-allowed; }
        .logo { font-size: 3rem; margin-bottom: 10px; display: block; }
        .error { 
            color: var(--error); 
            font-size: 0.9rem; 
            margin-bottom: 15px; 
            display: none; 
        }
        .error.show { display: block; }
    </style>
</head>
<body>
    <div class="login-card">
        <span class="logo">🎮</span>
        <h2>Mana Admin</h2>
        <div id="error" class="error"></div>
        <form id="loginForm">
            <input type="email" id="email" placeholder="Email" required autocomplete="email">
            <input type="password" id="password" placeholder="Senha" required autocomplete="current-password">
            <button type="submit" id="submitBtn">Entrar</button>
        </form>
    </div>
    <script>
        document.getElementById('loginForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const email = document.getElementById('email').value;
            const password = document.getElementById('password').value;
            const errorDiv = document.getElementById('error');
            const btn = document.getElementById('submitBtn');
            
            errorDiv.classList.remove('show');
            btn.disabled = true;
            btn.innerText = 'Entrando...';
            
            try {
                const res = await fetch('/bridge/auth', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    credentials: 'include',
                    body: JSON.stringify({ email, password })
                });
                
                const data = await res.json();
                
                if (res.ok && data.success) {
                    setTimeout(() => {
                        window.location.href = data.redirect || '/admin';
                    }, 100);
                } else {
                    errorDiv.innerText = data.error || 'Acesso Negado';
                    errorDiv.classList.add('show');
                    btn.disabled = false;
                    btn.innerText = 'Entrar';
                }
            } catch(err) {
                console.error(err);
                errorDiv.innerText = 'Erro de conexão. Tente novamente.';
                errorDiv.classList.add('show');
                btn.disabled = false;
                btn.innerText = 'Entrar';
            }
        });
    </script>
</body>
</html>
`;
}

export function dashboardTemplate() {
  return `
<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Mana Shop | Dashboard</title>
    <style>
        :root { 
            --bg: #0f172a; 
            --card: #1e293b; 
            --text: #94a3b8; 
            --white: #f8fafc; 
            --primary: #6366f1; 
            --success: #10b981; 
            --error: #ef4444; 
            --warning: #f59e0b; 
        }
        * { box-sizing: border-box; }
        body { 
            background: var(--bg); 
            color: var(--text); 
            font-family: 'Segoe UI', sans-serif; 
            margin: 0; 
            padding: 20px; 
        }
        .container { max-width: 800px; margin: 0 auto; }
        
        /* Header */
        header { 
            display: flex; 
            justify-content: space-between; 
            align-items: center; 
            margin-bottom: 40px; 
            flex-wrap: wrap; 
            gap: 10px; 
        }
        h1 { 
            color: var(--white); 
            font-size: 1.5rem; 
            display: flex; 
            align-items: center; 
            gap: 10px; 
            margin: 0; 
        }
        .badge { 
            background: #334155; 
            padding: 5px 10px; 
            border-radius: 20px; 
            font-size: 0.8rem; 
        }
        .logout { 
            color: var(--text); 
            text-decoration: none; 
            font-size: 0.9rem; 
        }
        .logout:hover { color: var(--error); }
        
        /* Tabs */
        .tabs { display: flex; gap: 10px; margin-bottom: 20px; }
        .tab { 
            padding: 10px 20px; 
            background: var(--card); 
            border: none; 
            border-radius: 8px; 
            color: var(--text); 
            cursor: pointer; 
            transition: 0.2s; 
        }
        .tab.active { background: var(--primary); color: white; }
        .tab:hover:not(.active) { background: #334155; }
        
        /* Add Section */
        .add-box { 
            background: var(--card); 
            padding: 20px; 
            border-radius: 12px; 
            box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1); 
        }
        .input-row { display: flex; gap: 10px; flex-wrap: wrap; }
        input[type="text"] { 
            flex: 1; 
            padding: 12px; 
            background: #0f172a; 
            border: 1px solid #334155; 
            border-radius: 8px; 
            color: white; 
            min-width: 200px; 
        }
        button { 
            padding: 12px 24px; 
            background: var(--primary); 
            color: white; 
            border: none; 
            border-radius: 8px; 
            cursor: pointer; 
            font-weight: 600; 
        }
        button:hover { opacity: 0.9; }
        button:disabled { opacity: 0.5; cursor: not-allowed; }
        
        /* File Upload */
        .upload-zone { 
            display: none; 
            border: 2px dashed #475569; 
            border-radius: 12px; 
            padding: 40px 20px; 
            text-align: center; 
            cursor: pointer; 
            transition: 0.2s; 
        }
        .upload-zone:hover, .upload-zone.dragover { 
            border-color: var(--primary); 
            background: rgba(99, 102, 241, 0.1); 
        }
        .upload-zone.active { display: block; }
        .upload-zone input { display: none; }
        .upload-zone .icon { font-size: 3rem; margin-bottom: 10px; }
        .upload-zone p { margin: 0; color: var(--text); }
        .upload-zone .file-name { 
            color: var(--success); 
            font-weight: 600; 
            margin-top: 10px; 
        }
        .upload-btn { margin-top: 15px; display: none; }
        .upload-btn.show { display: inline-block; }

        /* List Section */
        h3 { margin-top: 30px; color: var(--white); font-weight: 500; }
        .grid { display: grid; gap: 15px; margin-top: 15px; }
        .card { 
            background: var(--card); 
            padding: 20px; 
            border-radius: 10px; 
            border-left: 4px solid var(--primary); 
            animation: fadeIn 0.3s ease; 
        }
        .card.success { border-left-color: var(--success); }
        .card.error { border-left-color: var(--error); }
        .card-header { 
            display: flex; 
            justify-content: space-between; 
            margin-bottom: 10px; 
        }
        .game-name { 
            color: var(--white); 
            font-weight: 600; 
            word-break: break-all; 
        }
        .speed { 
            font-size: 0.85rem; 
            color: var(--text); 
            white-space: nowrap; 
        }
        
        /* Progress Bar */
        .progress-bg { 
            height: 6px; 
            background: #334155; 
            border-radius: 3px; 
            overflow: hidden; 
        }
        .progress-fill { 
            height: 100%; 
            background: linear-gradient(90deg, var(--primary), var(--success)); 
            width: 0%; 
            transition: width 0.5s ease; 
        }
        .status-text { font-size: 0.8rem; margin-top: 8px; display: block; }

        .empty { text-align: center; padding: 40px 20px; opacity: 0.5; }
        .hidden { display: none !important; }
        
        @keyframes fadeIn { 
            from { opacity: 0; transform: translateY(10px); } 
            to { opacity: 1; transform: translateY(0); } 
        }
    </style>
</head>
<body>
    <div class="container">
        <header>
            <h1>🎮 Mana Bridge <span class="badge">v5.0</span></h1>
            <a href="/admin/logout" class="logout">🚪 Sair</a>
        </header>

        <!-- Tabs -->
        <div class="tabs">
            <button class="tab active" onclick="switchTab('magnet')">🔗 Magnet Link</button>
            <button class="tab" onclick="switchTab('torrent')">📁 Arquivo .torrent</button>
        </div>

        <div class="add-box">
            <!-- Magnet Input -->
            <div id="magnet-section" class="input-row">
                <input type="text" id="magnet" placeholder="Cole o Magnet Link aqui..." autocomplete="off">
                <button id="uploadBtn" onclick="uploadMagnet()">🚀 Iniciar</button>
            </div>
            
            <!-- Torrent File Upload -->
            <div id="torrent-section" class="upload-zone" onclick="document.getElementById('torrentFile').click()">
                <input type="file" id="torrentFile" accept=".torrent" onchange="handleFileSelect(this)">
                <div class="icon">📁</div>
                <p>Clique ou arraste um arquivo <strong>.torrent</strong> aqui</p>
                <div id="selectedFile" class="file-name"></div>
                <button id="uploadTorrentBtn" class="upload-btn" onclick="event.stopPropagation(); uploadTorrentFile()">🚀 Enviar Torrent</button>
            </div>
        </div>

        <h3>Downloads Ativos</h3>
        <div id="downloads-list" class="grid">
            <div class="empty">Nenhum download ativo no momento.</div>
        </div>
    </div>

    <script>
        let selectedFile = null;
        
        // Tab switching
        function switchTab(tab) {
            document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            event.target.classList.add('active');
            
            if (tab === 'magnet') {
                document.getElementById('magnet-section').classList.remove('hidden');
                document.getElementById('torrent-section').classList.remove('active');
            } else {
                document.getElementById('magnet-section').classList.add('hidden');
                document.getElementById('torrent-section').classList.add('active');
            }
        }
        
        // File handling
        function handleFileSelect(input) {
            if (input.files && input.files[0]) {
                selectedFile = input.files[0];
                document.getElementById('selectedFile').textContent = '✅ ' + selectedFile.name;
                document.getElementById('uploadTorrentBtn').classList.add('show');
            }
        }
        
        // Drag and drop
        const dropZone = document.getElementById('torrent-section');
        dropZone.addEventListener('dragover', (e) => { 
            e.preventDefault(); 
            dropZone.classList.add('dragover'); 
        });
        dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
        dropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            dropZone.classList.remove('dragover');
            if (e.dataTransfer.files[0]?.name.endsWith('.torrent')) {
                document.getElementById('torrentFile').files = e.dataTransfer.files;
                handleFileSelect(document.getElementById('torrentFile'));
            } else {
                alert('Apenas arquivos .torrent são permitidos!');
            }
        });
        
        // Upload Magnet
        async function uploadMagnet() {
            const magnet = document.getElementById('magnet').value.trim();
            if (!magnet) return alert('Por favor, cole um link!');
            
            const btn = document.getElementById('uploadBtn');
            btn.innerText = 'Enviando...';
            btn.disabled = true;

            try {
                const res = await fetch('/bridge/upload', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    credentials: 'include',
                    body: JSON.stringify({ magnet })
                });
                
                if (res.status === 401) return window.location.href = '/admin/login';
                
                if(res.ok) {
                    document.getElementById('magnet').value = '';
                    loadStatus();
                } else {
                    const data = await res.json();
                    alert(data.error || 'Erro ao iniciar.');
                }
            } catch(e) { 
                console.error(e);
                alert('Erro de conexão');
            }
            
            btn.innerText = '🚀 Iniciar';
            btn.disabled = false;
        }
        
        // Upload Torrent File
        async function uploadTorrentFile() {
            if (!selectedFile) return alert('Selecione um arquivo .torrent primeiro!');
            
            const btn = document.getElementById('uploadTorrentBtn');
            btn.innerText = 'Enviando...';
            btn.disabled = true;
            
            const formData = new FormData();
            formData.append('torrentFile', selectedFile);

            try {
                const res = await fetch('/bridge/upload-torrent', {
                    method: 'POST',
                    credentials: 'include',
                    body: formData
                });
                
                if (res.status === 401) return window.location.href = '/admin/login';
                
                if(res.ok) {
                    document.getElementById('torrentFile').value = '';
                    document.getElementById('selectedFile').textContent = '';
                    document.getElementById('uploadTorrentBtn').classList.remove('show');
                    selectedFile = null;
                    loadStatus();
                } else {
                    const data = await res.json();
                    alert(data.error || 'Erro ao processar torrent.');
                }
            } catch(e) { 
                console.error(e);
                alert('Erro de conexão');
            }
            
            btn.innerText = '🚀 Enviar Torrent';
            btn.disabled = false;
        }

        async function loadStatus() {
            try {
                const res = await fetch('/bridge/status', { credentials: 'include' });
                if (res.status === 401) return window.location.href = '/admin/login';
                
                const list = await res.json();
                const container = document.getElementById('downloads-list');
                
                if (list.length === 0) {
                    container.innerHTML = '<div class="empty">Nenhum download ativo no momento.</div>';
                    return;
                }

                container.innerHTML = list.map(item => {
                    let cardClass = 'card';
                    if (item.status.includes('✅')) cardClass += ' success';
                    if (item.status.includes('❌')) cardClass += ' error';
                    
                    return \`
                        <div class="\${cardClass}">
                            <div class="card-header">
                                <span class="game-name">\${item.name}</span>
                                <span class="speed">\${item.speed}</span>
                            </div>
                            <div class="progress-bg">
                                <div class="progress-fill" style="width: \${item.percent}%"></div>
                            </div>
                            <span class="status-text">\${item.status} (\${item.percent}%)</span>
                        </div>
                    \`;
                }).join('');
            } catch(e) { console.error(e); }
        }

        // Auto refresh
        setInterval(loadStatus, 2000);
        loadStatus();
        
        // Enter to submit
        document.getElementById('magnet').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') uploadMagnet();
        });
    </script>
</body>
</html>
`;
}
