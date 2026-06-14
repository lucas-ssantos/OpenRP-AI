import express from "express";
import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { registerWebServer } from "../core/shutdown.js";
import { appConfig } from "../config.js";
import { getDB } from "./database/db.js";
import { createCharacter, getAllCharacters, getCharacter, getPersona, savePersona, getGenerationConfig, setGenerationConfig, getRecentCharactersWithConversations } from "./database/queries.js";
import chatRouter from "../core/chat.js";

async function getHealthStatus() {
    const status = {
        ollama: { ok: false, message: "Ollama não disponível" },
        database: { ok: false, message: "Banco de dados não inicializado" },
    };

    try {
        const response = await fetch(appConfig.ollama.tagsEndpoint);
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
    const uploadDir = path.join(publicPath, "assets/uploads");

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

    app.use("/api", chatRouter);

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
                avatarUrl = `/assets/uploads/${safeName}`;
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
                return res.json({ ok: true, config: { ...appConfig.defaults } });
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

    // ===== RECENT CHARACTERS =====
    app.get("/api/characters/recent", (_req, res) => {
        try {
            const characters = getRecentCharactersWithConversations(5);
            res.json({ ok: true, characters });
        } catch (err) {
            res.status(500).json({ ok: false, message: err.message });
        }
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

    app.use(express.static(publicPath));

    const server = app.listen(port, () => {
        const url = `http://localhost:${port}`;
        console.log(`Web server listening on ${url}`);
        try
        {
            //const opener = spawn("xdg-open", [url], { detached: true, stdio: "ignore" });
            //opener.unref();
        }
        catch (e)
        {
            //console.warn("Falha ao abrir o navegador automaticamente:", e.message);
        }
    });

    registerWebServer(server);
    return { app, server };
}
