# OpenRP AI — Contexto para Claude

Plataforma local de roleplay/chat com IA usando Ollama. Inspirado em TalkieAI, LinkyAI, SillyTavern. Tudo roda localmente, sem login, sem nuvem.

## Stack

- **Runtime**: Node.js 20+ (ESM — `"type": "module"` no package.json)
- **Backend**: Express 4 — rotas em `src/services/webServer/routes/`
- **Banco**: SQLite via `sql.js` (banco em memória, persistido manualmente em disco via `saveDB()`)
- **IA**: Ollama local em `http://127.0.0.1:11434` (padrão: modelo `qwen3:8b`)
- **Frontend**: HTML/CSS/JS puro em `public/` — sem framework, sem bundler
- **IDs**: UUIDs v4 via `uuid`
- **Config centralizada**: `src/config.js` lê o `.env` via `dotenv` e exporta `appConfig`

## Estrutura de arquivos

```
src/
  index.js                          ← entry point (init + shutdown)
  config.js                         ← configuração centralizada (lê .env + defaults)
  core/
    shutdown.js                     ← graceful shutdown + registro de processos
    promptBuilder.js                ← monta array de mensagens para o Ollama
    chat.js                         ← entry point do router de chat (monta sub-routers)
    chat/
      helpers.js                    ← resolveConfig, dynamicMaxTokens, startSSE, handleSSEError, streamOllama
      conversations.js              ← GET /characters/:id/conversation, POST/GET /conversations, GET messages
      messages.js                   ← POST enviar, POST regenerar, PATCH editar, DELETE rollback
  services/
    ollama.init.js                  ← inicia daemon Ollama (systemd ou fallback)
    database/
      db.js                         ← getDB() / saveDB()
      migrations.js                 ← CREATE TABLE IF NOT EXISTS + seed de config inicial
      queries.js                    ← todas as funções de acesso ao banco
      save.js                       ← salva o banco em disco
    webServer/
      webServer.init.js             ← cria Express app, registra middleware e routers, inicia o servidor
      routes/
        index.routes.js             ← GET /
        check.routes.js             ← GET /check, GET /api/status + exporta getHealthStatus()
        persona.routes.js           ← GET /persona, GET/POST /api/persona
        character.routes.js         ← factory characterRouter(uploadDir) com todas as rotas de personagem
        chat.routes.js              ← GET /chat/:characterId + monta chatRouter de core/chat.js
        settings.routes.js          ← GET /settings, GET /api/presets, GET/POST /api/config
        viewdb.routes.js            ← GET /api/viewdb, GET /api/viewdb/tables, GET /api/viewdb/records

public/
  index.html                        ← lista de personagens (cards clicáveis → /chat/:id)
  new-character.html                ← formulário de criação → redireciona para /chat/:id
  edit-character.html               ← formulário de edição de personagem existente
  chat.html                         ← página de chat imersivo (estilo TalkieAI)
  persona.html                      ← configuração da persona do usuário
  settings.html                     ← configurações de geração do modelo
  sidebar.html                      ← sidebar reutilizável (carregada via fetch)
  check.html                        ← checagem de saúde (Ollama + DB)
  viewdb.html                       ← visualização do banco de dados
  assets/
    css/
      styles.css                    ← estilos globais (glass cards, badges, botões, alerts, spin)
      sidebar.css                   ← sidebar e nav lateral
      chat.css                      ← layout e balões do chat imersivo
      index.css                     ← grid de personagens
      settings.css                  ← página de configurações
      viewdb.css                    ← visualização do banco
    js/
      sidebar.js                    ← loadSidebar(), populateRecentChars() — globals usados pelas páginas
      chat.js                       ← entry point do módulo ES do chat (type="module")
      chat/
        state.js                    ← characterId, state{conversationId,isStreaming}, dom refs, initDomRefs()
        ui.js                       ← helpers de UI puros: scrollToBottom, renderBubbleText, showError, etc.
        events.js                   ← addBubble, rollback, edição inline, send, regenerate, initInputListeners
        loader.js                   ← init() (carrega personagem/conversa/mensagens), initImmersiveMode()
      check.js / index.js / persona.js / new-character.js / edit-character.js / settings.js / viewdb.js
    uploads/                        ← avatares enviados por upload

data/
  roleplay.db                       ← banco SQLite persistido (binário)

config_recomendadas/
  README.MD                         ← referência completa dos parâmetros de geração do Ollama
  low_spec.json                     ← preset para máquina fraca (i5 7ª gen / GTX 1060)
  medium_spec.json                  ← preset para máquina média (Ryzen 5 / RX 9060 XT)
  high_spec.json                    ← preset para máquina forte (Ryzen 9 / RTX 5080)

contexto/
  prompt_builder                    ← diagrama da estrutura do prompt: system → memórias → lorebook → histórico
  estrutura_memoria                 ← tipos de memória (auto, manual, pinned, lorebook) e fluxo de contexto
```

## Banco de dados — tabelas principais

| Tabela | Descrição |
|--------|-----------|
| `characters` | id, name, description, personality, avatar_url, scenario, first_message |
| `conversations` | id, character_id, user_persona, title |
| `messages` | id, conversation_id, role (user/assistant/system), content, position |
| `persona` | id='self', name, description, avatar_url (única linha) |
| `memories` | id, conversation_id, type (auto/manual/pinned), content, keywords, is_pinned |
| `lorebooks` | id, scope (global/character), character_id, title, content, keywords |
| `generation_config` | id='global', model, temperature, top_p, top_k, min_p, repeat_penalty, repeat_last_n, tfs_z, max_tokens, min_tokens, context_size, stream, seed, stop, num_ctx_messages |
| `character_config` | override por personagem (mesmos campos + system_prompt, jailbreak) |
| `conversation_config` | override por conversa |
| `token_usage` | estimativas de tokens por mensagem |

**Importante:** `sql.js` não persiste automaticamente — sempre chamar `saveDB()` após escrita.

## Rotas da API

### Páginas HTML
```
GET /                        → index.html (redireciona p/ /check ou /persona se necessário)
GET /check                   → check.html
GET /persona                 → persona.html
GET /settings                → settings.html
GET /character/new           → new-character.html
GET /character/:id/edit      → edit-character.html
GET /chat/:characterId       → chat.html
GET /api/viewdb              → viewdb.html
```

### Personagens
```
GET    /api/characters             → lista todos
GET    /api/characters/recent      → últimos com conversa (usados na sidebar do chat)
GET    /api/characters/:id         → busca por ID
POST   /api/characters             → cria (avatar_upload em base64 ou avatar_link)
PUT    /api/characters/:id         → edita (todos os campos opcionais exceto name; avatar opcional)
```

### Conversas e chat
```
GET  /api/characters/:id/conversation       → busca ou cria conversa para o personagem
POST /api/conversations                     → cria conversa + insere first_message
GET  /api/conversations/:id                 → dados da conversa
GET  /api/conversations/:id/messages        → histórico ordenado por position
POST /api/conversations/:id/messages        → envia mensagem → streaming SSE
POST /api/conversations/:id/regenerate      → regenera última resposta → streaming SSE
PATCH /api/conversations/:id/messages/:msgId → edita conteúdo de uma mensagem
DELETE /api/conversations/:id/rollback      → remove mensagens após messageId (body: {messageId})
```

### Config / outros
```
GET  /api/status            → health check (Ollama + DB)
GET  /api/persona           → retorna persona atual
POST /api/persona           → salva persona
GET  /api/config            → config global de geração
POST /api/config            → salva config global
GET  /api/presets           → presets de hardware (low/medium/high)
GET  /api/viewdb/tables     → lista tabelas com contagem
GET  /api/viewdb/records    → últimas 25 linhas de uma tabela (?table=X)
```

## Padrão do chat (streaming)

`POST /api/conversations/:id/messages` funciona assim:
1. Valida e busca conversa + personagem + persona
2. Mescla config: `DEFAULT_CONFIG` → `global` → `character_config` (override só se tiver `model` definido)
3. Monta mensagens via `buildPromptMessages()` (ver `src/core/promptBuilder.js` e `contexto/prompt_builder`)
4. Busca últimas N mensagens (`getLastNMessages`) para contexto
5. Salva mensagem do usuário no banco (`addMessage`)
6. Calcula `dynamicMaxTokens` — proporcional ao tamanho da mensagem do usuário
7. Chama `http://127.0.0.1:11434/api/chat` com `stream: true` via `streamOllama()`
8. Responde com **SSE** (`Content-Type: text/event-stream`)
9. Cada chunk: `data: {"delta":"texto","done":false}`
10. Final: `data: {"delta":"","done":true,"message_id":"...","user_message_id":"..."}`
11. Filtra `<think>...</think>` (reasoning tokens do qwen3) durante o stream
12. Salva resposta completa no banco ao final

## Eventos do chat (frontend)

Todos implementados em `public/assets/js/chat/events.js`.

### Enviar mensagem
`sendMessage()` → POST `/api/conversations/:id/messages` → lê SSE token a token → renderiza via `renderBubbleText()`.

### Regenerar última resposta
Botão `regenerate-btn` aparece apenas no último balão do personagem (`updateLastCharRow()`).
Chama `regenerateLastMessage(rowEl)` → POST `/api/conversations/:id/regenerate` → substitui conteúdo do balão via streaming.

### Editar mensagem (inline)
Botão `edit-btn` aparece em hover em qualquer balão (usuário ou personagem).
- Se for a **última mensagem**: entra em modo edição diretamente (`enterEditMode()`).
- Se **não for a última**: abre modal de confirmação antes (avisa que editar mensagem antiga pode causar incoerência).
- Edição salva via PATCH `/api/conversations/:id/messages/:msgId`.

### Rollback de conversa
Botão `rollback-btn` aparece em hover nos balões do personagem.
Abre modal de confirmação → DELETE `/api/conversations/:id/rollback` com `{messageId}` no body.
Remove do DOM todas as mensagens após o ponto de rollback. O banco deleta tudo com `position > position_da_mensagem`.

## Padrão do frontend

- Páginas são **HTML estático** servidas pelo Express
- Sidebar é carregada via `fetch('/sidebar.html')` e injetada no `#sidebar-root` (exceto em `chat.html`, que tem nav própria inline)
- `sidebar.js` define dois globals: `loadSidebar()` e `populateRecentChars()` — usados nas outras páginas via script regular antes do módulo
- `chat.js` é carregado com `type="module"` e importa de `chat/` via ES Modules
- Os demais JS são scripts regulares (sem módulos)
- Formulários fazem `fetch` para a API e manipulam a resposta via JS
- **Sem framework**: DOM puro, `fetch`, eventos nativos
- Paleta: `#020617` (fundo), `#38bdf8` (azul principal), `#94a3b8` (texto secundário)
- Estilo: dark mode, glassmorphism (backdrop-filter), bordas `rgba(148,163,184,0.12)`

## Página chat.html — design

- Imagem do personagem como **background full-screen** (`background-size: cover`, `center top`)
- Overlay com gradiente escurecendo de cima para baixo
- No desktop (>900px): chat centralizado em 680px, overlay lateral deixa imagem visível à esquerda
- Balão personagem: esquerda, glassmorphism escuro, `border-radius: 0 1.25rem 1.25rem 1.25rem`
- Balão usuário: direita, azul `rgba(56,189,248,0.88)`, `border-radius: 1.25rem 1.25rem 0 1.25rem`
- Indicador de digitação: 3 pontos animados enquanto aguarda Ollama
- Streaming token-a-token: `reader.getReader()` + SSE parsing
- Header contém: botão de menu (offcanvas nav), avatar, nome/cenário, botão editar personagem, botão voltar

## Fluxo de criação de personagem

1. `POST /api/characters` com avatar (base64 ou link) → salvo em `public/assets/uploads/`
2. Resposta: `{ ok: true, id: "uuid" }`
3. Redirect para `/chat/:id`
4. Chat page faz `GET /api/characters/:id/conversation` → cria conversa + insere `first_message` como mensagem `assistant` position=0
5. Carrega mensagens e exibe

## Fluxo de edição de personagem

1. Botão de lápis no card da index ou no header do chat → `/character/:id/edit`
2. `edit-character.js` carrega dados via `GET /api/characters/:id` e pré-preenche o form
3. Submit envia `PUT /api/characters/:id` — avatar é opcional (mantém existente se nenhum for enviado)
4. Redireciona para `/chat/:id`

## Parâmetros de geração de IA

Referência completa em `config_recomendadas/README.MD`. Parâmetros principais:

| Parâmetro | Função | Impacto no hardware |
|-----------|--------|---------------------|
| `temperature` | Criatividade / aleatoriedade do token escolhido | Nenhum |
| `top_p` | Nucleus sampling — mantém tokens que somam X% de probabilidade | Nenhum |
| `top_k` | Mantém apenas os K tokens mais prováveis | Nenhum |
| `min_p` | Filtro dinâmico — descarta tokens abaixo de X% do token mais provável | Nenhum |
| `tfs_z` | Tail Free Sampling — remove cauda de baixa probabilidade | Nenhum |
| `repeat_penalty` | Penaliza tokens já usados no contexto recente | Leve |
| `repeat_last_n` | Janela de tokens observados pelo repeat_penalty | Leve |
| `max_tokens` | Comprimento máximo de cada resposta | Alto (linear) |
| `min_tokens` | Mínimo de tokens na resposta (evita respostas curtíssimas) | Alto (linear) |
| `context_size` | Janela de contexto total (KV Cache) — maior = mais memória do personagem | **Alto (quadrático)** |
| `num_ctx_messages` | Quantas mensagens do histórico enviar ao Ollama | Indireto |
| `seed` | Semente do RNG (`-1` = aleatório) | Nenhum |
| `stop` | Tokens de parada que encerram a geração | Nenhum |
| `stream` | Envia tokens um a um em tempo real | Nenhum |

A config tem hierarquia: `appConfig.defaults` (.env) → `generation_config` (global) → `character_config` (override por personagem, só se tiver `model` definido).

## Estrutura de memória e prompt (ver `contexto/`)

`contexto/prompt_builder` — diagrama da ordem de montagem do prompt:
1. System prompt do personagem (description + personality + scenario + persona do usuário)
2. Memórias relevantes (pinned primeiro, depois por score/keyword)
3. Lorebook entries (ativadas por keyword no chat)
4. Example dialogues (few-shot, se couber no budget)
5. Histórico das últimas N mensagens
6. Author's Note (injetado perto do fim)

`contexto/estrutura_memoria` — tipos de memória:
- **Auto**: gerada automaticamente pelo summaryService ao ultrapassar o limite de contexto
- **Manual**: criada/editada pelo usuário; aparece só quando keywords batem com o contexto
- **Pinned**: sempre injetada no prompt (ver regras abaixo)
- **Lorebook**: ativada por palavras-chave mencionadas no chat

### Memórias Pinned — critério e garantias

Pinned bypassa o filtro de keyword e é sempre injetada. Use **apenas** para fatos que mudam quem o personagem é estruturalmente, não o que ele sentiu ou sabe situacionalmente.

**Exemplos válidos (✓):**
- Estado físico permanente: "Perdeu a visão do olho esquerdo na batalha de Ardenmoor."
- Mudança de relação estrutural: "Passou a considerar o usuário um aliado de confiança."
- Segredo revelado sem volta: "Sabe que o usuário é o herdeiro legítimo do trono."
- Regra narrativa fixa: "Nunca pronuncia o nome do irmão morto — chama-o apenas de 'ele'."

**Exemplos inválidos (✗ — use auto/manual com keywords):**
- Reação situacional: "Ficou com raiva quando mencionaram cavalos."
- Preferências: "Gosta de chá." → vai em description/personality do personagem.
- Detalhe de cena: "Estavam no café quando o segredo foi revelado."

**Validações obrigatórias em `createPinnedMemory()`:**
- `content` com mínimo de 20 caracteres (fatos curtos demais são vagos)
- `keywords` obrigatório — mesmo sem usar no filtro, serve de referência semântica e auditoria
- `relevanceWeight` configurável (padrão 1.5) para priorizar entre as próprias pinned

**Cap automático no retrieval:**
`getRelevantMemories()` limita a 10 pinned por padrão (`maxPinned`), ordenando por `relevance_weight DESC`. Se houver mais de 10 pinned, as de menor peso são descartadas do prompt. Isso previne que o prompt estoure após conversas longas com muitas pinned acumuladas.

## Config centralizada (`src/config.js`)

Todas as variáveis de ambiente são lidas aqui via `dotenv`. Demais arquivos importam `appConfig`:
- `appConfig.port` / `appConfig.nodeEnv`
- `appConfig.ollama.host` / `.chatEndpoint` / `.tagsEndpoint`
- `appConfig.dbPath`
- `appConfig.defaults` — valores padrão de todos os parâmetros de geração

## Comandos

```bash
npm start        # produção
npm run dev      # watch mode (node --watch)
```

## Observações importantes

- **Persona é obrigatória** para acessar `/` — redireciona para `/persona` se não existir
- **Ollama é obrigatório** — redireciona para `/check` se não responder
- `first_message` suporta `{{user}}` que é substituído pelo nome da persona ao criar conversa
- Config de geração tem hierarquia: `.env defaults` → `global` → `character_config`
- O modelo padrão é `qwen3:8b` — pode ser alterado em `/settings`
- Avatar upload: enviado como base64 no body JSON, salvo em `public/assets/uploads/` com nome `timestamp-filename`
- Todos os IDs são UUIDs v4
- `getLastNMessages` retorna ordenado por `created_at DESC LIMIT n` e depois reverte (mais antigo primeiro)
- `character.routes.js` usa factory `characterRouter(uploadDir)` porque precisa do caminho de upload injetado pelo `webServer.init.js`
- `chat.js` frontend usa `type="module"` e ES Modules; os demais JS são scripts regulares
