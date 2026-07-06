import {
    getMemoryBacklog, getLastMemoryPosition, setLastMemoryPosition,
} from "../../services/database/queries.js";
import { extractAndSaveMemories } from "./extraction.js";

// Conversas com extração em andamento — evita processar o mesmo backlog duas
// vezes quando turnos chegam em sequência rápida.
const processing = new Set();

/**
 * Verifica se há backlog de mensagens fora da janela de contexto ainda não
 * processadas pela extração de memórias e roda o extrator unificado sobre ele.
 *
 * Usa conversations.last_memory_position como cursor — nunca pula janelas
 * (mesmo após edit/rollback) e falha de Ollama vira retry natural no próximo
 * turno, porque o cursor só avança quando a extração conclui com sucesso.
 *
 * @param {string}   conversationId
 * @param {object}   opts
 * @param {object}   opts.character
 * @param {object}   opts.persona
 * @param {object}   opts.config   - config resolvida ({ model, num_ctx_messages, memory_interval, ... })
 * @param {function} [opts.onStart] - chamado imediatamente antes da extração (ex.: notificar via SSE)
 * @returns {Promise<{auto: number, pinned: number} | null>} null se nada era devido ou a extração falhou
 */
export async function processMemoryBacklogIfDue(conversationId, { character, persona, config, onStart } = {}) {
    if (processing.has(conversationId)) return null;

    const numCtx      = config?.num_ctx_messages || 20;
    const memInterval = Math.max(1, config?.memory_interval ?? 5);

    // Mensagens fora da janela de contexto (o que o Ollama não vai mais ver) e
    // após o cursor — direto no SQL, sem carregar a conversa inteira.
    // Cap contra backlogs longos (ex.: usuário reduziu num_ctx_messages):
    // processa os mais antigos primeiro; o resto entra nos próximos turnos.
    const lastProcessed = getLastMemoryPosition(conversationId);
    const batch = getMemoryBacklog(conversationId, numCtx, lastProcessed, memInterval * 3);

    if (batch.length < memInterval) return null;

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
