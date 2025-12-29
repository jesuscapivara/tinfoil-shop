/**
 * Login View
 * HTML limpo sem CSS/JS inline
 */
export function loginView() {
  return `
<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Capivara Shop | Login</title>
    <link rel="stylesheet" href="/public/css/login.css">
</head>
<body>
    <div class="login-card">
        <span class="logo">🎮</span>
        <h2 id="formTitle">Capivara Shop</h2>
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
            document.getElementById('formTitle').innerText = isLogin ? 'Capivara Shop' : 'Solicitar Acesso';
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
