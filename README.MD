# Roleplay AI

A local-first Roleplay and Chat AI platform powered by Ollama and Node.js.

The goal of this project is to create a system similar to TalkieAI, LinkyAI and SillyTavern, featuring:

* Character cards
* Persistent chat history
* Memories and summaries
* Configurable generation presets
* Character-specific overrides
* Local models through Ollama
* REST API first
* Future Web Client

---

## Features

### Characters

* Name
* Display name
* Avatar
* Description
* Personality
* Scenario
* First message
* Example dialogues
* Tags
* Creator notes

Characters can optionally override global generation settings.

---

### Generation Settings

Global settings:

* temperature
* top_p
* top_k
* min_p
* repeat_penalty
* num_ctx
* max_tokens
* stream
* history_messages
* memory_messages
* summary_interval

Character-specific overrides are supported.

---

### Chats

* Persistent conversations
* Multiple chats per character
* Automatic summaries
* Message history
* Token counting

---

### Memories

Memories are stored independently from messages.

Examples:

* User likes rock music.
* User has a black cat.
* Character and user met at a tavern.

Memories can later evolve into semantic search using embeddings.

---

## Architecture

```text
User Message

↓

Memory Service

↓

Summary Service

↓

Context Builder

↓

Message Builder

↓

Ollama Service

↓

Response

↓

Database
```

---

## Project Structure

```text
src/

├── api/
│   ├── routes/
│   ├── controllers/
│   └── middlewares/
│

├── builders/
│   ├── context.builder.js
│   ├── message.builder.js
│   └── prompt.builder.js
│

├── core/
│   ├── ollama.init.js
│   └── shutdown.js
│

├── database/
│   ├── db.js
│   ├── migrations.js
│   └── save.js
│

├── services/
│   ├── ollama.service.js
│   ├── memory.service.js
│   ├── summary.service.js
│   └── settings.service.js
│

└── index.js
```

---

## Data Directory

All persistent files are stored inside:

```text
/data

database.sqlite

characters/

lorebooks/

uploads/

vectors/
```

---

## Requirements

* Node.js >= 20
* Ollama
* Linux with systemd

---

## Installing Ollama

Arch Linux:

```bash
sudo pacman -S ollama
```

or

```bash
yay -S ollama
```

Enable service:

```bash
sudo systemctl enable ollama

sudo systemctl start ollama
```

---

## Startup Flow

When the application starts:

1. Check if Ollama is installed.
2. Verify if the Ollama service is running.
3. Attempt to start Ollama if needed.
4. Verify the API at:

```text
http://127.0.0.1:11434/api/tags
```

5. Initialize database.
6. Run migrations.
7. Start REST API.

If any step fails, the application exits.

---

## Shutdown Flow

When the application receives:

* CTRL+C (`SIGINT`)
* `SIGTERM`
* `uncaughtException`
* `unhandledRejection`

the system:

1. Saves the database.
2. Stops the Ollama service.
3. Closes all resources.
4. Exits safely.

---

## Future Plans

* Web UI
* Lorebooks
* Vector embeddings
* Semantic memory search
* Multi-character chats
* Group chats
* TTS/STT
* Image generation
* OpenAI-compatible API
* WebSocket streaming
* Mobile client

---

## Inspiration

This project is inspired by:

* TalkieAI
* LinkyAI
* SillyTavern
* TavernAI

but aims to provide a fully local-first experience powered by Ollama.
