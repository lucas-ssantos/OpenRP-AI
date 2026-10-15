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

const PROXIMITY_CUES = [
    /\b(?:cuddling|cuddle|resting together|lying together|lie beside|beside you|next to you|in bed together|on the couch together|same room|same house|in the same house|at home together|curled up|in your arms|in my arms)\b/i,
    /\b(?:abraçad\w*|deitad\w* junt\w*|descansando junt\w*|dormindo junt\w*|aninhad\w*|lado a lado|na mesma casa|no mesmo ambiente|no mesmo cômodo|no mesmo quarto|no sofá junt\w*|na cama junt\w*|encostad\w* em você)\b/i,
];

const SEPARATION_CUES = [
    /\b(?:went to work|going to work|getting ready for work|leaving for work|at work|left for work|headed to work|left the house|went out|on my way to work|at the office|miles away|long-distance|i'?m going|i have to go|i should go|i'?m leaving|i need to leave|heading out|leaving now)\b/i,
    /\b(?:fui trabalhar|vou trabalhar|vou pro trabalho|vou para o trabalho|indo pro trabalho|indo para o trabalho|indo trabalhar|cheguei no trabalho|estou no trabalho|saí de casa|saiu de casa|indo embora|estou indo|tô indo|tenho que ir|preciso ir|vou indo|estou saindo|tô saindo|preciso sair|estou longe|em outra cidade)\b/i,
];

function applyProximityCues(text, state) {
    let latestCue = null;
    for (const cue of [...PROXIMITY_CUES, ...SEPARATION_CUES]) {
        const match = cue.exec(text);
        if (match && (!latestCue || match.index > latestCue.index)) {
            latestCue = {
                index: match.index,
                together: PROXIMITY_CUES.includes(cue),
            };
        }
    }
    return latestCue ? latestCue.together : state;
}

function areTogetherOrNearby(conversationId) {
    const recentMessages = getLastNMessages(conversationId, 8);
    let state = applyProximityCues(getConversation(conversationId)?.scenario ?? "", false);

    for (const message of recentMessages) {
        state = applyProximityCues(message.content, state);
    }
    return state;
}

function chooseNextMessageTime(conversationId) {
    const nearby = areTogetherOrNearby(conversationId);
    const delayMinutes = nearby
        ? 30 + Math.random() * 30
        : 60 + Math.random() * 120;
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
    const nextAt = enabled ? chooseNextMessageTime(conversationId) : null;
    persistAndSchedule(conversationId, enabled, nextAt, enabled ? 0 : 0);
    return nextAt;
}

export function resetAutoMessageTimer(conversationId) {
    const conversation = getConversation(conversationId);
    if (!conversation?.auto_messages_enabled) return;
    persistAndSchedule(conversationId, true, chooseNextMessageTime(conversationId), 0);
}

export function initializeAutoMessages() {
    for (const conversation of getEnabledAutoMessageConversations()) {
        const nextAt = conversation.next_at && Number.isFinite(Date.parse(conversation.next_at))
            ? conversation.next_at
            : chooseNextMessageTime(conversation.id);
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
    const personaFacts = getPersonaFactsForPrompt(conversation.character_id);
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
    const nextAt = chooseNextMessageTime(conversationId);
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
            const refreshedNextAt = chooseNextMessageTime(conversationId);
            setAutoMessages(conversationId, true, refreshedNextAt, latest.auto_message_ignored_count);
            armTimer(conversationId, refreshedNextAt);
        }
    }
}
