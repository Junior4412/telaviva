# Implantação do TelaViva

Guia para publicar o projeto no plano gratuito:

| Parte | Plano | Onde roda |
| --- | --- | --- |
| Frontend (`apps/web`) | Cloudflare Pages (free) | arquivos estáticos |
| Sinalização (`apps/server`) | Render (free) | processo Node persistente |

A mídia (WebRTC) **não passa por nenhum dos dois**: vai de navegador a
navegador. O Render só troca sinais (SDP/ICE) e mantém a lista de sala.

> Todos os valores de plano abaixo foram conferidos na documentação oficial em
> outubro de 2026. Preços e limites mudam — confira sempre em
> [render.com/docs/free](https://render.com/docs/free) e
> [Cloudflare Pages limits](https://developers.cloudflare.com/pages/platform/limits/).

---

## 1. Pré-requisitos

- Uma conta no [Render](https://render.com) e uma no [Cloudflare](https://dash.cloudflare.com)
- O repositório publicado no GitHub (Render e Pages conectam por Git)
- Node 20.10+ local, para rodar `npm run build` e `npm test` antes de subir

---

## 2. Backend no Render (free)

### Criar o serviço

1. Render Dashboard → **New → Web Service**
2. Conecte o repositório GitHub
3. Preencha:

| Campo | Valor |
| --- | --- |
| Name | `telaviva-sinalizacao` (ou o que preferir) |
| Root directory | *(deixe vazio = raiz do repositório)* |
| Build Command | `npm install --include=dev && npm run build --workspace @tela/shared && npm run build --workspace @tela/server` |
| Start Command | `node apps/server/dist/index.js` |
| Instance Type | **Free** (0.1 CPU, 512 MB) |

> **Por que `--include=dev`?** O Render define `NODE_ENV=production`, e sem
> essa flag o `npm install` pula os `devDependencies` — onde está o
> `typescript`. O build falharia com `tsc: not found`.
>
> **Por que compilar o `shared` antes?** O servidor importa `@tela/shared`,
> que resolve para `packages/shared/dist`. Esse pacote precisa existir antes do
> `tsc` do servidor.

### Variáveis de ambiente

Em **Settings → Environment variables**:

| Variável | Valor |
| --- | --- |
| `ALLOWED_ORIGINS` | `https://SEU-PROJETO.pages.dev` (a URL do frontend) |
| `NODE_ENV` | `production` (o Render já costuma definir; garanta) |
| `ICE_URLS` | só se for usar TURN/STUN próprio — ver seção 6 |
| `ICE_USERNAME` / `ICE_SECRET` | só com TURN — ver seção 6 |

`PORT` é definido pelo próprio Render; não sobrescreva.

### Health check

O servidor responde `200` em `/` e em `/health` (JSON). Se quiser ser
explícito, em **Settings → Health Check Path** use `/health`.

### Comportamento do plano gratuito (importante)

- **Dorme após 15 minutos** sem tráfego de entrada (HTTP ou mensagens de
  WebSocket).
- **Acorda em ~1 minuto** na próxima conexão. O primeiro visitante depois do
  tempo ocioso pode ver um erro de conexão e precisar tentar de novo — o
  cliente faz 30 tentativas automáticas (~2,5 min) antes de desistir.
- **750 horas/mês por workspace** (resetadas todo mês, sem acúmulo). Um único
  serviço sempre ligado consome ~744 h de um mês; se estourar, o Render
  suspende os serviços free até o próximo mês.
- **Sistema de arquivos efêmero**: nada é gravado em disco (ok para nós — o
  estado é todo em memória).

---

## 3. Frontend no Cloudflare Pages (free)

### Criar o projeto

1. Cloudflare Dashboard → **Workers & Pages → Create → Pages → Connect to Git**
2. Em **Build settings**:

| Campo | Valor |
| --- | --- |
| Framework preset | Vite |
| Root directory | *(deixe vazio = raiz do repositório)* |
| Build command | `npm install --include=dev && npm run build --workspace @tela/shared && npm run build --workspace @tela/web` |
| Output directory | `apps/web/dist` |

> **O root directory precisa ser a raiz.** `@tela/shared` é um workspace local
> (não existe no npm). Se apontar o Pages só para `apps/web`, a instalação não
> consegue resolver essa dependência.
>
> **O `shared` precisa ser compilado antes do web.** `Home.tsx` importa valores
> em tempo de execução (`formatRoomCode`, `ROOM_CODE_LENGTH`) e o tsconfig do
> web não referencia o shared — então `tsc -b` sozinho não o constrói.

### Variáveis de ambiente

**Settings → Environment variables**, em *Production* **e** *Preview*:

| Variável | Valor |
| --- | --- |
| `VITE_SERVER_URL` | `https://SEU-SERVIDOR.onrender.com` (sem barra no final) |

> `VITE_*` é embutido no JavaScript no momento do build. Trocar esse valor
> exige um **redeploy** do Pages — não há como mudar em runtime.

### Roteamento SPA

O arquivo `apps/web/public/_redirects` já está no repositório e faz o Pages
devolver o `index.html` para qualquer rota (como `/r/ABC234`). Sem ele, abrir
um link de convite direto pela URL resultaria em 404.

---

## 4. Ordem de implantação (evita CORS)

Os dois lados dependem um do outro (a URL de um é a variável do outro), então:

1. **Deploy do Render primeiro** → anote a URL (`https://xxx.onrender.com`).
2. **Deploy do Pages** com `VITE_SERVER_URL` já apontando para o Render →
   anote a URL (`https://xxx.pages.dev`).
3. **Volte ao Render** e defina `ALLOWED_ORIGINS` com a URL do Pages →
   Restart.
4. Faça a verificação da seção 5.

Sem `ALLOWED_ORIGINS` correto, o handshake do Socket.IO é bloqueado por CORS e
o frontend não conecta — é o erro nº 1 em primeiro deploy.

---

## 5. Verificação pós-deploy

```bash
# Saúde do sinalizador
curl https://SEU-SERVIDOR.onrender.com/health
# => {"status":"ok","uptime":...,"env":"production"}

# Lista ICE que o navegador vai consumir
curl https://SEU-SERVIDOR.onrender.com/ice
# => {"iceServers":[{"urls":["stun:stun.l.google.com:19302"]}]}
```

Teste manual com dois navegadores:

1. Abra `https://SEU-PROJETO.pages.dev` → **Criar sala**
2. Copie o link de convite
3. Abra o link em outra janela/aba anônima (ou outro dispositivo) → **Entrar**
4. Em um deles: **Compartilhar tela** → escolha uma janela/tela
5. Confirme que o vídeo aparece no outro lado e que o indicador fica "online"
6. Verifique o console do navegador: sem erro de CORS, sem erro de permissão
   (permissão negada mostra mensagem amigável)

Teste de cold start (opcional): espere 15 min sem acessar, recarregue e
confirme que conecta após ~1 minuto (o estado "reconectando" aparece antes).

---

## 6. STUN e TURN — quando a conexão direta falha

O padrão, sem nenhuma configuração, é apenas o STUN público do Google:

```text
stun:stun.l.google.com:19302   (sem SLA, é um serviço público)
```

Na prática:

| Cenário | Funciona com só STUN? |
| --- | --- |
| Ambos em rede doméstica (Wi-Fi) | costuma funcionar |
| Um dos lados em 4G/celular (CGNAT) | pode falhar |
| NAT simétrico / rede corporativa restritiva | costuma falhar |
| VPN restritiva | costuma falhar |

Quando a conexão direta falha, é preciso um **TURN**: um relay que leva o
tráfego quando o caminho direto não existe. A mídia continua protegida por
DTLS-SRTP (o operador do TURN vê metadados — quem fala com quem e quanto —
mas não o conteúdo).

### Configurar TURN próprio (recomendado)

1. Suba um `coturn` (em qualquer VPS) com `use-auth-secret` e defina um
   `static-auth-secret`.
2. No Render, defina:

| Variável | Valor |
| --- | --- |
| `ICE_URLS` | `turn:SEU-TURN:3478?transport=tcp,turns:SEU-TURN:5349` |
| `ICE_USERNAME` | mesmo identificador configurado no coturn |
| `ICE_SECRET` | o `static-auth-secret` do coturn |
| `ICE_TTL_SECONDS` | `3600` (padrão) |

O servidor troca esse segredo por credenciais temporárias (HMAC-SHA1) a cada
requisição de `/ice`. **O segredo nunca chega ao navegador** — só no Render.

Alternativamente, há serviços TURN gratuitos de terceiros. Avalie antes: você
está repassando a eles o tráfego de quem usa o seu app (não o conteúdo, mas os
metadados).

---

## 7. Limites e limitações conhecidas

**Plano gratuito:**

| Limite | Valor | Impacto no TelaViva |
| --- | --- | --- |
| Render — CPU/RAM | 0.1 CPU / 512 MB | sinalização é leve; o gargalo real é o upload dos usuários |
| Render — horas/mês | 750 por workspace | um serviço sempre ligado consome quase tudo; com sleep, sobra folga |
| Render — sleep | após 15 min ocioso | cold start ~1 min na primeira visita |
| Cloudflare Pages — builds | 500/mês, 1 por vez | ~16 builds/dia, folga enorme |
| Cloudflare Pages — arquivos | 20.000 por site | temos < 20 |
| Cloudflare Pages — banda | ilimitada | sem impacto |

**Do produto (independentemente de plano):**

- **Estado só em memória:** reiniciar/dormir o Render apaga todas as salas.
  Não há banco de dados e não é proposta do produto persistir nada.
- **Sem limite de participantes por sala** (decisão de produto). A topologia é
  malha: quem compartilha sobe `N-1` streams. Em salas grandes a qualidade
  cai conforme o upload de quem compartilha — o congestion control do WebRTC
  degrada antes de quebrar.
- **Sem áudio no MVP:** apenas vídeo da tela.
- **Sem TURN por padrão:** veja a seção 6.
- **O sinalizador vê metadados:** quem está em qual sala, IPs e SDP/ICE. Não
  fazemos alegação de criptografia ponta a ponta além do DTLS-SRTP da mídia.
- **Nada é gravado ou armazenado.**
