# TelaViva

Compartilhamento de tela em tempo real pelo navegador. Sem instalar nada, sem cadastro, sem gravação.

- **Frontend:** React + Vite + TypeScript + Tailwind CSS
- **Transporte de mídia:** WebRTC (DTLS-SRTP navegador a navegador)
- **Sinalização:** Node.js + Socket.IO (apenas controle de sala e troca de SDP/ICE)
- **Licença:** código aberto, dependências gratuitas

## Estrutura

```
apps/
  web/       Frontend (React + Vite)
  server/    Backend de sinalização (Node + Socket.IO)
packages/
  shared/    Tipos, constantes e validação compartilhados entre web e server
```

É um monorepo com npm workspaces: `npm install` na raiz instala tudo de uma vez.

## Requisitos

- Node.js **20.10 ou superior** (verifique com `node -v`)
- npm 10+ (vem com o Node)

## Executando localmente

```bash
# 1. Instalar dependências (na raiz do repositório)
npm install

# 2. Subir shared + servidor + frontend ao mesmo tempo
npm run dev
```

Isso usa `concurrently` para rodar os três processos:

| Processo | Porta | URL |
| --- | --- | --- |
| Frontend (Vite) | 5173 | http://localhost:5173 |
| Sinalização (Socket.IO) | 3001 | http://localhost:3001 |

Com esses padrões **nenhuma variável de ambiente é necessária** em desenvolvimento:
o servidor aceita `http://localhost:5173` por padrão e o frontend aponta para
`http://localhost:3001`.

Para rodar cada parte separadamente:

```bash
npm run dev:web      # só o frontend
npm run dev:server   # só o servidor (requer shared compilado)
npm run dev:shared   # recompila shared em modo watch
```

### Comandos de verificação

```bash
npm run typecheck    # tsc --noEmit nos 3 workspaces
npm test             # vitest: 99 testes (shared + servidor)
npm run build        # build de produção dos 3 workspaces
```

Os testes do servidor sobem um servidor HTTP + Socket.IO real em porta efêmera
por arquivo — não é preciso ter nada rodando para executar `npm test`.

Existe ainda `apps/server/test/smoke.mjs`, um teste de fumaça opcional que
valida o **servidor compilado** (`dist/index.js`), cobrindo o boot real de
produção. Para rodá-lo:

```bash
npm run build
PORT=3099 node apps/server/dist/index.js   # em outro terminal
node apps/server/test/smoke.mjs
```

## Variáveis de ambiente

O servidor lê `process.env` diretamente (não usa dotenv). Veja
[`.env.example`](./.env.example) para a lista completa e comentada.

Resumo:

| Variável | Onde | Obrigatória | Padrão |
| --- | --- | --- | --- |
| `PORT` | servidor | não | `3001` (o Render define a dele) |
| `ALLOWED_ORIGINS` | servidor | em produção | `http://localhost:5173` |
| `ICE_URLS` | servidor | não | STUN público do Google |
| `ICE_USERNAME` / `ICE_SECRET` | servidor | se usar TURN | vazio |
| `ICE_TTL_SECONDS` | servidor | não | `3600` |
| `DEBUG` | servidor | não | `false` |
| `VITE_SERVER_URL` | frontend (build) | em produção | `http://localhost:3001` |

> `VITE_*` é embutido no JavaScript público. Nunca coloque segredos em
> variáveis `VITE_*`.

## Segurança e privacidade

- Nenhuma transmissão é gravada ou armazenada.
- As salas existem apenas em memória: ao esvaziar, o link continua válido por
  **10 minutos** (`EMPTY_ROOM_TTL_MS`) e depois a sala é removida. Reiniciar o
  servidor apaga todas as salas.
- Senhas de sala são guardadas como hash (scrypt) e comparadas de forma
  timing-safe; nunca em texto puro.
- Credenciais de TURN são geradas no servidor com validade curta (HMAC) e
  nunca entram estaticamente no bundle do frontend.
- CORS restrito às origens configuradas — nunca `*` em produção.
- Rate limit por IP: 10 criações e 30 entradas por minuto.

### O que a criptografia cobre (e o que não cobre)

- **Cobre:** a mídia viaja com DTLS-SRTP, criptografada de navegador a
  navegador. Não afirmamos criptografia ponta a ponta "comprovada" além disso.
- **Não cobre:** o servidor de sinalização vê metadados de quem está em qual
  sala, endereços IP e os SDP/ICE trocados. Quem participa da sala vê o que
  você transmite — é o propósito do produto.

## Limitações conhecidas

- **Topologia em malha (mesh):** cada participante mantém uma conexão WebRTC
  por par. Quem compartilha sobe `N-1` streams simultâneos — em salas grandes o
  gargalo é o seu upload e a qualidade cai (o congestion control do WebRTC
  degrada antes de quebrar).
- **Sem limite de participantes por sala** (decisão de produto). Não há teto
  imposto pelo servidor; a usabilidade prática em malha costuma cair bem antes
  disso. Proteções contra abuso continuam valendo pelo rate limit por IP.
- **Áudio opcional, e depende da origem:** desligado por padrão — marque
  "Compartilhar áudio" antes de iniciar. O áudio é capturado só quando o
  navegador oferece (típico: áudio de aba no Chrome/Firefox) e a origem escolhida
  tem som; janela de programa/monitor pode não ter áudio algum. Quem assiste
  ativa o som pelo botão sobre o vídeo.
- **Sem servidor TURN por padrão:** em redes restritas (NAT simétro,
  corporativo, alguns hotspots) a conexão direta pode falhar. Veja o guia de
  implantação para configurar TURN.
- **Plano gratuito com pausa:** o Render desliga o serviço após 15 min sem
  tráfego (~1 minuto para acordar). Detalhes no guia de implantação.

## Implantação

Guia completo (Render + Vercel no plano gratuito): [DEPLOY.md](./DEPLOY.md)
