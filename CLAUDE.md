# OpenRP AI — Contexto para Claude

Plataforma local de roleplay/chat com IA usando Ollama. Inspirado em TalkieAI, LinkyAI, SillyTavern. Tudo roda localmente, sem login, sem nuvem.

## Stack

- **Runtime**: Node.js 20+ (ESM — `"type": "module"` no package.json)
- **Backend**: Express 4 — rotas em `src/services/webServer/routes/`
- **Banco**: SQLite via `sql.js` (banco em memória, persistido manualmente em disco via `saveDB()`)
- **IA**: Ollama local em `http://127.0.0.1:11434` (padrão: modelo `gemma4:12b`, contexto automático)
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
    affection.js                    ← sistema de afeto: escala de níveis, ganho de pontos, bloco [Relationship] do prompt
    chat.js                         ← entry point do router de chat (monta sub-routers)
    chat/
      helpers.js                    ← resolveConfig, dynamicMaxTokens, startSSE, handleSSEError, streamOllama (persiste progressivamente no banco, com afterDone pós-`done`)
      generationManager.js          ← registro em memória de gerações em andamento por conversa (beginGeneration/isGenerating/attachSubscriber/broadcast/closeGeneration) — desacopla a geração da conexão HTTP que a disparou
      conversations.js              ← GET /characters/:id/conversation, POST/GET /conversations, GET messages, GET /conversations/:id/generation (resume), POST memories/generate
      messages.js                   ← POST enviar, POST regenerar, PATCH editar, DELETE rollback
    memory/
      index.js                      ← barrel do módulo de memória
      create.js                     ← createAutoMemory, createManualMemory, createPinnedMemory (validações)
      extraction.js                 ← extractAndSaveMemories(): UMA chamada Ollama → memórias auto + pinned classificadas
      trigger.js                    ← processMemoryBacklogIfDue(): gatilho por cursor (last_memory_position)
      retrieval.js                  ← getRelevantMemories/getMemoriesForPrompt: score por keyword (word-boundary, sem acentos)
  services/
    ollama.init.js                  ← inicia daemon Ollama (systemd ou fallback)
    ollama.models.js                ← garante existência do modelo customizado gemma4:e4b-64k (preset "Máquina Forte") via Modelfile API
    database/
      db.js                         ← getDB() / saveDB() (debounced) / flushDB()
      migrations.js                 ← CREATE TABLE IF NOT EXISTS + seed de config inicial
      queries.js                    ← barrel: re-exporta todas as queries da pasta queries/
      save.js                       ← flush do banco em disco (usado pelo shutdown)
      queries/
        characters.js               ← createCharacter, getCharacter, getAllCharacters, updateCharacter
        characterImages.js          ← getCharacterImages, addCharacterImages, deleteCharacterImage (galeria de imagens)
        persona.js                  ← getPersona, savePersona
        conversations.js            ← createConversation, getConversation, getLatestConversationForCharacter, getRecentCharactersWithConversations
        messages.js                 ← addMessage, updateMessage, getLastMessage, deleteMessage, rollbackConversation, resetConversation, getConversationMessages, getLastNMessages, getMemoryBacklog
        memories.js                 ← createMemory, getMemories, getPinnedMemories, getMemoriesByType
        lorebooks.js                ← createLorebook, getLorebook, getGlobal/CharacterLorebooks, getAllLorebooks, updateLorebook, deleteLorebook, getCharacterLorebookIds, setCharacterLorebooks
        config.js                   ← getGenerationConfig, setGenerationConfig, get/setConversationModel
    webServer/
      webServer.init.js             ← cria Express app, registra middleware e routers, inicia o servidor
      routes/
        index.routes.js             ← GET /
        check.routes.js             ← GET /check, GET /api/status + exporta getHealthStatus()
        persona.routes.js           ← GET /persona, GET/POST /api/persona
        character.routes.js         ← factory characterRouter(uploadDir) com todas as rotas de personagem
        chat.routes.js              ← GET /chat/:characterId + monta chatRouter de core/chat.js
        settings.routes.js          ← GET /settings, GET /api/presets, GET/POST /api/config, GET /api/models, POST /api/models/pull
        viewdb.routes.js            ← GET /api/viewdb, GET /api/viewdb/tables, GET /api/viewdb/records
        lorebook.routes.js          ← CRUD /api/lorebooks + GET/PUT /api/characters/:id/lorebooks

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
  lorebooks.html                    ← listagem e gestão de lorebooks (world info)
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
        events.js                   ← addBubble, rollback, edição inline, send, regenerate, resumeActiveGeneration (regruda numa geração em andamento), initInputListeners
        loader.js                   ← init() (carrega personagem/conversa/mensagens, chama resumeActiveGeneration()), initImmersiveMode()
      check.js / index.js / persona.js / new-character.js / edit-character.js / settings.js / viewdb.js / lorebooks.js
  core/
    logger.js                       ← logConversationTurn(): log estruturado por turno — config, memórias injetadas/disponíveis, lorebooks
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
  lorebooks                         ← modelo de dados, fluxo de injeção, associação por personagem e boas práticas
```

## Banco de dados — tabelas principais

| Tabela | Descrição |
|--------|-----------|
| `characters` | id, name, description, personality, physical_traits (tiques físicos/tells por personagem — injetado no prompt como seção própria "PHYSICAL TELLS"), avatar_url (imagem principal = primeira da galeria), scenario, first_message, affection_points (pontos de afeto acumulados), affection_override (estágio fixado manualmente; NULL = automático) |
| `character_images` | id, character_id, url, position — galeria de imagens do personagem; o chat sorteia uma como background a cada carregamento. Migração: DBs antigos herdam avatar_url como primeira imagem |
| `conversations` | id, character_id, user_persona, title, scenario, first_message, last_memory_position (cursor da extração de memórias) |
| `messages` | id, conversation_id, role (user/assistant/system), content, position |
| `persona` | id='self', name, description, avatar_url (única linha) |
| `memories` | id, conversation_id, type (auto/manual/pinned), content, summary, keywords, is_pinned, relevance_weight |
| `lorebooks` | id, scope='global', title, content, keywords, insertion_order |
| `character_lorebooks` | character_id, lorebook_id — many-to-many; se vazio para o personagem, usa todos os lorebooks |
| `generation_config` | id='global', model, temperature, top_p, top_k, min_p, repeat_penalty, repeat_last_n, max_tokens, min_tokens, context_size, stream, seed, stop (CSV), num_ctx_messages, memory_interval, think (raciocínio nativo do Ollama, desligado por padrão) |
| `conversation_config` | override por conversa — **apenas `model`** (get/setConversationModel); único override existente |

**Importante:** `sql.js` não persiste automaticamente — sempre chamar `saveDB()` após escrita. `saveDB()` é **debounced** (~500ms); a gravação imediata é `flushDB()`, chamada no shutdown. A coluna `stop` é CSV (o parseStop ainda lê o formato JSON legado de bancos antigos).

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
GET    /api/characters/:id         → busca por ID (inclui `images`: galeria [{id, url, position}])
POST   /api/characters             → cria (avatar_uploads: [{data, filename}] em base64 e/ou avatar_link; aceita legado avatar_upload singular; exige ≥1 imagem)
PUT    /api/characters/:id         → edita (todos os campos opcionais exceto name; avatar_uploads/avatar_link APENDAM à galeria; remove_image_ids remove — galeria nunca fica vazia; avatar_url = primeira imagem restante)
```

### Conversas e chat
```
GET  /api/characters/:id/conversation       → busca ou cria conversa para o personagem
POST /api/conversations                     → cria conversa + insere first_message
GET  /api/conversations/:id                 → dados da conversa
GET  /api/conversations/:id/messages        → histórico ordenado por position
POST /api/conversations/:id/messages        → envia mensagem → streaming SSE (409 se já houver geração em andamento)
POST /api/conversations/:id/regenerate      → regenera última resposta → streaming SSE (409 se já houver geração em andamento)
GET  /api/conversations/:id/generation      → regruda numa geração em andamento (streaming SSE; 204 sem corpo se não houver nenhuma)
POST /api/conversations/:id/reset          → apaga todas as mensagens e memórias, reinsere first_message
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
GET  /api/affection/levels  → escala de níveis de afeição (select de override na edição de personagem)
GET  /api/models            → lista modelos instalados no Ollama (nome, tamanho, família, parâmetros)
POST /api/models/pull       → baixa um modelo do Ollama → streaming SSE de progresso
GET  /api/viewdb/tables     → lista tabelas com contagem
GET  /api/viewdb/records    → últimas 25 linhas de uma tabela (?table=X)
GET    /api/lorebooks               → lista todos os lorebooks
POST   /api/lorebooks               → cria lorebook
GET    /api/lorebooks/:id           → busca por ID
PUT    /api/lorebooks/:id           → edita lorebook
DELETE /api/lorebooks/:id           → exclui lorebook (e remove associações)
GET    /api/characters/:id/lorebooks → IDs dos lorebooks associados ao personagem
PUT    /api/characters/:id/lorebooks → define associações (body: {lorebook_ids: [...]})
```

## Padrão do chat (streaming)

`POST /api/conversations/:id/messages` funciona assim:
1. Valida e busca conversa + personagem + persona; 409 se já houver uma geração em andamento para a conversa (`isGenerating()`)
2. Resolve config por campo com validação (`resolveConfig`): `generation_config` (banco) → `.env defaults` → `medium_spec.json`; campo `NULL`/inválido cai para a próxima fonte. Exceção: `context_size = NULL` é "contexto automático" (deliberado) — resolvido em `streamOllama()` para o `context_length` real do modelo via `getModelContextLength()` (`/api/show`, cacheado em memória por nome de modelo), não simplesmente omitido do request. Único override: modelo da conversa (`conversation_config`)
3. Monta mensagens via `buildPromptMessages()` (ver `src/core/promptBuilder.js` e `contexto/prompt_builder`)
4. Busca últimas N mensagens (`getLastNMessages`) para contexto
5. Salva mensagem do usuário no banco (`addMessage`) e registra a geração em `generationManager.beginGeneration()`
6. Calcula `dynamicMaxTokens` — proporcional ao tamanho da mensagem do usuário
7. Chama `http://127.0.0.1:11434/api/chat` com `stream: true` e `think: config.think` via `streamOllama()`
8. Responde com **SSE** (`Content-Type: text/event-stream`)
9. Cada chunk: `data: {"delta":"texto","done":false}`
10. Final: `data: {"delta":"","done":true,"message_id":"...","user_message_id":"..."}`
11. Filtra `<think>...</think>` (fallback para modelos que inlinam raciocínio no `content` mesmo com `think:false`) durante o stream
12. Salva resposta completa no banco ao final

### Geração desacoplada do frontend (`generationManager.js` + `streamOllama`)

A resposta do Ollama **não depende da conexão HTTP que a disparou**. `src/core/chat/generationManager.js` mantém um registro em memória por `conversationId` (`assistantMessageId`, `content` acumulado, `subscribers`: o `Set` de conexões SSE atualmente escutando). `streamOllama()` nunca mais escreve direto num único `res` — ele transmite cada delta via `broadcast(conversationId, ...)` para todo subscriber conectado *no momento*, e persiste o conteúdo no banco progressivamente (`addMessage` no primeiro chunk, depois `updateMessage` throttled a cada 300ms, forçado no fim) — não só ao final.

- **Cliente desconecta no meio (troca de página, aba fechada, tela apagou):** a rota apenas remove aquele `res` dos subscribers (`res.on("close", () => detachSubscriber(...))`) — a geração **continua rodando** e sendo salva no banco. A única causa de abort do fetch ao Ollama agora é o próprio modelo travar (timeout de inatividade de 120s → `AbortController`).
- **Reconectar a uma geração em andamento:** `GET /api/conversations/:id/generation` — se `getGeneration(conversationId)` existir, abre SSE, manda um evento `{delta, done:false, sync:true, message_id}` com o snapshot do que já foi gerado (`gen.content`, atualizado em tempo real a cada broadcast — não fica atrás do throttle de persistência no banco) e vira subscriber dos deltas seguintes; sem geração ativa, retorna `204` sem corpo. O frontend chama isso automaticamente no load da página (`resumeActiveGeneration()` em `chat/events.js`, disparado por `loader.js`) — é assim que a resposta "continua aparecendo" mesmo depois de sair e voltar para o chat.
- **Uma geração por conversa por vez:** `beginGeneration()` recusa (retorna `null`) se já houver uma ativa; as rotas de envio/regenerar respondem `409` nesse caso.
- `regenerate` usa o mesmo mecanismo — `insertPosition` (opts do `streamOllama`) replica a posição da mensagem substituída.
- O regenerate só apaga a última resposta se ela for de fato a última mensagem da conversa — se a última for do usuário (geração anterior falhou), a nova resposta é apensada ao fim sem reordenar. `addMessage` sem `position` calcula `MAX(position)+1` no SQL (sem corrida). O PATCH de mensagem valida que ela pertence à conversa (404 caso contrário).

### Thinking (raciocínio do modelo)

- `generation_config.think` (bool, padrão `false`) controla o parâmetro nativo `think` da API do Ollama — configurável em `/settings` (toggle no card "Modelo em uso"). Só tem efeito em modelos com suporte a reasoning (qwen3, qwen3.5, deepseek-r1, gpt-oss, etc.); em outros modelos o Ollama ignora o parâmetro.
- Quando ativo, o Ollama retorna o raciocínio no campo separado `message.thinking` (distinto de `message.content`) a cada chunk do stream. `streamOllama()` acumula isso em `rawThinking` — **nunca** é enviado por SSE, salvo como mensagem ou passado ao extrator de memórias; existe só para diagnóstico.
- Em modo dev, `logConversationTurn()` grava esse raciocínio numa seção própria (`RACIOCÍNIO DO MODELO`) em `data/logs/`, antes da seção de resposta bruta — é por isso que ele não aparecia nos logs antes desta mudança (o parâmetro vinha hardcoded como `false`).
- `memory/extraction.js` e `chat/ideas.js` fazem chamadas Ollama próprias com `think: false` fixo (JSON estruturado não se beneficia de raciocínio) — não seguem essa config.

## Eventos do chat (frontend)

Todos implementados em `public/assets/js/chat/events.js`.

### Enviar mensagem
`sendMessage()` → POST `/api/conversations/:id/messages` → lê SSE token a token → renderiza via `renderBubbleText()`.

### Retomar geração em andamento (resume)
`resumeActiveGeneration()`, chamada por `loader.js` logo após popular o histórico: faz `GET /api/conversations/:id/generation`; `204` → nada em andamento, não faz nada. `200` → há uma geração ativa (a página foi recarregada/trocada de aba/tela apagou no meio de uma resposta) — lê o evento `sync` (snapshot do que já foi gerado, com `message_id`), reaproveita o balão já renderizado pelo histórico se ele corresponder a esse `message_id` (ou cria um novo, se a geração começou mas nada foi persistido ainda) e continua consumindo os deltas seguintes exatamente como `sendMessage()`. Enquanto isso, `state.isStreaming` fica `true` e o input desabilitado.

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

### Resetar conversa
Botão "Reiniciar conversa" no offcanvas nav do chat (`#nav-reset-chat`).
Abre `#resetModal` de confirmação → POST `/api/conversations/:id/reset`.
Apaga todas as mensagens e memórias da conversa, reinsere `first_message` como `assistant` position=0 e re-renderiza o DOM.
Implementado em `initResetModal()` — fecha o offcanvas via `hidden.bs.offcanvas` com `{ once: true }` antes de abrir o modal.

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
- Bolha de cenário: bolha central (`renderScenarioBubble` em `ui.js`) no topo do histórico com o cenário da conversa (`conversation.scenario || title`), sempre acima de todas as mensagens; re-renderizada após reset (`state.scenarioText`); rollback não a afeta (não é `.msg-row`)
- Indicador de digitação: 3 pontos animados enquanto aguarda Ollama
- Streaming token-a-token: `reader.getReader()` + SSE parsing
- Header contém: botão de menu (offcanvas nav), avatar, nome/cenário, botão editar personagem, botão voltar

## Fluxo de criação de personagem

1. `POST /api/characters` com uma ou mais imagens (`avatar_uploads` base64 e/ou `avatar_link`) → salvas em `public/assets/uploads/` e registradas em `character_images`; a primeira vira `avatar_url` (cards, sidebar, header do chat)
2. Resposta: `{ ok: true, id: "uuid" }`
3. Redirect para `/chat/:id`
4. Chat page faz `GET /api/characters/:id/conversation` → cria conversa + insere `first_message` como mensagem `assistant` position=0
5. Carrega mensagens e exibe

## Fluxo de edição de personagem

1. Botão de lápis no card da index ou no header do chat → `/character/:id/edit`
2. `edit-character.js` carrega dados via `GET /api/characters/:id` e pré-preenche o form
3. Submit envia `PUT /api/characters/:id` — imagens novas (upload múltiplo ou link) apendam à galeria; a galeria atual é exibida com marcação de remoção (`remove_image_ids`, aplicada no salvar; arquivos locais removidos do disco); backend impede galeria vazia
4. Redireciona para `/chat/:id`

## Parâmetros de geração de IA

Referência completa em `config_recomendadas/README.MD`. Parâmetros principais:

| Parâmetro | Função | Impacto no hardware |
|-----------|--------|---------------------|
| `temperature` | Criatividade / aleatoriedade do token escolhido | Nenhum |
| `top_p` | Nucleus sampling — mantém tokens que somam X% de probabilidade | Nenhum |
| `top_k` | Mantém apenas os K tokens mais prováveis | Nenhum |
| `min_p` | Filtro dinâmico — descarta tokens abaixo de X% do token mais provável | Nenhum |
| `repeat_penalty` | Penaliza tokens já usados no contexto recente | Leve |
| `repeat_last_n` | Janela de tokens observados pelo repeat_penalty | Leve |
| `max_tokens` | Comprimento máximo de cada resposta | Alto (linear) |
| `min_tokens` | Mínimo de tokens na resposta (evita respostas curtíssimas) | Alto (linear) |
| `context_size` | Janela de contexto total (KV Cache) — maior = mais memória do personagem | **Alto (quadrático)** |
| `num_ctx_messages` | Quantas mensagens do histórico enviar ao Ollama (total, user+assistant) | Indireto |
| `seed` | Semente do RNG (`-1` = aleatório) | Nenhum |
| `stop` | Tokens de parada que encerram a geração | Nenhum |
| `stream` | Envia tokens um a um em tempo real | Nenhum |
| `think` | Ativa o raciocínio nativo (`message.thinking`) em modelos com suporte a reasoning (qwen3, deepseek-r1, gpt-oss...); nunca aparece no chat, só nos logs dev | **Alto** (soma tokens de raciocínio à resposta) |

A config é resolvida por campo em `resolveConfig()` com validação: `generation_config` (banco) → `appConfig.defaults` (.env) → `config_recomendadas/medium_spec.json` (último recurso). Um campo `NULL` ou inválido numa fonte cai para a próxima — nunca chega ao Ollama. Exceção: `context_size = NULL` significa "contexto automático" — em vez de omitir `num_ctx` do request (o que faria o Ollama cair no default hardcoded de 4096 tokens para modelos sem `PARAMETER num_ctx` no Modelfile), `streamOllama()` resolve para o `context_length` real do modelo via `getModelContextLength()` em `src/services/ollama.models.js` (`POST /api/show`, cacheado em memória por nome de modelo). **`NULL` (automático) é o padrão de fábrica** (`medium_spec.json` e `appConfig.defaults`) — um valor fixo só existe se o usuário desmarcar "Contexto automático" em `/settings`. O único override é o modelo por conversa (`conversation_config`); como o `context_size` continua global, trocar o modelo de uma conversa com contexto fixo (não automático) não adapta o `num_ctx` ao novo modelo — o modal "Modelo desta conversa" avisa quando o valor fixo não bate com o `context_length` do modelo selecionado.

## Estrutura de memória e prompt (ver `contexto/`)

`contexto/prompt_builder` — diagrama da ordem de montagem do prompt:
1. System prompt do personagem (description + personality + scenario + persona do usuário)
2. Memórias relevantes (pinned primeiro, depois por score/keyword)
3. Lorebook entries (ativadas por keyword no chat)
4. Histórico das últimas N mensagens
5. Mensagem atual do usuário

`contexto/estrutura_memoria` — tipos de memória:
- **Auto**: gerada pelo extrator unificado (`memory/extraction.js`) quando mensagens saem da janela de contexto — o registro episódico da conversa; recuperada por keyword/score
- **Manual**: criada/editada pelo usuário; aparece só quando keywords batem com o contexto (sem keywords informadas, são derivadas do content — memória sem keywords seria irrecuperável)
- **Pinned**: sempre injetada no prompt (ver regras abaixo)
- **Lorebook**: ativada por palavras-chave mencionadas no chat

### Geração automática de memórias (extrator unificado)

- Gatilho (`memory/trigger.js`): após o evento SSE `done` (não trava o input), processa o backlog de mensagens fora da janela (`num_ctx_messages`) com `position > conversations.last_memory_position`, quando o backlog ≥ `memory_interval`. Processa até `memory_interval * 3` por vez. Backlog vem de `getMemoryBacklog()` (SQL, sem carregar a conversa inteira); um lock por conversa (Set em memória) impede extração dupla em turnos rápidos; a chamada Ollama da extração tem timeout de 120s.
- **Cursor**: `last_memory_position` só avança se a extração concluir com sucesso — falha de Ollama vira retry natural; rollback clampeia o cursor, reset zera. Nunca pula janelas.
- Extração (`memory/extraction.js`): **UMA chamada Ollama** com CHARACTER BASELINE (nunca reafirma a ficha), structured outputs (`format` JSON Schema) + parsing defensivo. Cada item vem com `pinned` (bool) e `importance` (1-5) → `relevance_weight` graduado: pinned 1.2–2.0, auto 0.8–1.2. Dedup por overlap de palavras (>0.55); auto também deduplica contra pinned. Keywords ausentes são derivadas do content (`extractKeywordsFromText`).
- Eventos SSE após o `done`: `{type:"memory_processing"}` → `{type:"memories_created", auto, pinned}` — o frontend mostra status e toast de pinned.

### Memórias Pinned — critério e garantias

Pinned bypassa o filtro de keyword e é sempre injetada. Reservada para **momentos que definem o personagem ou a relação daqui em diante** — o que uma pessoa ainda lembraria anos depois.

**Exemplos válidos (✓):**
- Evento muito forte: "Quase morreu no incêndio do teatro; foi salva pelo usuário."
- Sentimento intenso declarado: "Confessou estar apaixonada pelo usuário."
- Grande virada emocional: "Deixou de confiar no usuário após descobrir a mentira sobre a carta."
- Mudança física: "Perdeu a visão do olho esquerdo na batalha de Ardenmoor."

**Exemplos inválidos (✗ — use auto/manual com keywords):**
- Variação de humor passageira: "Ficou com raiva quando mencionaram cavalos."
- Preferências: "Gosta de chá." → vai em description/personality do personagem.
- Detalhe de cena: "Estavam no café quando o segredo foi revelado."

**Validações obrigatórias em `createPinnedMemory()`:**
- `content` com mínimo de 20 caracteres (fatos curtos demais são vagos)
- `keywords` obrigatório — mesmo sem usar no filtro, serve de referência semântica e auditoria
- `relevanceWeight` gradua a prioridade entre pinned (extrator usa 1.2–2.0 conforme `importance`)

**Cap automático no retrieval:**
`getRelevantMemories()` limita a 10 pinned por padrão (`maxPinned`), ordenando por `relevance_weight DESC`. Se houver mais de 10 pinned, as de menor peso são descartadas do prompt. Isso previne que o prompt estoure após conversas longas com muitas pinned acumuladas.

### Retrieval e injeção

- Matching por keyword com **fronteira de palavra** e **insensível a acentos** ("coração" ≡ "coracao"; "ana" não casa em "banana").
- Score não-pinned = `(hits / total_keywords) * relevance_weight`; empate → mais recente. Top 5 por padrão.
- O `promptBuilder` **não re-filtra** — recebe as memórias já selecionadas pelo retrieval e injeta o `content` completo em dois blocos: `[Core memories …]` (pinned) e `[Relevant memories …]` (contextuais).

## Sistema de afeto (`src/core/affection.js`)

Pontos de afeto por personagem (`characters.affection_points`) definem o estágio da relação personagem↔usuário — compartilhados entre todas as conversas do personagem:

- **Ganho**: cada mensagem do usuário rende 1 ponto; +1 se ≥240 chars; +1 se contém `*ações*` de roleplay (máx 3). O prompt já reflete o nível novo (pontos prospectivos), mas a persistência (`addAffectionPoints`) só ocorre no `onDone` se a geração produziu resposta — falha de Ollama não pontua, e o evento SSE de afeição só é emitido em turno salvo.
- **Escala** (thresholds cumulativos, gaps crescentes): Estranhos 0 → Conhecidos 10 → Amigos 30 → Amigos próximos 95 → Melhores amigos 180 → Paquera 320 → Namorados 470 → Apaixonados 650 → Almas gêmeas 900.
- **Prompt**: `buildPromptMessages({ affection })` injeta o bloco `[Relationship — how X currently feels about Y]` logo após o character card, com orientação de comportamento por nível e instrução explícita de não forçar o estágio em toda resposta nem mencionar níveis/pontos.
- **SSE**: após o `done`, o backend emite `{type:"affection", points, level, name, next_threshold, progress, leveled_up}` — o frontend atualiza o badge no header (`#header-affection`, coração + nome do nível + barra de progresso) e mostra toast em level-up.
- **Reset** da conversa NÃO zera os pontos (a afeição é do personagem e sobrevive entre conversas); rollback também não mexe neles. `GET /api/conversations/:id` e `POST .../reset` retornam `affection` no payload (calculada dos pontos do personagem). Migração: DBs antigos herdam em `characters.affection_points` o MAX entre as conversas do personagem.
- **Override manual**: `characters.affection_override` (NULL = automático) fixa o estágio da relação — configurável no select da página de edição do personagem (`edit-character.html`), que carrega a escala via `GET /api/affection/levels`. Com override ativo, `getEffectiveAffection()` retorna o nível fixado (`override: true`, `next_threshold: null`, `progress: 1` → badge sem barra de progressão) e nunca emite level-up; os pontos continuam acumulando em segundo plano, então voltar para "Auto" retoma a progressão normal do banco. Validação no PUT: inteiro dentro da escala ou null.

## Config centralizada (`src/config.js`)

Todas as variáveis de ambiente são lidas aqui via `dotenv`. Demais arquivos importam `appConfig`:
- `appConfig.port` / `appConfig.nodeEnv`
- `appConfig.ollama.host` / `.chatEndpoint` / `.tagsEndpoint`
- `appConfig.dbPath`
- `appConfig.auth` — basic auth opcional: definir `AUTH_PASSWORD` no .env ativa o middleware (usuário padrão `openrp`, muda com `AUTH_USER`); sem ela, acesso livre. Importante quando exposto via Tailscale.
- `appConfig.defaults` — valores padrão de todos os parâmetros de geração

## Comandos

```bash
npm start        # produção
npm run dev      # watch mode (node --watch)
npm test         # testes (node:test, pasta tests/ — lógica pura: affection, helpers, retrieval, promptBuilder)
```

## Testes temporários

Scripts de teste criados em `tests/` (ou em qualquer lugar) apenas para verificar uma hipótese pontual durante uma tarefa (debug, validação de fix, experimento) **devem ser apagados** ao final da tarefa — não deixar sujeira no repositório. Isso não se aplica à suíte de testes permanente (`node:test` em `tests/`), que só cresce quando o usuário pedir explicitamente para adicionar um teste definitivo.

## Observações importantes

- **Persona é obrigatória** para acessar `/` — redireciona para `/persona` se não existir
- **Ollama é obrigatório** — redireciona para `/check` se não responder
- Config de geração: `global` (banco) → `.env defaults` → `medium_spec.json`, por campo com validação; único override é o modelo por conversa
- O modelo padrão é `gemma4:12b` com `context_size = NULL` (contexto automático, ver seção de parâmetros abaixo) — pode ser alterado em `/settings`. Os presets `low_spec`/`high_spec` (não o padrão de fábrica) ainda usam `gemma4:e4b`/`gemma4:e4b-64k` com `context_size` fixo; na inicialização, `ollama.models.js` tenta criar automaticamente `gemma4:e4b-64k` (64k ctx) via Modelfile API se ainda não existir, para suportar o preset "Máquina Forte"
- Avatar upload: enviado como base64 no body JSON (`avatar_uploads` array; múltiplos por request), validado por **magic bytes** (PNG/JPEG/WebP/GIF, máx 8MB cada — a extensão salva vem do tipo detectado, nunca do nome enviado; o lote inteiro é validado antes de gravar qualquer arquivo) e salvo em `public/assets/uploads/` como `timestamp-i-rand-nome.ext`
- Galeria de imagens: `character_images` guarda todas as imagens do personagem; `chat/loader.js` sorteia uma para o background a cada carregamento do chat (header/nav continuam com `avatar_url`, a imagem principal)
- Todos os IDs são UUIDs v4
- `getLastNMessages` retorna as últimas N mensagens **totais** (user+assistant, exclui system) por `position DESC LIMIT n`, revertidas (mais antiga primeiro) — mesma definição de janela usada pelo gatilho de memórias
- `{{user}}` (nome da persona) e `{{char}}` (nome do personagem) são expandidos em `first_message` e em todo o system prompt do `promptBuilder` (description, personality, likes/dislikes, cenário, memórias e lorebooks)
- Frontend: todo dado do banco interpolado em `innerHTML` passa por escape (`escHtml`/`sidebarEscHtml`)
- `character.routes.js` usa factory `characterRouter(uploadDir)` porque precisa do caminho de upload injetado pelo `webServer.init.js`
- `chat.js` frontend usa `type="module"` e ES Modules; os demais JS são scripts regulares
- `queries.js` é um barrel puro — toda lógica de banco fica em `queries/` (um arquivo por domínio); importar de `queries.js` continua funcionando sem mudança nos consumidores
- `logConversationTurn()` em `logger.js` recebe `allMemories` e `allLorebooks` (tudo que existe no banco) além do que foi injetado — quando nenhum item é usado, o log lista os disponíveis com seus keywords para diagnóstico
