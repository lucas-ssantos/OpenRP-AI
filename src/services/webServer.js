import express from "express";
import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { registerWebServer } from "../core/shutdown.js";
import { getDB } from "./database/db.js";
import { createCharacter, getAllCharacters, getCharacter, getPersona, savePersona, getGenerationConfig, setGenerationConfig, createConversation, getConversation, addMessage, getConversationMessages, getLastNMessages } from "./database/queries.js";

async function getHealthStatus() {
    const status = {
        ollama: { ok: false, message: "Ollama não disponível" },
        database: { ok: false, message: "Banco de dados não inicializado" },
    };

    try {
        const response = await fetch("http://127.0.0.1:11434/api/tags");
        if (response.ok) {
            status.ollama.ok = true;
            status.ollama.message = "Ollama está ativo";
        } else {
            status.ollama.message = `Ollama respondeu com status ${response.status}`;
        }
    } catch (err) {
        status.ollama.message = "Ollama não está acessível";
    }

    try {
        const db = getDB();
        db.exec("SELECT 1");
        status.database.ok = true;
        status.database.message = "Banco de dados inicializado";
    } catch (err) {
        status.database.message = `Erro no banco de dados: ${err.message}`;
    }

    return status;
}

export async function startWebServer(port = process.env.PORT || 3000)
{
    const app = express();
    const publicPath = path.resolve(process.cwd(), "public");
    const uploadDir = path.join(publicPath, "uploads");

    if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
    }

    app.use(express.json({ limit: "10mb" }));

    //
    //  CHAMADAS DE PÁGINA
    //
    app.get("/check", (_req, res) => {
        res.sendFile(path.join(publicPath, "check.html"));
    });

    app.get("/persona", (_req, res) => {
        res.sendFile(path.join(publicPath, "persona.html"));
    });

    app.get("/character/new", (_req, res) => {
        res.sendFile(path.join(publicPath, "new-character.html"));
    });

    //INDEX
    app.get("/", async (req, res) => {
        const status = await getHealthStatus();
        if (!status.ollama.ok || !status.database.ok) {
            return res.redirect("/check");
        }

        const persona = getPersona();
        if (!persona) {
            return res.redirect("/persona");
        }

        res.sendFile(path.join(publicPath, "index.html"));
    });


    //
    //  CHAMADAS DE API
    //

    //CHECK FUNCIONANDO
    app.get("/api/status", async (req, res) => {
        const status = await getHealthStatus();
        res.json(status);
    });

    //GET PERSONA
    app.get("/api/persona", (_req, res) => {
        try {
            const persona = getPersona();
            if (!persona) {
                return res.status(404).json({ ok: false, message: 'Persona não encontrada.' });
            }
            res.json({ ok: true, persona });
        } catch (err) {
            res.status(500).json({ ok: false, message: err.message });
        }
    });

    app.post("/api/persona", (req, res) => {
        try {
            const { name, description, avatar_url } = req.body;
            if (!name) {
                return res.status(400).json({ ok: false, message: 'O nome da persona é obrigatório.' });
            }
            savePersona({ name, description, avatar_url });
            res.json({ ok: true });
        } catch (err) {
            res.status(500).json({ ok: false, message: err.message });
        }
    });

    //GET CHARACTERS
    app.get("/api/characters", (req, res) => {
        try
        {
            const characters = getAllCharacters();
            res.json({ ok: true, characters });
        }
        catch (err)
        {
            res.status(500).json({ ok: false, message: err.message });
        }
    });

    app.post("/api/characters", (req, res) => {
        try {
            const { name, description, personality, scenario, first_message, avatar_link, avatar_upload, avatar_filename } = req.body;
            if (!name) {
                return res.status(400).json({ ok: false, message: 'O nome do personagem é obrigatório.' });
            }

            let avatarUrl = null;

            if (avatar_upload && avatar_filename) {
                const safeName = `${Date.now()}-${avatar_filename.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
                const destination = path.join(uploadDir, safeName);
                const buffer = Buffer.from(avatar_upload, 'base64');
                fs.writeFileSync(destination, buffer);
                avatarUrl = `/uploads/${safeName}`;
            } else if (avatar_link) {
                avatarUrl = avatar_link;
            } else {
                return res.status(400).json({ ok: false, message: 'Envie um arquivo de imagem ou um link de avatar.' });
            }

            const characterId = createCharacter(
                name,
                description || '',
                personality || '',
                avatarUrl,
                scenario || null,
                first_message || null
            );

            res.json({ ok: true, id: characterId });
        } catch (err) {
            res.status(500).json({ ok: false, message: err.message });
        }
    });




    //
    // CONSULTA DB
    //
    app.get("/api/viewdb", (_req, res) => {
        res.sendFile(path.join(publicPath, "viewdb.html"));
    });

    function getDatabaseTables() {
        const db = getDB();
        const result = db.exec(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name;"
        );
        return result.length > 0 ? result[0].values.map((row) => row[0]) : [];
    }

    function getTableColumns(table) {
        const db = getDB();
        const result = db.exec(`PRAGMA table_info("${table}");`);
        if (result.length === 0) return [];
        return result[0].values.map((row) => row[1]);
    }

    function getTableRowCount(table) {
        const db = getDB();
        const result = db.exec(`SELECT COUNT(*) AS count FROM "${table}";`);
        return result.length > 0 ? result[0].values[0][0] : 0;
    }

    function getTableLastRows(table, limit = 25) {
        const db = getDB();
        const columns = getTableColumns(table);
        const orderBy = columns.includes('created_at') ? 'created_at' : 'rowid';
        const result = db.exec(
            `SELECT * FROM "${table}" ORDER BY ${orderBy} DESC LIMIT ${limit};`
        );
        if (result.length === 0) return { columns: [], rows: [] };
        return {
            columns: result[0].columns,
            rows: result[0].values,
        };
    }

    app.get("/api/viewdb/tables", (req, res) => {
        try {
            const tables = getDatabaseTables();
            const items = tables.map((table) => ({
                name: table,
                count: getTableRowCount(table),
            }));
            res.json({ ok: true, tables: items });
        } catch (err) {
            res.status(500).json({ ok: false, message: err.message });
        }
    });

    app.get("/api/viewdb/records", (req, res) => {
        try {
            const table = String(req.query.table || '').trim();
            if (!table) {
                return res.status(400).json({ ok: false, message: 'Tabela não informada.' });
            }

            const tables = getDatabaseTables();
            if (!tables.includes(table)) {
                return res.status(404).json({ ok: false, message: 'Tabela não encontrada.' });
            }

            const { columns, rows } = getTableLastRows(table, 25);
            const total = getTableRowCount(table);
            res.json({ ok: true, table, total, columns, rows });
        } catch (err) {
            res.status(500).json({ ok: false, message: err.message });
        }
    });

    // ===== CONFIG ENDPOINTS =====
    app.get("/settings", (_req, res) => {
        res.sendFile(path.join(publicPath, "settings.html"));
    });

    app.get("/api/presets", (_req, res) => {
        try {
            const presetsDir = path.join(process.cwd(), "config_recomendadas");
            const presets = {
                weak: {
                    name: 'Máquina Fraca',
                    desc: 'i5 7ª gen, 8GB RAM, GTX 1060 6GB',
                    config: JSON.parse(fs.readFileSync(path.join(presetsDir, 'low_spec.json'), 'utf8'))
                },
                medium: {
                    name: 'Máquina Média',
                    desc: 'Ryzen 5 5600, 16GB RAM, RX 9060 XT 8GB',
                    config: JSON.parse(fs.readFileSync(path.join(presetsDir, 'medium_spec.json'), 'utf8'))
                },
                strong: {
                    name: 'Máquina Forte',
                    desc: 'Ryzen 9 9800X3D, 32GB RAM, RTX 5080 16GB',
                    config: JSON.parse(fs.readFileSync(path.join(presetsDir, 'high_spec.json'), 'utf8'))
                }
            };
            res.json({ ok: true, presets });
        } catch (err) {
            res.status(500).json({ ok: false, message: err.message });
        }
    });

    app.get("/api/config", (_req, res) => {
        try {
            const config = getGenerationConfig('global');
            if (!config) {
                return res.json({
                    ok: true,
                    config: {
                        model: 'qwen3:8b',
                        temperature: 0.92,
                        top_p: 0.90,
                        top_k: 60,
                        min_p: 0.04,
                        repeat_penalty: 1.05,
                        repeat_last_n: 192,
                        tfs_z: 0.95,
                        max_tokens: 800,
                        context_size: 8192,
                        stream: true,
                        seed: -1,
                        stop: ["User:", "Human:", "### User", "\n\nUser:"],
                    }
                });
            }
            res.json({ ok: true, config });
        } catch (err) {
            res.status(500).json({ ok: false, message: err.message });
        }
    });

    app.post("/api/config", (req, res) => {
        try {
            const config = req.body;
            console.log('Recebido config:', config);
            
            if (!config.model) {
                return res.status(400).json({ ok: false, message: 'Modelo é obrigatório.' });
            }
            
            setGenerationConfig('global', null, config);
            console.log('Config salva com sucesso');
            
            res.json({ ok: true, message: 'Configuração salva com sucesso.' });
        } catch (err) {
            console.error('Erro ao salvar config:', err);
            res.status(500).json({ ok: false, message: `Erro ao salvar: ${err.message}` });
        }
    });

    // ===== CHAT PAGE =====
    app.get("/chat/:characterId", (_req, res) => {
        res.sendFile(path.join(publicPath, "chat.html"));
    });

    // ===== CHARACTER BY ID =====
    app.get("/api/characters/:id", (req, res) => {
        try {
            const character = getCharacter(req.params.id);
            if (!character) {
                return res.status(404).json({ ok: false, message: 'Personagem não encontrado.' });
            }
            res.json({ ok: true, character });
        } catch (err) {
            res.status(500).json({ ok: false, message: err.message });
        }
    });

    // ===== CONVERSATIONS =====
    app.post("/api/conversations", (req, res) => {
        try {
            const { character_id, title } = req.body;
            if (!character_id) {
                return res.status(400).json({ ok: false, message: 'character_id é obrigatório.' });
            }
            const character = getCharacter(character_id);
            if (!character) {
                return res.status(404).json({ ok: false, message: 'Personagem não encontrado.' });
            }
            const persona = getPersona();
            const convTitle = title || `Chat com ${character.name}`;
            const convId = createConversation(character_id, persona?.name || null, convTitle);

            if (character.first_message) {
                const userName = persona?.name || 'você';
                const firstMsg = character.first_message.replace(/\{\{user\}\}/gi, userName);
                addMessage(convId, 'assistant', firstMsg, 0);
            }

            res.json({ ok: true, id: convId });
        } catch (err) {
            res.status(500).json({ ok: false, message: err.message });
        }
    });

    app.get("/api/conversations/:id", (req, res) => {
        try {
            const conv = getConversation(req.params.id);
            if (!conv) {
                return res.status(404).json({ ok: false, message: 'Conversa não encontrada.' });
            }
            res.json({ ok: true, conversation: conv });
        } catch (err) {
            res.status(500).json({ ok: false, message: err.message });
        }
    });

    app.get("/api/conversations/:id/messages", (req, res) => {
        try {
            const messages = getConversationMessages(req.params.id);
            res.json({ ok: true, messages });
        } catch (err) {
            res.status(500).json({ ok: false, message: err.message });
        }
    });

    // ===== CHAT — STREAMING =====
    app.post("/api/conversations/:id/messages", async (req, res) => {
        const conversationId = req.params.id;
        try {
            const { content } = req.body;
            if (!content?.trim()) {
                return res.status(400).json({ ok: false, message: 'Conteúdo da mensagem é obrigatório.' });
            }

            const conv = getConversation(conversationId);
            if (!conv) return res.status(404).json({ ok: false, message: 'Conversa não encontrada.' });

            const character = getCharacter(conv.character_id);
            if (!character) return res.status(404).json({ ok: false, message: 'Personagem não encontrado.' });

            const persona = getPersona();

            const globalConfig = getGenerationConfig('global');
            const charConfig = getGenerationConfig('character', conv.character_id);
            const config = {
                model: 'qwen3:8b',
                temperature: 0.85,
                top_p: 0.95,
                top_k: 40,
                min_p: 0.05,
                repeat_penalty: 1.1,
                repeat_last_n: 64,
                max_tokens: 512,
                context_size: 4096,
                seed: -1,
                stop: [],
                num_ctx_messages: 20,
                ...globalConfig,
                ...(charConfig?.model ? charConfig : {}),
            };

            const systemParts = [];
            systemParts.push(character.description
                ? `You are ${character.name}. ${character.description}`
                : `You are ${character.name}.`);
            if (character.personality) systemParts.push(`Personality: ${character.personality}`);
            if (character.scenario) systemParts.push(`Scenario: ${character.scenario}`);
            if (persona?.name) {
                const personaLine = `The user's name is ${persona.name}.${persona.description ? ' ' + persona.description : ''}`;
                systemParts.push(personaLine);
            }
            systemParts.push(`Respond in first person as ${character.name}. Stay in character at all times. Be engaging and immersive.`);
            const systemPrompt = systemParts.join('\n\n');

            const recentMsgs = getLastNMessages(conversationId, config.num_ctx_messages || 20);

            const ollamaMessages = [{ role: 'system', content: systemPrompt }];
            for (const msg of recentMsgs) {
                if (msg.role === 'system') continue;
                ollamaMessages.push({ role: msg.role, content: msg.content });
            }
            ollamaMessages.push({ role: 'user', content: content.trim() });

            const nextPos = recentMsgs.length > 0 ? (recentMsgs[recentMsgs.length - 1].position ?? recentMsgs.length) + 1 : 1;
            addMessage(conversationId, 'user', content.trim(), nextPos);

            res.set({
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
            });
            res.flushHeaders();

            const ollamaRes = await fetch('http://127.0.0.1:11434/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: config.model || 'qwen3:8b',
                    messages: ollamaMessages,
                    stream: true,
                    options: {
                        temperature: config.temperature,
                        top_p: config.top_p,
                        top_k: config.top_k,
                        min_p: config.min_p,
                        repeat_penalty: config.repeat_penalty,
                        repeat_last_n: config.repeat_last_n,
                        num_ctx: config.context_size,
                        num_predict: config.max_tokens,
                        seed: (config.seed !== -1 && config.seed != null) ? config.seed : undefined,
                        stop: config.stop?.length ? config.stop : undefined,
                    },
                }),
            });

            if (!ollamaRes.ok) {
                const errText = await ollamaRes.text();
                res.write(`data: ${JSON.stringify({ error: `Ollama: ${ollamaRes.status} — ${errText}` })}\n\n`);
                res.end();
                return;
            }

            let fullContent = '';
            let inThink = false;
            const reader = ollamaRes.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    if (!line.trim()) continue;
                    let parsed;
                    try { parsed = JSON.parse(line); } catch { continue; }

                    if (parsed.message?.content) {
                        let delta = parsed.message.content;

                        if (inThink) {
                            const endIdx = delta.indexOf('</think>');
                            if (endIdx !== -1) {
                                inThink = false;
                                delta = delta.slice(endIdx + 8);
                            } else {
                                continue;
                            }
                        }

                        while (delta.includes('<think>')) {
                            const startIdx = delta.indexOf('<think>');
                            const before = delta.slice(0, startIdx);
                            if (before) {
                                fullContent += before;
                                res.write(`data: ${JSON.stringify({ delta: before, done: false })}\n\n`);
                            }
                            const endIdx = delta.indexOf('</think>', startIdx);
                            if (endIdx !== -1) {
                                delta = delta.slice(endIdx + 8);
                            } else {
                                inThink = true;
                                delta = '';
                            }
                        }

                        if (delta) {
                            fullContent += delta;
                            res.write(`data: ${JSON.stringify({ delta, done: false })}\n\n`);
                        }
                    }

                    if (parsed.done) {
                        const asstMsgId = fullContent ? addMessage(conversationId, 'assistant', fullContent, nextPos + 1) : null;
                        res.write(`data: ${JSON.stringify({ delta: '', done: true, message_id: asstMsgId })}\n\n`);
                        res.end();
                        return;
                    }
                }
            }

            if (fullContent) {
                const asstMsgId = addMessage(conversationId, 'assistant', fullContent, nextPos + 1);
                res.write(`data: ${JSON.stringify({ delta: '', done: true, message_id: asstMsgId })}\n\n`);
            }
            res.end();

        } catch (err) {
            console.error('Chat error:', err);
            if (!res.headersSent) {
                res.status(500).json({ ok: false, message: err.message });
            } else {
                try {
                    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
                    res.end();
                } catch { /* ignore */ }
            }
        }
    });

    app.use(express.static(publicPath));

    const server = app.listen(port, () => {
        const url = `http://localhost:${port}`;
        console.log(`Web server listening on ${url}`);
        try
        {
            const opener = spawn("xdg-open", [url], { detached: true, stdio: "ignore" });
            opener.unref();
        }
        catch (e)
        {
            console.warn("Falha ao abrir o navegador automaticamente:", e.message);
        }
    });

    registerWebServer(server);
    return { app, server };
}
