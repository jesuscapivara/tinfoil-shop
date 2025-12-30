# 🎮 Mana Tinfoil Shop (Capivara Bridge)

> **Middleware de Automação, Ingestão de Torrents e Distribuição de Conteúdo para Nintendo Switch.**

![Version](https://img.shields.io/badge/version-1.0.3-blue.svg) ![Node](https://img.shields.io/badge/node-%3E%3D18-green.svg) ![License](https://img.shields.io/badge/license-MIT-orange.svg)

## 🏛️ Visão Geral da Arquitetura

O **Mana Tinfoil Shop** (ou _Capivara Bridge_) é uma solução _Fullstack_ projetada para atuar como uma ponte inteligente entre a rede **BitTorrent** e o ecossistema **Tinfoil**.

Diferente de soluções tradicionais que exigem servidores com grandes discos (VPS/Dedicaods), esta arquitetura foi desenhada para rodar em ambientes efêmeros e com pouca RAM (PaaS/Containers), delegando o armazenamento pesado para a nuvem (Dropbox) através de um pipeline de _streaming_ otimizado.

### 🔄 Pipeline de Dados (ETL)

1. **Ingestão:** O sistema aceita Magnet Links ou arquivos `.torrent` via Dashboard Protegido.
2. **Processamento (Stream):** O motor WebTorrent baixa os arquivos sequencialmente.
3. **Smart Upload (Backpressure):** Um algoritmo proprietário envia _chunks_ de 20MB para o Dropbox, pausando o download quando o buffer enche, permitindo transferir arquivos de 50GB+ em containers com apenas 512MB de RAM.
4. **Enriquecimento (Auto-Discovery):** O `TitleDB Service` identifica metadados (Base/Update/DLC) via Hex Parsing do ID do arquivo.
5. **Distribuição:** Uma API RESTful serve um JSON compatível com Tinfoil, protegido por autenticação customizada.

---

## 🛠 Tech Stack & Decisões de Engenharia

A stack foi escolhida priorizando performance (I/O non-blocking) e simplicidade de manutenção.

| Camada       | Tecnologia             | Justificativa Técnica                                                   |
| :----------- | :--------------------- | :---------------------------------------------------------------------- |
| **Runtime**  | **Node.js (ES6+)**     | Gerenciamento eficiente de _streams_ e arquitetura orientada a eventos. |
| **Core**     | **Express.js**         | Roteamento leve para API e Dashboard.                                   |
| **Torrent**  | **WebTorrent**         | Cliente BitTorrent implementado em JavaScript puro.                     |
| **Storage**  | **Dropbox API v2**     | Armazenamento persistente com links diretos (DL).                       |
| **Database** | **MongoDB (Mongoose)** | Persistência de metadados, usuários e cache de arquivos indexados.      |
| **Auth**     | **JWT + Bcrypt**       | Segurança _stateless_ para o painel administrativo.                     |
| **Frontend** | **Vanilla JS + CSS3**  | Interface reativa sem o _overhead_ de frameworks (React/Vue).           |

---

## ⚡ Funcionalidades Críticas

### 1. Smart Stream Upload (`manaBridge.js`)

Resolve o problema de "Out of Memory" em ambientes PaaS. Em vez de baixar o arquivo inteiro para o disco (que é efêmero ou pequeno), o sistema cria um _pipe_ direto entre o Torrent e o Dropbox.

- **Chunking:** Divide o arquivo em blocos de 20MB.
- **Retry Pattern:** Tenta reenviar _chunks_ falhos até 5 vezes com _Exponential Backoff_.
- **Controle de Fluxo:** Pausa o download do torrent se o upload para o Dropbox engasgar.

### 2. Hot Cache de Autenticação (`authMiddleware.js`)

Para evitar _flooding_ no banco de dados a cada requisição do Tinfoil (que faz centenas de _requests_ ao abrir), implementamos um cache em memória RAM (`Map`).

- **TTL:** 5 minutos.
- **Proteção:** Normalização de strings e validação de _hash_ apenas no primeiro acesso.

### 3. TitleDB Aggregator (`titleDbService.js`)

O sistema carrega bases de dados de títulos (US/JP/Mirrors) na memória na inicialização. Isso permite identificar o nome real de um jogo (ex: "Super Mario Odyssey") apenas pelo seu ID Hexadecimal no nome do arquivo, classificando automaticamente entre **Base Game**, **Update** ou **DLC**.

---

## 🚀 Instalação e Configuração

### Pré-requisitos

- Node.js v18+
- MongoDB (Atlas ou Local)
- Conta Dropbox (App Console)

### 1. Clonar e Instalar

```bash
git clone https://github.com/seu-usuario/mana-tinfoil-shop.git
cd mana-tinfoil-shop
npm install
```

### 2. Configuração de Ambiente (.env)

Crie um arquivo `.env` na raiz do projeto com as seguintes variáveis:

```env
# --- SERVIDOR ---
PORT=8080
DOMINIO=seu-app.com
NODE_ENV=production

# --- FRONTEND URL (para CORS) ---
FRONTEND_URL=http://localhost:3000

# --- BANCO DE DADOS ---
MONGO_URI=mongodb+srv://user:pass@cluster.mongodb.net/manashop

# --- DROPBOX (OAUTH2) ---
# Crie um app em: https://www.dropbox.com/developers/apps
# Scopes necessários: files.content.write, sharing.write, files.content.read
DROPBOX_APP_KEY=sua_app_key
DROPBOX_APP_SECRET=seu_app_secret
DROPBOX_REFRESH_TOKEN=seu_refresh_token_eterno

# --- SEGURANÇA & ADMIN ---
ADMIN_EMAIL=admin@seu-email.com
ADMIN_PASS=sua_senha_mestra
JWT_SECRET=hash_super_secreto_aleatorio

# --- EMAIL (NOTIFICAÇÕES) ---
# Recomendado: KingHost, AWS SES, ou Gmail App Password
EMAIL_USER=no-reply@seu-dominio.com
EMAIL_PASS=senha_smtp
SMTP_HOST=smtp.seu-provedor.com
SMTP_PORT=587
```

### 3. Executar

```bash
# Modo de Desenvolvimento
npm run dev

# Modo de Produção
npm start
```

---

## 🖥️ Estrutura do Projeto

```
mana-tinfoil-shop/
├── authMiddleware.js    # Lógica de proteção da API Tinfoil (Basic Auth + Cache)
├── database.js          # Modelos MongoDB (User, GameCache, History)
├── emailService.js      # Disparo de emails transacionais (Nodemailer)
├── index.js             # Entry Point e Servidor Express
├── manaBridge.js        # CÉREBRO: Lógica de Torrent e Upload (WebTorrent + Dropbox)
├── titleDbService.js    # Inteligência de Metadados e Agregação
├── frontend/            # Dashboard SPA (Single Page Application)
│   ├── public/          # Assets (CSS, JS Client)
│   └── views/           # Templates Literais HTML (Renderização SSR leve)
└── discloud.config      # Configuração de Deploy PaaS
```

---

## 🔗 Integração com Frontend

O backend foi configurado para aceitar requisições do frontend separado através de CORS e autenticação JWT.

### Endpoints Públicos

- `GET /health` - Status de saúde do servidor
- `GET /indexing-status` - Status da indexação de jogos

### Endpoints Protegidos (Tinfoil Auth)

- `GET /api` - Lista de jogos (requer Basic Auth Tinfoil)
- `GET /api/refresh` - Força nova indexação (requer Basic Auth Tinfoil)

### Endpoints Protegidos (JWT)

- `GET /bridge/games` - Lista de jogos via bridge (requer JWT)
- `GET /bridge/me` - Dados do usuário logado (requer JWT)
- `POST /bridge/auth` - Autenticação/login
- Outros endpoints `/bridge/*` - Requerem JWT

### Autenticação

O backend aceita autenticação de duas formas:

1. **Basic Auth (Tinfoil)**: Para endpoints `/api/*`, usa credenciais Tinfoil (username/password)
2. **JWT Bearer Token**: Para endpoints `/bridge/*`, aceita tokens JWT via:
   - Header `Authorization: Bearer <token>` (recomendado para API/frontend)
   - Cookie `auth_token` (para dashboard web)

### CORS

O CORS está configurado para permitir requisições do frontend. Configure a variável `FRONTEND_URL` no `.env` para o domínio do seu frontend.

---

## 🛡️ Aviso Legal

Este software é uma Prova de Conceito (PoC) de engenharia de software, demonstrando manipulação de streams de dados e integração de APIs.

O desenvolvedor não hospeda, distribui ou fornece links para conteúdos protegidos por direitos autorais.

O uso desta ferramenta é de inteira responsabilidade do usuário final.

Este projeto não tem afiliação com a Nintendo, Tinfoil ou Dropbox.

---

<div align="center">
  <sub>Desenvolvido com ☕ e Engenharia por Lucas Rossetti.</sub>
</div>
