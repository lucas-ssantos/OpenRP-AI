import {
    getMemoryBacklog, getLastMemoryPosition, setLastMemoryPosition,
} from "../../services/database/queries.js";
import { extractAndSaveMemories } from "./extraction.js";

const MIN_MEMORY_BACKLOG = 10;
const RECENT_MESSAGES_TO_KEEP = 10;

// Conversas com extração em andamento — evita processar o mesmo backlog duas
// vezes quando turnos chegam em sequência rápida.
const processing = new Set();

/**
 * Extrai todas as mensagens pendentes que já ficaram para trás das 10 mais
 * recentes, quando há pelo menos 10 mensagens elegíveis.
 *
 * Usa conversations.last_memory_position como cursor — nunca pula janelas
 * (mesmo após edit/rollback) e falha do llama-server vira retry natural no próximo
 * turno, porque o cursor só avança quando a extração conclui com sucesso.
 *
 * @param {string}   conversationId
 * @param {object}   opts
 * @param {object}   opts.character
 * @param {object}   opts.persona
 * @param {object}   opts.config   - config resolvida ({ model, ... })
 * @param {function} [opts.onStart] - chamado imediatamente antes da extração (ex.: notificar via SSE)
 * @returns {Promise<{auto: number, pinned: number} | null>} null se nada era devido ou a extração falhou
 */
export async function processMemoryBacklogIfDue(conversationId, { character, persona, config, onStart } = {}) {
    if (processing.has(conversationId)) return null;

    const lastProcessed = getLastMemoryPosition(conversationId);
    const batch = getMemoryBacklog(
        conversationId,
        lastProcessed,
        RECENT_MESSAGES_TO_KEEP
    );

    if (batch.length < MIN_MEMORY_BACKLOG) return null;

    processing.add(conversationId);
    try {
        onStart?.();
        const result = await extractAndSaveMemories(conversationId, batch, { character, persona, config });
        if (result === null) return null;

        setLastMemoryPosition(conversationId, Math.max(...batch.map(m => m.position ?? 0)));
        return { auto: result.auto.length, pinned: result.pinned.length };
    } finally {
        processing.delete(conversationId);
    }
}
