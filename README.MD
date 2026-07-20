# OpenRP AI — Plataforma Local de Roleplay (Web + Chat)

OpenRP AI é uma aplicação local para chat e roleplay com IA utilizando modelos do Ollama, inspirada por TalkieAI, LinkyAI, SillyTavern e TavernAI. O foco é oferecer uma plataforma que rode no navegador, mantendo todos os dados e modelos localmente: sem login centralizado, sem funcionalidades de compartilhamento online e essas baboseiras de serem refens de empresas.

Principais características:

- **Criação de personagens** — defina nome, descrição, personalidade, cenário, primeira mensagem e uma **galeria de imagens** (upload múltiplo ou link). A primeira imagem vira o avatar principal; no chat, uma imagem da galeria é sorteada como background a cada carregamento. Cada personagem tem sua própria conversa persistente.

- **Histórico persistente de conversas** — todas as mensagens são salvas localmente em SQLite. Edição inline de qualquer mensagem, rollback para um ponto anterior da conversa, regeneração da última resposta e reset completo da conversa.

- **Memórias automáticas e fixadas** — o sistema extrai automaticamente fatos relevantes das conversas (com data/hora e exibição relativa, "há X dias") e os armazena como memórias. As memórias *pinned* (fixadas) são especiais: representam mudanças permanentes na narrativa — como um segredo revelado, uma ferida que não cura ou uma relação que mudou para sempre — e são sempre injetadas no prompt em todas as futuras mensagens, garantindo que o personagem jamais "esqueça" esses fatos estruturais.

- **Sistema de afeição** — cada personagem acumula pontos de afeto conforme a interação, progredindo por estágios de relacionamento (de Estranhos até Almas gêmeas). O estágio atual influencia o comportamento do personagem no prompt e aparece como badge com barra de progresso no chat. Também é possível fixar manualmente o estágio na edição do personagem (override).

- **Lorebooks (World Info)** — entradas de contexto sobre o mundo do roleplay: facções, NPCs, localizações, leis de magia, história do universo. Cada entrada possui palavras-chave que ativam a injeção automática no prompt quando o tema surgir na conversa. É possível configurar quais lorebooks cada personagem pode acessar.

- **Persona do usuário** — defina quem *você* é no roleplay (nome, descrição, avatar). Os placeholders `{{user}}` e `{{char}}` são expandidos em todo o prompt.

- **Configurações de geração** — controle fino de parâmetros como temperature, top-p, top-k, min-p, repeat penalty, tamanho do contexto e número de mensagens de histórico enviadas ao modelo. Presets para máquinas fracas, médias e potentes, e troca de modelo por conversa.

- **Integração com Ollama** — usa qualquer modelo disponível localmente via Ollama (com listagem e download de modelos direto pela página de configurações). Streaming token a token com suporte a reasoning tokens (filtro de `<think>`). Modelo padrão: `gemma4:e4b`. Ao iniciar, a aplicação cria automaticamente variantes com contexto expandido (`gemma4:e4b-32k` e `gemma4:e4b-64k`) para uso nos presets de máquina média e potente.

- **100% offline e local** — nenhum dado sai da sua máquina. Sem login, sem nuvem, sem assinatura. Opcionalmente, acesse de outros dispositivos via Tailscale com autenticação básica.

## Privacidade e design local

Este projeto foi pensado para ser totalmente local: nenhum dado é enviado por padrão para serviços remotos ou compartilhado entre usuários. Os modelos são executados localmente via Ollama, e os arquivos permanecem na máquina do usuário.

## Futuro

O projeto pretende manter foco em chat/roleplay local, com planos para:

- Memórias semânticas e vetores
- Adicionar um script de instalação
- Criar um desktop.entry para poder utilizar fora do terminal

## Requisitos

- Node.js 20 ou superior
- Ollama (daemon local com API)
- Linux (recomendado Debian/Ubuntu com systemd)

## Instalação rápida

1) Instale o Ollama:

O jeito recomendado é usar o script oficial de instalação, que funciona no Debian e derivados (Ubuntu, Mint, etc.) e detecta automaticamente sua GPU (NVIDIA/AMD):

```bash
curl -fsSL https://ollama.com/install.sh | sh
```

O script já configura e inicia o serviço systemd. Para confirmar:

```bash
sudo systemctl status ollama
```

Se o serviço não estiver ativo:

```bash
sudo systemctl enable --now ollama
```

**ATENÇÃO**: Para aceleração por GPU, instale antes os drivers da sua placa de vídeo (NVIDIA: driver proprietário + CUDA; AMD: ROCm). Sem eles o Ollama roda apenas na CPU, o que é muito mais lento. Leia a documentação oficial em https://ollama.com para instruções atualizadas.

2) Instale o Node.js (recomendado usar `nvm`):

```bash
curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
nvm install 20
nvm use 20
```

3) Instale dependências do projeto:

```bash
npm install
```

4) Verifique se a API do Ollama está respondendo:

```bash
curl -sS http://127.0.0.1:11434/api/tags
```

Se receber uma resposta HTTP 200, a API está pronta.

## Como iniciar a aplicação localmente

```bash
npm start
```

Por padrão a aplicação (backend + frontend) escutará em `http://0.0.0.0:3000` (ou `PORT` definido em variáveis de ambiente). Após iniciar, abra o navegador em:

```
http://localhost:3000
```

## Acesso remoto via Tailscale (opcional)

Se quiser acessar o OpenRP AI de outros dispositivos (celular, notebook) sem expor nada à internet, o Tailscale cria uma VPN privada entre suas máquinas:

1) Instale com o script oficial:

```bash
curl -fsSL https://tailscale.com/install.sh | sh
```

2) Autentique e conecte a máquina à sua rede:

```bash
sudo tailscale up
```

3) Nos outros dispositivos, instale o Tailscale com a mesma conta e acesse `http://<ip-tailscale-da-maquina>:3000`.

**Importante**: ao expor a aplicação na rede Tailscale, ative a autenticação básica definindo `AUTH_PASSWORD` no `.env` (usuário padrão `openrp`; altere com `AUTH_USER`). Sem essa variável, o acesso é livre.

## Uso e desenvolvimento

- Rodar em modo de desenvolvimento (backend + watcher):

```bash
npm run dev
```

- Comandos úteis (definidos em `package.json`):

- `npm start` — inicia a aplicação (backend + serve frontend)
- `npm run dev` — inicia em modo watch
- `npm test` — roda os testes (node:test, pasta `tests/`)

## Ajuda / Troubleshooting

- A própria aplicação tem uma página de checagem de saúde (Ollama + banco) em `http://localhost:3000/check`.

- Se a verificação do Ollama falhar, veja os logs do systemd:

```bash
sudo journalctl -u ollama -f
```

- Confirme que a porta `11434` está acessível localmente.

---

Contribuições e melhorias são bem-vindas, mas o objetivo principal é garantir uma experiência local, privada e simples de usar.
