import express from "express";
import path from "path";
import { spawn } from "child_process";
import { registerWebServer } from "../core/shutdown.js";
import { getDB } from "./database/db.js";
import { getAllCharacters, getPersona, savePersona } from "./database/queries.js";

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

    app.use(express.json());

    //
    //  CHAMADAS DE PÁGINA
    //
    app.get("/check", (_req, res) => {
        res.sendFile(path.join(publicPath, "check.html"));
    });

    app.get("/persona", (_req, res) => {
        res.sendFile(path.join(publicPath, "persona.html"));
    });

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
