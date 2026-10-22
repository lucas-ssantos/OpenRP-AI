// Registro de gerações llama.cpp em andamento, por conversa. Existe para que a
// resposta do modelo não dependa da conexão HTTP que a disparou: se o cliente
// trocar de página, fechar a aba ou a tela apagar (SSE cai), a geração continua
// rodando aqui e sendo persistida no banco por streamLlama() normalmente.
// GET /conversations/:id/generation usa este registro para "regrudar" num
// stream já em andamento quando alguém volta a olhar a conversa.
const active = new Map(); // conversationId -> { assistantMessageId, content, subscribers, controller, cancelled }

export function isGenerating(conversationId) {
    return active.has(conversationId);
}

// Retorna null se já houver uma geração ativa para a conversa — evita duas
// gerações concorrentes pisando na mesma mensagem/posição.
export function beginGeneration(conversationId) {
    if (active.has(conversationId)) return null;
    // controller é preenchido por streamLlama() assim que o AbortController
    // existe — cancelGeneration() precisa dele para interromper a chamada ao
    // llama-server de fora do próprio streamLlama.
    const gen = { assistantMessageId: null, content: "", subscribers: new Set(), controller: null, cancelled: false };
    active.set(conversationId, gen);
    return gen;
}

// Pausa/cancela a geração em andamento (botão de pause no frontend): aborta a
// chamada ao llama-server e marca `cancelled` — streamLlama() usa essa flag para
// descartar a mensagem parcial em vez de tratá-la como um stall recuperável.
// Retorna false se não havia nenhuma geração ativa para a conversa.
export function cancelGeneration(conversationId) {
    const gen = active.get(conversationId);
    if (!gen) return false;
    gen.cancelled = true;
    gen.controller?.abort();
    return true;
}

export function getGeneration(conversationId) {
    return active.get(conversationId) ?? null;
}

export function attachSubscriber(conversationId, res) {
    active.get(conversationId)?.subscribers.add(res);
}

export function detachSubscriber(conversationId, res) {
    active.get(conversationId)?.subscribers.delete(res);
}

// Envia o payload SSE para todo subscriber conectado no momento. Subscriber
// morto (write falhou) é removido silenciosamente — não derruba a geração.
export function broadcast(conversationId, payload) {
    const gen = active.get(conversationId);
    if (!gen) return;
    const line = `data: ${JSON.stringify(payload)}\n\n`;
    for (const res of gen.subscribers) {
        try { res.write(line); } catch { gen.subscribers.delete(res); }
    }
}

// Encerra a geração: opcionalmente notifica um último payload, fecha a conexão
// de todo subscriber ainda aberto e libera a conversa para uma nova geração.
export function closeGeneration(conversationId, payload = null) {
    const gen = active.get(conversationId);
    if (!gen) return;
    if (payload) broadcast(conversationId, payload);
    for (const res of gen.subscribers) {
        try { res.end(); } catch { /* já fechado */ }
    }
    active.delete(conversationId);
}
