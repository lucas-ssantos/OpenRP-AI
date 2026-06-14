import { Router } from "express";
import path from "path";
import { getDB } from "../../database/db.js";

const publicPath = path.resolve(process.cwd(), "public");

function getDatabaseTables() {
    const db = getDB();
    const result = db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name;");
    return result.length > 0 ? result[0].values.map((row) => row[0]) : [];
}

function getTableColumns(table) {
    const db = getDB();
    const result = db.exec(`PRAGMA table_info("${table}");`);
    return result.length > 0 ? result[0].values.map((row) => row[1]) : [];
}

function getTableRowCount(table) {
    const db = getDB();
    const result = db.exec(`SELECT COUNT(*) AS count FROM "${table}";`);
    return result.length > 0 ? result[0].values[0][0] : 0;
}

function getTableLastRows(table, limit = 25) {
    const db = getDB();
    const columns = getTableColumns(table);
    const orderBy = columns.includes("created_at") ? "created_at" : "rowid";
    const result = db.exec(`SELECT * FROM "${table}" ORDER BY ${orderBy} DESC LIMIT ${limit};`);
    if (result.length === 0) return { columns: [], rows: [] };
    return { columns: result[0].columns, rows: result[0].values };
}

function isValidUUID(str) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
}

const router = Router();

router.get("/api/viewdb", (_req, res) => {
    res.sendFile(path.join(publicPath, "viewdb.html"));
});

// ── Conversas com dados do personagem (visão semântica) ───────────────────────
router.get("/api/viewdb/overview", (_req, res) => {
    try {
        const db = getDB();
        const result = db.exec(`
            SELECT
                c.id, c.title, c.updated_at,
                ch.name AS character_name, ch.avatar_url,
                (SELECT COUNT(*) FROM messages m  WHERE m.conversation_id  = c.id) AS message_count,
                (SELECT COUNT(*) FROM memories mm WHERE mm.conversation_id = c.id) AS memory_count
            FROM conversations c
            LEFT JOIN characters ch ON ch.id = c.character_id
            ORDER BY c.updated_at DESC
        `);
        const conversations = result.length > 0
            ? result[0].values.map(row => ({
                id:             row[0],
                title:          row[1],
                updated_at:     row[2],
                character_name: row[3],
                avatar_url:     row[4],
                message_count:  row[5],
                memory_count:   row[6],
            }))
            : [];
        res.json({ ok: true, conversations });
    } catch (err) {
        res.status(500).json({ ok: false, message: err.message });
    }
});

// ── Detalhe completo de uma conversa ─────────────────────────────────────────
router.get("/api/viewdb/conversation/:id", (req, res) => {
    try {
        const convId = req.params.id;
        if (!isValidUUID(convId)) return res.status(400).json({ ok: false, message: "ID inválido." });

        const db = getDB();

        const convRows = db.exec(`
            SELECT c.id, c.title, c.created_at,
                   ch.id, ch.name, ch.description, ch.personality, ch.avatar_url, ch.scenario, ch.first_message
            FROM conversations c
            JOIN characters ch ON ch.id = c.character_id
            WHERE c.id = '${convId}'
        `);
        if (!convRows.length || !convRows[0].values.length)
            return res.status(404).json({ ok: false, message: "Conversa não encontrada." });

        const [conv_id, title, conv_created, char_id, char_name, description, personality, avatar_url, scenario, first_message] = convRows[0].values[0];

        const pRows = db.exec(`SELECT name, description, avatar_url FROM persona WHERE id = 'self'`);
        const persona = pRows.length && pRows[0].values.length
            ? { name: pRows[0].values[0][0], description: pRows[0].values[0][1], avatar_url: pRows[0].values[0][2] }
            : null;

        const msgRows = db.exec(`
            SELECT id, role, content, position, created_at
            FROM messages WHERE conversation_id = '${convId}'
            ORDER BY position ASC, created_at ASC
        `);
        const messages = msgRows.length
            ? msgRows[0].values.map(r => ({ id: r[0], role: r[1], content: r[2], position: r[3], created_at: r[4] }))
            : [];

        const memRows = db.exec(`
            SELECT id, type, content, summary, keywords, is_pinned, relevance_weight, created_at
            FROM memories WHERE conversation_id = '${convId}'
            ORDER BY type ASC, created_at DESC
        `);
        const allMem = memRows.length
            ? memRows[0].values.map(r => ({
                id: r[0], type: r[1], content: r[2], summary: r[3], keywords: r[4],
                is_pinned: !!r[5], relevance_weight: r[6], created_at: r[7],
            }))
            : [];

        res.json({
            ok: true,
            conversation: { id: conv_id, title, created_at: conv_created },
            character:    { id: char_id, name: char_name, description, personality, avatar_url, scenario, first_message },
            persona,
            messages,
            memories: {
                pinned: allMem.filter(m => m.type === 'pinned'),
                auto:   allMem.filter(m => m.type === 'auto'),
                manual: allMem.filter(m => m.type === 'manual'),
            },
        });
    } catch (err) {
        res.status(500).json({ ok: false, message: err.message });
    }
});

router.get("/api/viewdb/tables", (_req, res) => {
    try {
        const tables = getDatabaseTables();
        res.json({ ok: true, tables: tables.map((name) => ({ name, count: getTableRowCount(name) })) });
    } catch (err) {
        res.status(500).json({ ok: false, message: err.message });
    }
});

router.get("/api/viewdb/records", (req, res) => {
    try {
        const table = String(req.query.table || "").trim();
        if (!table) return res.status(400).json({ ok: false, message: "Tabela não informada." });

        const tables = getDatabaseTables();
        if (!tables.includes(table)) return res.status(404).json({ ok: false, message: "Tabela não encontrada." });

        const { columns, rows } = getTableLastRows(table, 25);
        res.json({ ok: true, table, total: getTableRowCount(table), columns, rows });
    } catch (err) {
        res.status(500).json({ ok: false, message: err.message });
    }
});

export default router;
