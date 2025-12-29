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
        .toggle-link {
            margin-top: 15px;
            display: block;
            color: var(--primary);
            text-decoration: none;
            font-size: 0.9rem;
            cursor: pointer;
        }
        .toggle-link:hover {
            text-decoration: underline;
        }
    </style>
</head>
<body>
    <div class="login-card">
        <span class="logo">🎮</span>
        <h2 id="formTitle">Mana Shop</h2>
        <div id="error" class="error"></div>
        
        <form id="loginForm">
            <input type="email" id="email" placeholder="Email" required autocomplete="email">
            <input type="password" id="password" placeholder="Senha" required autocomplete="current-password">
            <button type="submit" id="loginBtn">Entrar</button>
            <a class="toggle-link" onclick="toggleForm()">Não tem conta? Cadastre-se</a>
        </form>

        <form id="registerForm" style="display:none;">
            <input type="email" id="regEmail" placeholder="Seu Email" required>
            <input type="password" id="regPass" placeholder="Crie uma Senha (mín. 6 caracteres)" required>
            <button type="submit" id="regBtn">Solicitar Acesso</button>
            <a class="toggle-link" onclick="toggleForm()">Já tem conta? Entrar</a>
        </form>
    </div>
    <script>
        let isLogin = true;
        
        function toggleForm() {
            isLogin = !isLogin;
            document.getElementById('loginForm').style.display = isLogin ? 'block' : 'none';
            document.getElementById('registerForm').style.display = isLogin ? 'none' : 'block';
            document.getElementById('formTitle').innerText = isLogin ? 'Mana Shop' : 'Solicitar Acesso';
            document.getElementById('error').classList.remove('show');
        }

        // Lógica de Login
        document.getElementById('loginForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const email = document.getElementById('email').value;
            const password = document.getElementById('password').value;
            const errorDiv = document.getElementById('error');
            const btn = document.getElementById('loginBtn');
            
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
                    // Redireciona imediatamente
                    window.location.href = data.redirect || '/admin';
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

        // Lógica de Registro
        document.getElementById('registerForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            const btn = document.getElementById('regBtn');
            const errorDiv = document.getElementById('error');
            btn.disabled = true;
            btn.innerText = 'Enviando...';
            errorDiv.classList.remove('show');
            
            try {
                const res = await fetch('/bridge/register', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({
                        email: document.getElementById('regEmail').value,
                        password: document.getElementById('regPass').value
                    })
                });
                const data = await res.json();
                
                if (res.ok) {
                    alert("Solicitação enviada! Você receberá um e-mail quando for aprovado.");
                    location.reload();
                } else {
                    errorDiv.innerText = data.error || 'Erro ao cadastrar';
                    errorDiv.classList.add('show');
                }
            } catch(e) {
                errorDiv.innerText = "Erro de conexão";
                errorDiv.classList.add('show');
            }
            btn.disabled = false;
            btn.innerText = 'Solicitar Acesso';
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
            --bg: #0a0e14; 
            --card: #131a24; 
            --card-hover: #1a232e;
            --surface: #0d1117;
            --text: #8b9cb3; 
            --text-muted: #5a6a7e;
            --white: #e8ecf2; 
            --primary: #6366f1; 
            --success: #10b981; 
            --error: #ef4444; 
            --warning: #f59e0b;
            --cyan: #06b6d4;
            --border: #1e293b;
        }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { 
            background: var(--bg); 
            color: var(--text); 
            font-family: 'Segoe UI', -apple-system, sans-serif; 
            padding: 20px;
            min-height: 100vh;
        }
        .container { max-width: 900px; margin: 0 auto; }
        
        header { 
            display: flex; 
            justify-content: space-between; 
            align-items: center; 
            margin-bottom: 25px; 
            padding-bottom: 20px;
            border-bottom: 1px solid var(--border);
        }
        h1 { 
            color: var(--white); 
            font-size: 1.3rem; 
            display: flex; 
            align-items: center; 
            gap: 10px;
            font-weight: 500;
        }
        .badge { 
            background: linear-gradient(135deg, var(--primary), var(--cyan)); 
            padding: 3px 8px; 
            border-radius: 10px; 
            font-size: 0.65rem;
            font-weight: 600;
        }
        .header-actions {
            display: flex;
            align-items: center;
            gap: 12px;
        }
        .logout { 
            color: var(--text-muted); 
            text-decoration: none; 
            font-size: 0.8rem;
            transition: color 0.2s;
        }
        .logout:hover { color: var(--error); }
        
        /* Credentials Box */
        .credentials-box {
            background: linear-gradient(135deg, #1e293b, #0f172a);
            border: 1px solid var(--primary);
            border-radius: 12px;
            padding: 20px;
            margin-bottom: 30px;
            box-shadow: 0 4px 20px rgba(99, 102, 241, 0.15);
        }
        .credentials-box h3 {
            margin-top: 0;
            color: var(--white);
            margin-bottom: 15px;
            font-size: 1rem;
            font-weight: 600;
        }
        .cred-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
            gap: 15px;
        }
        .cred-item {
            background: rgba(0, 0, 0, 0.3);
            padding: 12px;
            border-radius: 8px;
            border: 1px solid rgba(99, 102, 241, 0.2);
        }
        .cred-item label {
            display: block;
            font-size: 0.75rem;
            color: var(--text-muted);
            margin-bottom: 6px;
            text-transform: uppercase;
            letter-spacing: 1px;
            font-weight: 600;
        }
        .cred-item code {
            color: var(--cyan);
            font-family: 'SF Mono', 'Consolas', monospace;
            font-size: 1rem;
            font-weight: bold;
            display: block;
            word-break: break-all;
        }
        .cred-footer {
            margin-top: 15px;
            font-size: 0.8rem;
            color: var(--text-muted);
            text-align: right;
            font-style: italic;
        }
        
        /* Admin Panel */
        .approve-btn, .reject-btn {
            padding: 6px 12px;
            border-radius: 6px;
            border: none;
            cursor: pointer;
            font-size: 0.75rem;
            font-weight: 600;
            margin-left: 6px;
            transition: opacity 0.2s;
        }
        .approve-btn {
            background: var(--success);
            color: white;
        }
        .approve-btn:hover {
            opacity: 0.85;
        }
        .reject-btn {
            background: var(--error);
            color: white;
        }
        .reject-btn:hover {
            opacity: 0.85;
        }
        
        /* Badges sobre a imagem */
        .type-badge {
            position: absolute;
            bottom: 0;
            right: 0;
            font-size: 0.65rem;
            font-weight: 800;
            padding: 2px 6px;
            border-top-left-radius: 6px;
            border-bottom-right-radius: 6px;
            color: white;
            box-shadow: -2px -2px 5px rgba(0,0,0,0.5);
            z-index: 10;
        }
        .badge-upd {
            background: linear-gradient(135deg, #f59e0b, #d97706); /* Laranja */
        }
        .badge-dlc {
            background: linear-gradient(135deg, #a855f7, #7e22ce); /* Roxo */
        }
        
        /* Index Status Box */
        .index-status {
            background: var(--card);
            border: 1px solid var(--border);
            border-radius: 10px;
            padding: 14px 18px;
            margin-bottom: 20px;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        .index-info {
            display: flex;
            flex-direction: column;
            gap: 4px;
        }
        .index-title {
            color: var(--white);
            font-weight: 500;
            font-size: 0.9rem;
            display: flex;
            align-items: center;
            gap: 8px;
        }
        .index-meta {
            font-size: 0.75rem;
            color: var(--text-muted);
        }
        .index-meta span {
            color: var(--text);
        }
        .refresh-btn {
            padding: 10px 18px;
            background: transparent;
            border: 1px solid var(--primary);
            color: var(--primary);
            border-radius: 6px;
            cursor: pointer;
            font-weight: 600;
            font-size: 0.8rem;
            transition: all 0.2s;
            display: flex;
            align-items: center;
            gap: 6px;
        }
        .refresh-btn:hover {
            background: var(--primary);
            color: white;
        }
        .refresh-btn:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }
        .refresh-btn.loading .icon {
            animation: spin 1s linear infinite;
        }
        @keyframes spin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
        }
        .status-badge {
            padding: 3px 8px;
            border-radius: 10px;
            font-size: 0.65rem;
            font-weight: 600;
        }
        .status-badge.online {
            background: rgba(16, 185, 129, 0.15);
            color: var(--success);
        }
        .status-badge.indexing {
            background: rgba(245, 158, 11, 0.15);
            color: var(--warning);
        }
        
        /* Tabs */
        .tabs { display: flex; gap: 6px; margin-bottom: 15px; }
        .tab { 
            padding: 8px 16px; 
            background: var(--card); 
            border: 1px solid transparent;
            border-radius: 6px; 
            color: var(--text); 
            cursor: pointer; 
            transition: all 0.2s;
            font-size: 0.85rem;
        }
        .tab.active { 
            background: transparent;
            border-color: var(--primary);
            color: var(--white); 
        }
        .tab:hover:not(.active) { background: var(--card-hover); }
        
        /* Add Section */
        .add-box { 
            background: var(--card); 
            padding: 16px; 
            border-radius: 10px;
            border: 1px solid var(--border);
        }
        .input-row { display: flex; gap: 10px; }
        input[type="text"] { 
            flex: 1; 
            padding: 12px 14px; 
            background: var(--bg); 
            border: 1px solid var(--border); 
            border-radius: 6px; 
            color: var(--white);
            font-size: 0.9rem;
            transition: border-color 0.2s;
        }
        input[type="text"]:focus { border-color: var(--primary); outline: none; }
        
        .search-box {
            margin-bottom: 20px;
        }
        .search-box input {
            width: 100%;
            padding: 12px 16px;
            background: var(--card);
            border: 1px solid var(--border);
            border-radius: 8px;
            color: var(--white);
            font-size: 0.95rem;
            transition: all 0.2s;
        }
        .search-box input:focus {
            border-color: var(--primary);
            outline: none;
            box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.1);
        }
        .search-box input::placeholder {
            color: var(--text-muted);
        }
        
        button { 
            padding: 12px 20px; 
            background: var(--primary); 
            color: white; 
            border: none; 
            border-radius: 6px; 
            cursor: pointer; 
            font-weight: 600;
            font-size: 0.85rem;
            transition: opacity 0.2s;
        }
        button:hover { opacity: 0.85; }
        button:disabled { opacity: 0.4; cursor: not-allowed; }
        
        /* File Upload */
        .upload-zone { 
            display: none; 
            border: 2px dashed var(--border); 
            border-radius: 10px; 
            padding: 40px 20px; 
            text-align: center; 
            cursor: pointer; 
            transition: all 0.2s; 
        }
        .upload-zone:hover, .upload-zone.dragover { 
            border-color: var(--primary); 
            background: rgba(99, 102, 241, 0.05); 
        }
        .upload-zone.active { display: block; }
        .upload-zone input { display: none; }
        .upload-zone .icon { font-size: 2rem; margin-bottom: 8px; opacity: 0.6; }
        .upload-zone p { color: var(--text-muted); font-size: 0.85rem; }
        .upload-zone .file-name { 
            color: var(--success); 
            font-weight: 600; 
            margin-top: 10px;
            font-size: 0.9rem;
        }
        .upload-btn { margin-top: 12px; display: none; }
        .upload-btn.show { display: inline-block; }

        /* Section Tabs */
        .section-tabs {
            display: flex;
            gap: 0;
            margin-top: 25px;
            border-bottom: 1px solid var(--border);
        }
        .section-tab {
            padding: 10px 20px;
            background: transparent;
            border: none;
            color: var(--text-muted);
            cursor: pointer;
            font-size: 0.85rem;
            position: relative;
            transition: color 0.2s;
        }
        .section-tab:hover { color: var(--text); }
        .section-tab.active { 
            color: var(--white);
        }
        .section-tab.active::after {
            content: '';
            position: absolute;
            bottom: -1px;
            left: 0;
            right: 0;
            height: 2px;
            background: var(--primary);
        }
        .section-tab .count {
            background: var(--card);
            padding: 2px 6px;
            border-radius: 8px;
            font-size: 0.7rem;
            margin-left: 6px;
        }
        .section-tab.active .count {
            background: var(--primary);
            color: white;
        }

        /* Sections */
        .section { display: none; padding-top: 15px; }
        .section.active { display: block; }
        
        .grid { display: grid; gap: 12px; }
        
        /* Card */
        .card { 
            background: var(--card); 
            border-radius: 10px;
            border: 1px solid var(--border);
            overflow: hidden;
        }
        .card.connecting { border-left: 3px solid var(--text-muted); }
        .card.downloading { border-left: 3px solid var(--cyan); }
        .card.uploading { border-left: 3px solid var(--warning); }
        .card.done { border-left: 3px solid var(--success); }
        .card.error { border-left: 3px solid var(--error); }
        
        .card-main { padding: 14px 16px; }
        .card-header { 
            display: flex; 
            justify-content: space-between;
            align-items: flex-start;
            gap: 12px;
            margin-bottom: 14px;
        }
        .card-header-left {
            display: flex;
            align-items: center;
            gap: 10px;
            flex: 1;
        }
        .cancel-btn {
            background: transparent;
            border: 1px solid var(--error);
            color: var(--error);
            padding: 4px 10px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 0.7rem;
            font-weight: 600;
            transition: all 0.2s;
            white-space: nowrap;
        }
        .cancel-btn:hover {
            background: var(--error);
            color: white;
        }
        .cancel-btn:disabled {
            opacity: 0.4;
            cursor: not-allowed;
        }
        .game-name { 
            color: var(--white); 
            font-weight: 600;
            font-size: 0.9rem;
            line-height: 1.3;
        }
        .phase-badge {
            font-size: 0.65rem;
            padding: 2px 6px;
            border-radius: 4px;
            font-weight: 600;
            text-transform: uppercase;
            white-space: nowrap;
        }
        .phase-connecting { background: rgba(139, 156, 179, 0.15); color: var(--text); }
        .phase-downloading { background: rgba(6, 182, 212, 0.15); color: var(--cyan); }
        .phase-uploading { background: rgba(245, 158, 11, 0.15); color: var(--warning); }
        .phase-done { background: rgba(16, 185, 129, 0.15); color: var(--success); }
        .phase-error { background: rgba(239, 68, 68, 0.15); color: var(--error); }
        
        /* Dual Progress */
        .progress-group { margin-bottom: 10px; }
        .progress-group:last-child { margin-bottom: 0; }
        .progress-label {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 4px;
            font-size: 0.75rem;
        }
        .progress-label .title {
            color: var(--text-muted);
            display: flex;
            align-items: center;
            gap: 6px;
        }
        .progress-label .title .icon { font-size: 0.9rem; }
        .progress-label .value { 
            color: var(--white); 
            font-weight: 600;
            font-family: 'SF Mono', 'Consolas', monospace;
        }
        .progress-bar { 
            height: 6px; 
            background: var(--surface); 
            border-radius: 3px; 
            overflow: hidden; 
        }
        .progress-fill { 
            height: 100%; 
            transition: width 0.3s ease;
            border-radius: 3px;
        }
        .progress-fill.download {
            background: linear-gradient(90deg, #0891b2, var(--cyan));
        }
        .progress-fill.upload {
            background: linear-gradient(90deg, #d97706, var(--warning));
        }
        .progress-fill.done {
            background: var(--success);
        }
        .progress-fill.inactive {
            background: var(--border);
        }
        
        /* Stats Row */
        .stats-row {
            display: flex;
            gap: 16px;
            padding: 10px 16px;
            background: rgba(0,0,0,0.2);
            border-top: 1px solid var(--border);
            font-size: 0.75rem;
        }
        .stat {
            display: flex;
            align-items: center;
            gap: 4px;
        }
        .stat-icon { opacity: 0.6; }
        .stat-value { color: var(--white); font-weight: 500; }
        
        .error-msg {
            font-size: 0.8rem;
            color: var(--error);
            margin-top: 8px;
            padding: 8px 10px;
            background: rgba(239, 68, 68, 0.1);
            border-radius: 4px;
        }
        
        .status-text {
            font-size: 0.75rem;
            color: var(--cyan);
            margin-top: 10px;
            padding: 8px 10px;
            background: rgba(6, 182, 212, 0.08);
            border-radius: 4px;
            text-align: center;
        }
        
        /* Completed Cards */
        .completed-card {
            background: var(--card);
            border-radius: 8px;
            border: 1px solid var(--border);
            padding: 12px 14px;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        .completed-info { flex: 1; }
        .completed-name {
            color: var(--white);
            font-weight: 500;
            font-size: 0.85rem;
            margin-bottom: 2px;
        }
        .completed-meta {
            font-size: 0.75rem;
            color: var(--text-muted);
        }
        .completed-badge {
            background: rgba(16, 185, 129, 0.15);
            color: var(--success);
            padding: 4px 10px;
            border-radius: 4px;
            font-size: 0.7rem;
            font-weight: 600;
        }
        
        .empty { 
            text-align: center; 
            padding: 50px 20px; 
            color: var(--text-muted);
            font-size: 0.85rem;
        }
        .hidden { display: none !important; }
        
        /* Queue Cards */
        .queue-card {
            background: var(--card);
            border-radius: 8px;
            border: 1px solid var(--border);
            border-left: 3px solid var(--text-muted);
            padding: 14px 16px;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        .queue-info { flex: 1; }
        .queue-name {
            color: var(--white);
            font-weight: 500;
            font-size: 0.85rem;
            margin-bottom: 4px;
        }
        .queue-meta {
            font-size: 0.75rem;
            color: var(--text-muted);
        }
        .queue-position {
            background: rgba(139, 156, 179, 0.15);
            color: var(--text);
            padding: 6px 12px;
            border-radius: 6px;
            font-size: 0.8rem;
            font-weight: 600;
        }
        
        /* Notifications */
        .notification {
            position: fixed;
            top: 20px;
            right: 20px;
            padding: 12px 20px;
            border-radius: 8px;
            font-size: 0.85rem;
            font-weight: 500;
            z-index: 1000;
            animation: slideIn 0.3s ease;
        }
        .notification.success {
            background: rgba(16, 185, 129, 0.9);
            color: white;
        }
        .notification.info {
            background: rgba(99, 102, 241, 0.9);
            color: white;
        }
        .notification.error {
            background: rgba(239, 68, 68, 0.9);
            color: white;
        }
        @keyframes slideIn {
            from { transform: translateX(100%); opacity: 0; }
            to { transform: translateX(0); opacity: 1; }
        }
    </style>
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

    <script>
        let selectedFile = null;
        let knownIds = new Set();
        
        function showNotification(message, type = 'info') {
            const existing = document.querySelector('.notification');
            if (existing) existing.remove();
            
            const notif = document.createElement('div');
            notif.className = 'notification ' + type;
            notif.textContent = message;
            document.body.appendChild(notif);
            
            setTimeout(() => notif.remove(), 4000);
        }
        
        async function cancelDownload(id) {
            if (!confirm('Tem certeza que deseja cancelar este download?')) {
                return;
            }
            
            try {
                const res = await fetch(\`/bridge/cancel/\${id}\`, {
                    method: 'POST',
                    credentials: 'include'
                });
                
                if (res.status === 401) return window.location.href = '/admin/login';
                
                const data = await res.json();
                
                if (res.ok) {
                    showNotification(data.message || 'Download cancelado', 'info');
                    loadStatus();
                } else {
                    showNotification(data.error || 'Erro ao cancelar', 'error');
                }
            } catch(e) {
                console.error(e);
                showNotification('Erro de conexão ao cancelar', 'error');
            }
        }
        
        function switchInputTab(tab) {
            document.querySelectorAll('.tabs .tab').forEach(t => t.classList.remove('active'));
            event.target.classList.add('active');
            
            if (tab === 'magnet') {
                document.getElementById('magnet-section').classList.remove('hidden');
                document.getElementById('torrent-section').classList.remove('active');
            } else {
                document.getElementById('magnet-section').classList.add('hidden');
                document.getElementById('torrent-section').classList.add('active');
            }
        }

        let allGames = []; // Armazena todos os jogos para filtro
        
        function switchSection(section) {
            document.querySelectorAll('.section-tab').forEach(t => t.classList.remove('active'));
            event.target.classList.add('active');
            document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
            document.getElementById(section + '-section').classList.add('active');
            
            // Carrega jogos quando a aba for clicada
            if (section === 'games') {
                loadGames();
            }
        }
        
        function handleFileSelect(input) {
            if (input.files && input.files[0]) {
                selectedFile = input.files[0];
                document.getElementById('selectedFile').textContent = '✓ ' + selectedFile.name;
                document.getElementById('uploadTorrentBtn').classList.add('show');
            }
        }
        
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
        
        async function uploadMagnet() {
            const magnet = document.getElementById('magnet').value.trim();
            if (!magnet) return alert('Cole um magnet link!');
            
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
                
                const data = await res.json();
                if(res.ok) {
                    document.getElementById('magnet').value = '';
                    if (data.queued) {
                        showNotification(\`📋 Adicionado à fila (posição \${data.position})\`, 'info');
                    } else {
                        showNotification('🚀 Download iniciado!', 'success');
                    }
                    loadStatus();
                } else {
                    alert(data.error || 'Erro ao iniciar.');
                }
            } catch(e) { 
                console.error(e);
                alert('Erro de conexão');
            }
            
            btn.innerText = '🚀 Iniciar';
            btn.disabled = false;
        }
        
        async function uploadTorrentFile() {
            if (!selectedFile) return alert('Selecione um arquivo .torrent!');
            
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
                
                const data = await res.json();
                if(res.ok) {
                    document.getElementById('torrentFile').value = '';
                    document.getElementById('selectedFile').textContent = '';
                    document.getElementById('uploadTorrentBtn').classList.remove('show');
                    selectedFile = null;
                    if (data.queued) {
                        showNotification(\`📋 Adicionado à fila (posição \${data.position})\`, 'info');
                    } else {
                        showNotification('🚀 Download iniciado!', 'success');
                    }
                    loadStatus();
                } else {
                    alert(data.error || 'Erro ao processar.');
                }
            } catch(e) { 
                console.error(e);
                alert('Erro de conexão');
            }
            
            btn.innerText = '🚀 Enviar';
            btn.disabled = false;
        }

        function getPhaseLabel(phase) {
            const labels = {
                'connecting': 'Conectando',
                'downloading': 'Baixando',
                'uploading': 'Enviando',
                'done': 'Concluído',
                'error': 'Erro'
            };
            return labels[phase] || phase;
        }

        function formatDuration(seconds) {
            if (seconds < 60) return seconds + 's';
            const mins = Math.floor(seconds / 60);
            if (mins < 60) return mins + 'min';
            const hours = Math.floor(mins / 60);
            return hours + 'h ' + (mins % 60) + 'm';
        }

        function formatTime(isoString) {
            const date = new Date(isoString);
            return date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
        }

        async function loadStatus() {
            try {
                const res = await fetch('/bridge/status', { credentials: 'include' });
                if (res.status === 401) return window.location.href = '/admin/login';
                
                const data = await res.json();
                const activeList = data.active || [];
                const queueList = data.queue || [];
                const completedList = data.completed || [];

                document.getElementById('active-count').textContent = activeList.length;
                document.getElementById('queue-count').textContent = queueList.length;
                document.getElementById('completed-count').textContent = completedList.length;

                // Render active downloads
                const container = document.getElementById('downloads-list');
                
                if (activeList.length === 0) {
                    container.innerHTML = '<div class="empty">Nenhum download em andamento</div>';
                    knownIds.clear();
                } else {
                    const currentIds = new Set(activeList.map(item => item.id));
                    
                    activeList.forEach(item => {
                        const existingCard = document.getElementById('card-' + item.id);
                        const cardHtml = buildActiveCard(item);
                        
                        if (existingCard) {
                            existingCard.className = 'card ' + item.phase;
                            existingCard.innerHTML = cardHtml;
                        } else {
                            const div = document.createElement('div');
                            div.id = 'card-' + item.id;
                            div.className = 'card ' + item.phase;
                            div.innerHTML = cardHtml;
                            
                            const empty = container.querySelector('.empty');
                            if (empty) empty.remove();
                            
                            container.appendChild(div);
                        }
                    });
                    
                    knownIds.forEach(id => {
                        if (!currentIds.has(id)) {
                            const card = document.getElementById('card-' + id);
                            if (card) card.remove();
                        }
                    });
                    
                    knownIds = currentIds;
                }

                // Render queue
                const queueContainer = document.getElementById('queue-list');
                if (queueList.length === 0) {
                    queueContainer.innerHTML = '<div class="empty">Fila vazia - próximo download inicia automaticamente</div>';
                } else {
                    queueContainer.innerHTML = queueList.map(item => \`
                        <div class="queue-card">
                            <div class="queue-info">
                                <div class="queue-name">\${item.name}</div>
                                <div class="queue-meta">
                                    \${item.source === 'magnet' ? '🔗 Magnet' : '📁 Torrent'} • 
                                    Adicionado às \${formatTime(item.addedAt)}
                                </div>
                            </div>
                            <span class="queue-position">#\${item.position}</span>
                        </div>
                    \`).join('');
                }

                // Render completed
                const completedContainer = document.getElementById('completed-list');
                if (completedList.length === 0) {
                    completedContainer.innerHTML = '<div class="empty">Nenhum download finalizado ainda</div>';
                } else {
                    completedContainer.innerHTML = completedList.map(item => \`
                        <div class="completed-card">
                            <div class="completed-info">
                                <div class="completed-name">\${item.name}</div>
                                <div class="completed-meta">
                                    \${item.files} arquivo(s) • \${item.size} • \${formatDuration(item.duration)}
                                </div>
                            </div>
                            <span class="completed-badge">✓ Disponível</span>
                        </div>
                    \`).join('');
                }
                
            } catch(e) { console.error(e); }
        }
        
        function buildActiveCard(item) {
            const dl = item.download;
            const up = item.upload;
            const isError = item.phase === 'error';
            const isDone = item.phase === 'done';
            const isConnecting = item.phase === 'connecting';
            const isDownloading = item.phase === 'downloading';
            const isUploading = item.phase === 'uploading';

            const downloadClass = dl.done ? 'done' : (isDownloading ? 'download' : 'inactive');
            const uploadClass = up.done ? 'done' : (isUploading ? 'upload' : 'inactive');
            
            // Calcula progresso do upload baseado no arquivo atual
            let uploadDisplayPercent = up.percent;
            if (isUploading && up.currentFileProgress > 0) {
                // Progresso = (arquivos completos + progresso do atual) / total
                const completedFiles = up.fileIndex - 1;
                const currentProgress = up.currentFileProgress / 100;
                uploadDisplayPercent = ((completedFiles + currentProgress) / up.totalFiles * 100).toFixed(1);
            }

            // Status dinâmico baseado na fase
            let statusText = '';
            if (isConnecting) {
                statusText = '🔍 Procurando peers...';
            } else if (isDownloading) {
                statusText = \`📥 \${dl.downloaded} / \${dl.total} • \${dl.peers} peers • ETA: \${dl.eta}\`;
            } else if (isUploading) {
                const fileInfo = up.totalFiles > 1 ? \`Arquivo \${up.fileIndex}/\${up.totalFiles}\` : '';
                statusText = \`📤 \${up.status || 'Enviando...'} \${fileInfo}\`;
            } else if (isDone) {
                statusText = '✅ Disponível na loja!';
            }

            return \`
                <div class="card-main">
                    <div class="card-header">
                        <div class="card-header-left">
                            <span class="game-name">\${item.name}</span>
                            <span class="phase-badge phase-\${item.phase}">\${getPhaseLabel(item.phase)}</span>
                        </div>
                        \${!isDone && !isError ? \`
                            <button class="cancel-btn" onclick="cancelDownload('\${item.id}')" title="Cancelar download">
                                ✕ Cancelar
                            </button>
                        \` : ''}
                    </div>
                    
                    <div class="progress-group">
                        <div class="progress-label">
                            <span class="title"><span class="icon">📥</span> Download</span>
                            <span class="value">\${dl.percent}% \${dl.done ? '✓' : ''}</span>
                        </div>
                        <div class="progress-bar">
                            <div class="progress-fill \${downloadClass}" style="width: \${dl.percent}%"></div>
                        </div>
                    </div>

                    <div class="progress-group">
                        <div class="progress-label">
                            <span class="title"><span class="icon">📤</span> Upload Dropbox</span>
                            <span class="value">\${uploadDisplayPercent}% \${up.done ? '✓' : ''}</span>
                        </div>
                        <div class="progress-bar">
                            <div class="progress-fill \${uploadClass}" style="width: \${uploadDisplayPercent}%"></div>
                        </div>
                    </div>
                    
                    <div class="status-text">\${statusText}</div>
                    
                    \${isError ? \`<div class="error-msg">❌ \${item.error}</div>\` : ''}
                </div>
                
                <div class="stats-row">
                    <div class="stat">
                        <span class="stat-icon">⚡</span>
                        <span class="stat-value">\${isDownloading ? dl.speed : (isUploading ? up.speed : '--')}</span>
                    </div>
                    <div class="stat">
                        <span class="stat-icon">📊</span>
                        <span class="stat-value">\${isUploading ? (up.uploaded + ' / ' + up.total) : (dl.downloaded + ' / ' + dl.total)}</span>
                    </div>
                    <div class="stat">
                        <span class="stat-icon">\${isUploading ? '📁' : '👥'}</span>
                        <span class="stat-value">\${isUploading ? (up.currentFile ? up.currentFile.substring(0, 20) + '...' : '--') : (dl.peers + ' peers')}</span>
                    </div>
                    <div class="stat">
                        <span class="stat-icon">⏱️</span>
                        <span class="stat-value">\${isDownloading ? dl.eta : (isDone ? 'Concluído' : '--:--')}</span>
                    </div>
                </div>
            \`;
        }

        setInterval(loadStatus, 2000);
        loadStatus();
        
        document.getElementById('magnet').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') uploadMagnet();
        });

        // ═══════════════════════════════════════════════
        // INDEX STATUS & REFRESH
        // ═══════════════════════════════════════════════
        
        async function loadIndexStatus() {
            try {
                const res = await fetch('/indexing-status');
                const data = await res.json();
                
                const badge = document.getElementById('index-status-badge');
                const countEl = document.getElementById('index-games-count');
                const lastUpdateEl = document.getElementById('index-last-update');
                const progressEl = document.getElementById('index-progress-text');
                const btn = document.getElementById('refresh-btn');
                
                countEl.textContent = data.totalGames || 0;
                
                if (data.lastUpdate) {
                    const date = new Date(data.lastUpdate);
                    lastUpdateEl.textContent = date.toLocaleTimeString('pt-BR', { 
                        hour: '2-digit', 
                        minute: '2-digit' 
                    }) + ' - ' + date.toLocaleDateString('pt-BR');
                } else {
                    lastUpdateEl.textContent = 'Nunca';
                }
                
                if (data.isIndexing) {
                    badge.className = 'status-badge indexing';
                    badge.textContent = 'Indexando...';
                    progressEl.textContent = ' • ' + data.progress;
                    btn.disabled = true;
                    btn.classList.add('loading');
                    btn.innerHTML = '<span class="icon">🔄</span> Indexando...';
                } else {
                    badge.className = 'status-badge online';
                    badge.textContent = 'Online';
                    progressEl.textContent = '';
                    btn.disabled = false;
                    btn.classList.remove('loading');
                    btn.innerHTML = '<span class="icon">🔄</span> Atualizar Índice';
                }
            } catch(e) {
                console.error('Erro ao carregar status do índice:', e);
            }
        }
        
        async function refreshIndex() {
            const btn = document.getElementById('refresh-btn');
            btn.disabled = true;
            btn.classList.add('loading');
            btn.innerHTML = '<span class="icon">🔄</span> Iniciando...';
            
            try {
                await fetch('/refresh');
                // Espera um pouco e recarrega o status
                setTimeout(loadIndexStatus, 500);
            } catch(e) {
                console.error('Erro ao iniciar refresh:', e);
                btn.disabled = false;
                btn.classList.remove('loading');
                btn.innerHTML = '<span class="icon">🔄</span> Atualizar Índice';
            }
        }
        
        // ═══════════════════════════════════════════════
        // CREDENTIALS LOADER
        // ═══════════════════════════════════════════════
        
        async function loadUser() {
            try {
                const res = await fetch('/bridge/me', { credentials: 'include' });
                if (res.status === 401) return window.location.href = '/admin/login';
                
                const user = await res.json();
                const box = document.getElementById('user-status-box');
                box.classList.remove('hidden');

                if (user.isAdmin) {
                    // É ADMIN
                    document.getElementById('admin-panel').classList.remove('hidden');
                    loadPendingUsers();
                    box.innerHTML = \`
                        <h3>👑 Admin Master</h3>
                        <p style="color: var(--text-muted); margin-top: 10px;">Você tem controle total do sistema.</p>
                    \`;
                } else if (user.isApproved) {
                    // É USUÁRIO APROVADO
                    box.style.borderColor = 'var(--success)';
                    box.innerHTML = \`
                        <h3>🔑 Suas Credenciais Tinfoil</h3>
                        <div class="cred-grid">
                            <div class="cred-item">
                                <label>Protocol</label>
                                <code>https</code>
                            </div>
                            <div class="cred-item">
                                <label>Host</label>
                                <code>\${user.host}</code>
                            </div>
                            <div class="cred-item">
                                <label>Username</label>
                                <code>\${user.tinfoilUser}</code>
                            </div>
                            <div class="cred-item">
                                <label>Password</label>
                                <code>\${user.tinfoilPass}</code>
                            </div>
                        </div>
                        <div class="cred-footer">
                            Configure isso na aba "File Browser" do seu Switch.
                        </div>
                    \`;
                } else {
                    // É USUÁRIO PENDENTE
                    box.style.borderColor = 'var(--warning)';
                    box.innerHTML = \`
                        <h3 style="color: var(--warning)">⏳ Aguardando Aprovação</h3>
                        <p style="color: var(--text-muted); margin-top: 10px;">
                            Seu cadastro foi recebido. Você receberá um e-mail com suas credenciais assim que o administrador aprovar.
                        </p>
                    \`;
                    // Esconde ferramentas de upload
                    const tabs = document.querySelector('.tabs');
                    const addBox = document.querySelector('.add-box');
                    if (tabs) tabs.style.display = 'none';
                    if (addBox) addBox.style.display = 'none';
                }
            } catch(e) {
                console.error('Erro ao carregar usuário:', e);
            }
        }

        async function loadPendingUsers() {
            try {
                const res = await fetch('/bridge/users/pending', { credentials: 'include' });
                if (res.status === 401) return;
                
                const users = await res.json();
                const list = document.getElementById('pending-list');
                
                if(users.length === 0) {
                    list.innerHTML = '<div class="empty">Nenhuma solicitação pendente.</div>';
                    return;
                }

                list.innerHTML = users.map(u => \`
                    <div class="card">
                        <div class="card-header">
                            <span class="game-name">\${u.email}</span>
                            <div>
                                <button class="approve-btn" onclick="approveUser('\${u._id}')">✅ Aprovar</button>
                                <button class="reject-btn" onclick="rejectUser('\${u._id}')">❌ Rejeitar</button>
                            </div>
                        </div>
                        <div class="status-text">
                            Cadastrado em \${new Date(u.createdAt).toLocaleString('pt-BR')}
                        </div>
                    </div>
                \`).join('');
            } catch(e) {
                console.error('Erro ao carregar pendentes:', e);
            }
        }

        async function approveUser(id) {
            if(!confirm('Aprovar este usuário e enviar email com credenciais?')) return;
            try {
                const res = await fetch('/bridge/users/approve/' + id, { 
                    method: 'POST',
                    credentials: 'include'
                });
                if (res.ok) {
                    showNotification('✅ Usuário aprovado! Email enviado.', 'success');
                    loadPendingUsers();
                } else {
                    showNotification('Erro ao aprovar', 'error');
                }
            } catch(e) {
                console.error(e);
                showNotification('Erro de conexão', 'error');
            }
        }
        
        async function rejectUser(id) {
            if(!confirm('Rejeitar e deletar este usuário?')) return;
            try {
                const res = await fetch('/bridge/users/reject/' + id, { 
                    method: 'POST',
                    credentials: 'include'
                });
                if (res.ok) {
                    showNotification('❌ Usuário rejeitado', 'info');
                    loadPendingUsers();
                } else {
                    showNotification('Erro ao rejeitar', 'error');
                }
            } catch(e) {
                console.error(e);
                showNotification('Erro de conexão', 'error');
            }
        }
        
        // Função para carregar jogos
        async function loadGames() {
            try {
                const res = await fetch('/bridge/games', { credentials: 'include' });
                if (res.status === 401) return window.location.href = '/admin/login';
                
                const data = await res.json();
                allGames = data.games || [];
                
                document.getElementById('games-count').textContent = allGames.length;
                renderGames(allGames);
            } catch(e) {
                console.error('Erro ao carregar jogos:', e);
                document.getElementById('games-list').innerHTML = 
                    '<div class="empty">Erro ao carregar jogos</div>';
            }
        }
        
        // Função para renderizar jogos (ATUALIZADA COM LÓGICA DE BASE ID)
        function renderGames(games) {
            const list = document.getElementById('games-list');
            
            if (games.length === 0) {
                list.innerHTML = '<div class="empty">Nenhum jogo encontrado</div>';
                return;
            }
            
            list.innerHTML = games.map(game => {
                const sizeGB = (game.size / 1024 / 1024 / 1024).toFixed(2);
                const sizeMB = (game.size / 1024 / 1024).toFixed(2);
                const sizeDisplay = game.size > 1024 * 1024 * 1024 ? \`\${sizeGB} GB\` : \`\${sizeMB} MB\`;
                
                let imgUrl = 'https://upload.wikimedia.org/wikipedia/commons/a/ac/No_image_available.svg';
                let badgeHtml = '';
                let tinfoilUrl = '#';

                if (game.id) {
                    // 🧠 A MÁGICA DOS IDS NINTENDO
                    // Pega os últimos 3 caracteres
                    const suffix = game.id.slice(-3).toUpperCase();
                    
                    // Calcula o BaseID (Zera os últimos 3 dígitos para achar a capa do jogo original)
                    const baseId = game.id.substring(0, 13) + '000';
                    
                    // Define a URL da imagem usando o BaseID
                    imgUrl = \`https://tinfoil.media/ti/\${baseId}/256/256/\`;
                    tinfoilUrl = \`https://tinfoil.io/Title/\${baseId}\`;

                    // Lógica do Badge (Selo)
                    if (suffix === '800') {
                        // UPDATE (Geralmente termina em 800)
                        badgeHtml = \`<span class="type-badge badge-upd">UPDATE</span>\`;
                    } else if (suffix !== '000') {
                        // DLC (Termina em qualquer coisa que não seja 000 ou 800)
                        badgeHtml = \`<span class="type-badge badge-dlc">DLC</span>\`;
                    }
                    // Se for '000', é o jogo base, não precisa de selo.
                }

                return \`
                    <div class="card" style="display: flex; gap: 15px; padding: 15px; align-items: center;">
                        
                        <div style="flex-shrink: 0; position: relative; width: 80px; height: 80px;">
                            <img src="\${imgUrl}" 
                                 alt="\${game.name}" 
                                 style="width: 100%; height: 100%; border-radius: 8px; object-fit: cover; background: #000;"
                                 onerror="this.src='https://upload.wikimedia.org/wikipedia/commons/a/ac/No_image_available.svg'">
                            
                            \${badgeHtml}
                        </div>

                        <div style="flex: 1; min-width: 0;">
                            <div class="card-header" style="margin-bottom: 5px;">
                                <span class="game-name" title="\${game.name}" style="font-size: 1rem;">\${game.name}</span>
                            </div>
                            
                            <div style="display: flex; gap: 10px; font-size: 0.8rem; color: var(--text-muted); align-items: center;">
                                <span class="status-badge online">\${sizeDisplay}</span>
                                \${game.id ? \`<span class="status-badge" style="font-family: monospace; opacity: 0.7;">\${game.id}</span>\` : ''}
                            </div>
                            
                            <div style="margin-top: 10px; display: flex; gap: 10px;">
                                <button onclick="window.open('\${game.url}', '_blank')" style="padding: 6px 12px; font-size: 0.75rem;">
                                    📥 Download
                                </button>
                                \${game.id ? \`
                                    <button onclick="window.open('\${tinfoilUrl}', '_blank')" style="padding: 6px 12px; font-size: 0.75rem; background: #222; border: 1px solid #444;">
                                        🔗 Info
                                    </button>
                                \` : ''}
                            </div>
                        </div>
                    </div>
                \`;
            }).join('');
        }
        
        // Função para filtrar jogos
        function filterGames() {
            const searchTerm = document.getElementById('game-search').value.toLowerCase().trim();
            
            if (!searchTerm) {
                renderGames(allGames);
                return;
            }
            
            const filtered = allGames.filter(game => 
                game.name.toLowerCase().includes(searchTerm)
            );
            
            renderGames(filtered);
        }
        
        // Carrega status inicial e atualiza a cada 2 segundos
        loadUser();
        loadIndexStatus();
        setInterval(loadIndexStatus, 2000);
    </script>
</body>
</html>
`;
}
