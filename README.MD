# OpenRP AI — Plataforma Local de Roleplay (Web + Chat)

OpenRP AI é uma aplicação local para chat e roleplay com IA utilizando modelos do Ollama, inspirada por TalkieAI, LinkyAI, SillyTavern e TavernAI. O foco é oferecer uma plataforma que rode no navegador, mantendo todos os dados e modelos localmente: sem login centralizado, sem funcionalidades de compartilhamento online e essas baboseiras de serem refens de empresas.

Principais características:

- **Criação de personagens** — defina nome, descrição, personalidade, cenário, primeira mensagem e avatar. Cada personagem tem sua própria conversa persistente e pode ter configurações de geração independentes.

- **Histórico persistente de conversas** — todas as mensagens são salvas localmente em SQLite. Edição inline de qualquer mensagem, rollback para um ponto anterior da conversa e regeneração da última resposta do personagem.

- **Memórias automáticas e fixadas** — o sistema extrai automaticamente fatos relevantes das conversas e os armazena como memórias. As memórias *pinned* (fixadas) são especiais: representam mudanças permanentes na narrativa — como um segredo revelado, uma ferida que não cura ou uma relação que mudou para sempre — e são sempre injetadas no prompt em todas as futuras mensagens, garantindo que o personagem jamais "esqueça" esses fatos estruturais.

- **Lorebooks (World Info)** — entradas de contexto sobre o mundo do roleplay: facções, NPCs, localizações, leis de magia, história do universo. Cada entrada possui palavras-chave que ativam a injeção automática no prompt quando o tema surgir na conversa. É possível configurar quais lorebooks cada personagem pode acessar.

- **Configurações de geração** — controle fino de parâmetros como temperature, top-p, top-k, repeat penalty, tamanho do contexto e número de mensagens de histórico enviadas ao modelo. Presets para máquinas fracas, médias e potentes.

- **Integração com Ollama** — usa qualquer modelo disponível localmente via Ollama. Streaming token a token com suporte a reasoning tokens (filtro de `<think>`). Modelo padrão: `gemma4:e4b`. Ao iniciar, a aplicação cria automaticamente variantes com contexto expandido (`gemma4:e4b-32k` e `gemma4:e4b-64k`) para uso nos presets de máquina média e potente.

- **100% offline e local** — nenhum dado sai da sua máquina. Sem login, sem nuvem, sem assinatura.

## Privacidade e design local

Este projeto foi pensado para ser totalmente local: nenhum dado é enviado por padrão para serviços remotos ou compartilhado entre usuários. Os modelos são executados localmente via Ollama, e os arquivos permanecem na máquina do usuário.

## Futuro

O projeto pretende manter foco em chat/roleplay local, com planos para:

- Memórias semânticas e vetores
- Adicionar um scrip de instalação
- Criar um desktop.entry para poder utilizar fora do terminal

## Requisitos

- Node.js 20 ou superior
- Ollama (daemon local com API)
- Linux (recomendado com systemd)

## Instalação rápida

1) Instale o Ollama (exemplos):

- Leia a documentação oficial em https://ollama.com para instruções atualizadas.
- Em Arch Linux:

```bash
sudo pacman -S ollama
sudo systemctl enable --now ollama
```

**ATENÇÃO**: No Archlinux se possui três pacotes, ```ollama```, ```ollama-rocm``` e ```ollama-nvidia```
Utilize o pacote correspondente para sua placa de vídeo, usar o pacote errado pode e provavelmente vai acarretar
em uma velocidade muito inferior do que o esperado.

Placas AMD: ollama-rocm
Placas NVIDIA: ollama-nvidia

O pacote ollama deve ser instalado junto como dependência.

Se preferir, use um instalador oficial disponibilizado pela equipe do Ollama — o passo acima é um exemplo para Arch.

2) Instale o Node.js (recomendado usar `nvm`):

```bash
curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.4/install.sh | bash
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \ . "$NVM_DIR/nvm.sh"
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

## Uso e desenvolvimento

- Rodar em modo de desenvolvimento (backend + watcher):

```bash
npm run dev
```

- Comandos úteis (definidos em `package.json`):

- `npm start` — inicia a aplicação (backend + serve frontend se existir)
- `npm run dev` — inicia em modo watch

## Ajuda / Troubleshooting

- Se a verificação do Ollama falhar, veja os logs do systemd:

```bash
sudo journalctl -u ollama -f
```

- Confirme que a porta `11434` está acessível localmente.

---

Contribuições e melhorias são bem-vindas, mas o objetivo principal é garantir uma experiência local, privada e simples de usar.
