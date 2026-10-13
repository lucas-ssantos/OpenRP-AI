import {
    getAllLorebooks, getCharacter, getConversation, getEnabledAutoMessageConversations,
    getLastNMessages, getMemories, getPersona, getDailyMoodForCharacter, updateMessage, deleteMessage,
    setAutoMessages,
} from "../../services/database/queries.js";
import { buildPromptMessages } from "../promptBuilder.js";
import { getEffectiveAffection } from "../affection.js";
import { getMemoriesForPrompt, getPersonaFactsForPrompt } from "../memory/index.js";
import { logConversationTurn } from "../logger.js";
import {
    dynamicMaxTokens, resolveConfig, resolveThinkingTrigger, streamOllama, trimToLastSentence,
} from "./helpers.js";
import { beginGeneration, isGenerating } from "./generationManager.js";

const timers = new Map();

function chooseNextMessageTime() {
    const delayMinutes = 60 + Math.random() * 120;
    return new Date(Date.now() + delayMinutes * 60_000).toISOString();
}

function clearTimer(conversationId) {
    const timer = timers.get(conversationId);
    if (timer) clearTimeout(timer);
    timers.delete(conversationId);
}

function armTimer(conversationId, nextAt) {
    clearTimer(conversationId);
    const delay = Math.max(0, Date.parse(nextAt) - Date.now());
    const timer = setTimeout(() => runScheduledMessage(conversationId, nextAt), delay);
    timer.unref?.();
    timers.set(conversationId, timer);
}

function persistAndSchedule(conversationId, enabled, nextAt = null, ignoredCount = null) {
    setAutoMessages(conversationId, enabled, nextAt, ignoredCount);
    if (enabled && nextAt) armTimer(conversationId, nextAt);
    else clearTimer(conversationId);
}

export function configureAutoMessages(conversationId, enabled) {
    const nextAt = enabled ? chooseNextMessageTime() : null;
    persistAndSchedule(conversationId, enabled, nextAt, enabled ? 0 : 0);
    return nextAt;
}

export function resetAutoMessageTimer(conversationId) {
    const conversation = getConversation(conversationId);
    if (!conversation?.auto_messages_enabled) return;
    persistAndSchedule(conversationId, true, chooseNextMessageTime(), 0);
}

export function initializeAutoMessages() {
    for (const conversation of getEnabledAutoMessageConversations()) {
        const nextAt = conversation.next_at && Number.isFinite(Date.parse(conversation.next_at))
            ? conversation.next_at
            : chooseNextMessageTime();
        persistAndSchedule(conversation.id, true, nextAt, Number(conversation.ignored_count ?? 0));
    }
}

async function generateAutomaticMessage(conversationId) {
    const conversation = getConversation(conversationId);
    if (!conversation?.auto_messages_enabled) return false;

    const character = getCharacter(conversation.character_id);
    if (!character) throw new Error(`Personagem não encontrado para conversa ${conversationId}.`);

    const persona = getPersona();
    const config = resolveConfig(conversationId);
    const historyMessages = getLastNMessages(conversationId, config.num_ctx_messages || 20);
    const memories = getMemoriesForPrompt(conversationId, {
        userMessage: "",
        recentMessages: historyMessages,
    });
    const personaFacts = getPersonaFactsForPrompt();
    const lorebooks = getAllLorebooks(conversation.character_id);
    const dailyMood = getDailyMoodForCharacter(conversation.character_id);
    const affection = getEffectiveAffection(character);
    const ignoredAutoMessages = Number(conversation.auto_message_ignored_count ?? 0);
    const thinkingTrigger = resolveThinkingTrigger({
        mode: config.think_mode,
        memories,
    });
    const genConfig = { ...config, think: thinkingTrigger !== null };
    const messages = buildPromptMessages({
        character,
        persona,
        conversation,
        historyMessages,
        memories,
        personaFacts,
        lorebooks,
        affection,
        dailyMood,
        thinkingEnabled: genConfig.think,
        proactiveMessage: true,
        previousMessageWasAutomated: historyMessages.at(-1)?.automated === true,
        ignoredAutoMessages,
    });
    const gen = beginGeneration(conversationId);
    if (!gen) return false;

    let turnSaved = false;
    const startedAt = Date.now();
    await streamOllama(
        conversationId,
        gen,
        messages,
        { ...genConfig, max_tokens: dynamicMaxTokens("", genConfig) },
        async (fullContent, rawContent, rawThinking, messageId) => {
            const savedContent = trimToLastSentence(fullContent, config.max_response_chars);
            turnSaved = !!savedContent;
            if (messageId) {
                if (savedContent) updateMessage(messageId, savedContent);
                else deleteMessage(messageId);
            }
            logConversationTurn({
                conversationId,
                character,
                model: genConfig.model,
                messages,
                rawResponse: rawContent,
                filteredResponse: fullContent,
                thinking: rawThinking,
                thinkingTrigger,
                prepMs: 0,
                generationMs: Date.now() - startedAt,
                allMemories: getMemories(conversationId),
                allLorebooks: lorebooks,
                isProactiveMessage: true,
            });
            return { message_id: messageId };
        },
        { automated: true },
    );

    if (!turnSaved) {
        console.warn(
            `Automatic message generation produced no saved response for conversation ${conversationId}.`,
            gen.error || ""
        );
    }
    return turnSaved;
}

async function runScheduledMessage(conversationId, scheduledAt) {
    timers.delete(conversationId);
    const conversation = getConversation(conversationId);
    if (!conversation?.auto_messages_enabled || conversation.auto_message_next_at !== scheduledAt) return;

    const nextIgnoredCount = (conversation.auto_message_ignored_count ?? 0) + 1;
    const nextAt = chooseNextMessageTime();
    setAutoMessages(conversationId, true, nextAt, nextIgnoredCount);

    try {
        if (isGenerating(conversationId)) {
            console.warn(`Skipping automatic message for conversation ${conversationId}: another generation is active.`);
        } else {
            await generateAutomaticMessage(conversationId);
        }
    } catch (err) {
        console.error(`Automatic message generation failed for conversation ${conversationId}:`, err);
    } finally {
        const latest = getConversation(conversationId);
        if (latest?.auto_messages_enabled && latest.auto_message_next_at === nextAt) {
            armTimer(conversationId, nextAt);
        }
    }
}
