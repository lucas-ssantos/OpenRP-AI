import fs   from "fs";
import path from "path";
import { appConfig } from "../config.js";

const LOG_DIR = path.resolve(process.cwd(), "data/logs");

export function isDevMode() {
    const env = (appConfig.nodeEnv || "development").toLowerCase();
    return !["production", "prod"].includes(env);
}

/**
 * Grava uma entrada de log para um turno de conversa.
 * Só executa em modo dev (NODE_ENV != production).
 *
 * @param {object} opts
 * @param {string}   opts.conversationId
 * @param {object}   opts.character        - { name, ... }
 * @param {string}   opts.model            - nome do modelo Ollama usado
 * @param {object[]} opts.messages         - array completo enviado ao Ollama (system + histórico + user)
 * @param {string}   opts.rawResponse      - resposta bruta do modelo (com <think> se houver)
 * @param {string}   opts.filteredResponse - resposta após remover tokens de raciocínio
 * @param {boolean}  [opts.isRegen=false]  - true quando é uma regeneração
 */
export function logConversationTurn({
    conversationId,
    character,
    model,
    messages,
    rawResponse,
    filteredResponse,
    isRegen = false,
}) {
    if (!isDevMode()) return;

    try {
        fs.mkdirSync(LOG_DIR, { recursive: true });

        const safeName = (character?.name || "unknown")
            .toLowerCase()
            .replace(/[^a-z0-9]/g, "_")
            .replace(/_+/g, "_")
            .slice(0, 32);
        const safeId   = conversationId.replace(/-/g, "").slice(0, 8);
        const filename = `${safeName}_${safeId}.log`;
        const filepath = path.join(LOG_DIR, filename);

        const entry = buildLogEntry({
            character, model, messages,
            rawResponse, filteredResponse, isRegen,
        });

        fs.appendFileSync(filepath, entry, "utf8");
    } catch (err) {
        console.error("[logger] Erro ao salvar log de prompt:", err.message);
    }
}

// ── Formatter ─────────────────────────────────────────────────────────────────

const W = 76;
const DIVIDER = "═".repeat(W);
const SEP     = "─".repeat(W);

function section(label) {
    const dashes = "─".repeat(Math.max(0, W - label.length - 4));
    return `\n── ${label} ${dashes}`;
}

function buildLogEntry({ character, model, messages, rawResponse, filteredResponse, isRegen }) {
    const now = new Date().toLocaleString("pt-BR", {
        dateStyle: "short",
        timeStyle: "medium",
    });

    const turnType = isRegen ? "REGENERAÇÃO" : "MENSAGEM";
    const lines = [];

    lines.push(`\n${DIVIDER}`);
    lines.push(`  ${now}  |  ${turnType}  |  Personagem: ${character?.name}  |  Modelo: ${model}`);
    lines.push(DIVIDER);

    if (!messages?.length) {
        lines.push("(nenhuma mensagem registrada)");
        lines.push("");
        return lines.join("\n") + "\n";
    }

    const [systemMsg, ...restMsgs] = messages;

    // ── [1] System prompt — separado pelas seções do promptBuilder ────────────
    const systemParts = (systemMsg?.content || "").split("\n\n---\n\n");

    lines.push(section("[1] SYSTEM PROMPT — base (descrição + personalidade + persona)"));
    lines.push(systemParts[0] || "(vazio)");

    for (let i = 1; i < systemParts.length; i++) {
        const part = systemParts[i];
        if (part.startsWith("[Relevant memories]")) {
            lines.push(section("[2] MEMÓRIAS (injetadas no prompt)"));
            lines.push(part.replace(/^\[Relevant memories\]\n/, ""));
        } else if (part.startsWith("[World info]")) {
            lines.push(section("[3] LOREBOOK / WORLD INFO"));
            lines.push(part.replace(/^\[World info\]\n/, ""));
        } else {
            lines.push(section("[?] SEÇÃO EXTRA"));
            lines.push(part);
        }
    }

    // ── [4] Histórico + author's note ─────────────────────────────────────────
    // A última mensagem do restMsgs com role=user é a mensagem atual do usuário.
    // Mensagens system no meio são o author's note (jailbreak).
    const lastUserIdx = [...restMsgs].reverse().findIndex(m => m.role === "user");
    const splitAt = lastUserIdx === -1 ? restMsgs.length : restMsgs.length - 1 - lastUserIdx;

    const history     = restMsgs.slice(0, splitAt);
    const currentUser = lastUserIdx === -1 ? null : restMsgs[splitAt];

    if (history.length > 0) {
        lines.push(section("[4] HISTÓRICO DE MENSAGENS"));
        history.forEach(m => {
            const role = m.role === "user"      ? "[user]      "
                       : m.role === "assistant" ? "[assistant] "
                       :                          "[system]    ";
            lines.push(`${role}│ ${m.content.replace(/\n/g, "\n             │ ")}`);
        });
    }

    if (currentUser) {
        lines.push(section("[5] MENSAGEM ATUAL DO USUÁRIO"));
        lines.push(currentUser.content);
    }

    // ── Resposta do modelo ────────────────────────────────────────────────────
    lines.push(section("RESPOSTA BRUTA DO MODELO"));
    lines.push(rawResponse || "(sem resposta)");

    if (filteredResponse !== rawResponse) {
        lines.push(section("RESPOSTA ENVIADA AO CHAT (think removido)"));
        lines.push(filteredResponse || "(vazia após filtro)");
    }

    lines.push(`\n${SEP}\n`);

    return lines.join("\n") + "\n";
}
