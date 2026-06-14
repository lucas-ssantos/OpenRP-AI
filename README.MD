# OpenRP AI — Plataforma Local de Roleplay (Web + Chat)

OpenRP AI é uma aplicação local para chat e roleplay com IA utilizando modelos do Ollama, inspirada por TalkieAI, LinkyAI, SillyTavern e TavernAI. O foco é oferecer uma plataforma que rode no navegador, mantendo todos os dados e modelos localmente: sem login centralizado, sem funcionalidades de compartilhamento online e essas baboseiras e ser refem de empresas.

Principais características:

- Cartões de personagem (nome, display name, descrição, personalidade, avatar)
- Histórico persistente de conversas
- Memórias e resumos automáticos
- Configurações de geração (globais e por personagem)
- Integração com modelos locais via Ollama
- Frontend web servido localmente pela aplicação (SPA)

## Requisitos

- Node.js 20 ou superior
- Ollama (daemon local com API)
- Linux (recomendado com systemd)

## Instalação rápida

1) Instale o Node.js (recomendado usar `nvm`):

```bash
curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.4/install.sh | bash
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \ . "$NVM_DIR/nvm.sh"
nvm install 20
nvm use 20
```

2) Instale dependências do projeto:

```bash
npm install
```

3) Instale o Ollama e habilite o serviço (exemplos):

- Leia a documentação oficial em https://ollama.com para instruções atualizadas.
- Em Arch Linux:

```bash
sudo pacman -S ollama
sudo systemctl enable --now ollama
```

Se preferir, use um instalador oficial disponibilizado pela equipe do Ollama — o passo acima é um exemplo para Arch.

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

## Privacidade e design local

Este projeto foi pensado para ser totalmente local: nenhum dado é enviado por padrão para serviços remotos ou compartilhado entre usuários. Os modelos são executados localmente via Ollama, e os arquivos permanecem na máquina do usuário.

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

## Futuro

O projeto pretende manter foco em chat/roleplay local, com planos para:

- Memórias semânticas e vetores
- Adicionar botão de visualizar imagem de trás do chat
- Adicionar edição de menssagem do chat
- Alterar retroceder apenas para menssagens do personagem

---

Contribuições e melhorias são bem-vindas, mas o objetivo principal é garantir uma experiência local, privada e simples de usar.
