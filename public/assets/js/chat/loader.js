import { conversationId, state, dom } from './state.js';
import { showError, setInputEnabled, scrollToBottom, updateLastCharRow, updateAffectionBadge, renderScenarioBubble } from './ui.js';
import { addBubble, initInputListeners } from './events.js';

// Substitui {{user}}/{{char}} pelo nome da persona e do personagem para exibição.
function expandPlaceholders(text, charName, userName) {
  if (!text) return text;
  return text
    .replace(/\{\{char\}\}/gi, charName || '')
    .replace(/\{\{user\}\}/gi, userName || 'você');
}

export async function init() {
  if (!conversationId) {
    dom.charNameEl.textContent = 'Conversa não encontrada';
    showError('URL inválida — nenhuma conversa especificada.');
    return;
  }

  try {
    // 1) A conversa traz o personagem + cenário + mensagem inicial dela.
    const convRes  = await fetch(`/api/conversations/${conversationId}`);
    const convData = await convRes.json();
    if (!convData.ok) throw new Error(convData.message);
    const conversation = convData.conversation;
    state.conversationId = conversation.id;
    state.characterId    = conversation.character_id;
    if (convData.affection) updateAffectionBadge(convData.affection);

    // 2) Dados do personagem + persona (para expandir {{char}}/{{user}} na exibição).
    const [charRes, personaRes] = await Promise.all([
      fetch(`/api/characters/${state.characterId}`),
      fetch('/api/persona'),
    ]);
    const charData = await charRes.json();
    if (!charData.ok) throw new Error(charData.message);
    const character = charData.character;
    const personaData = personaRes.ok ? await personaRes.json() : null;
    const userName = personaData?.persona?.name || 'você';

    const scenarioText = expandPlaceholders(conversation.scenario || conversation.title || '', character.name, userName);
    state.scenarioText = scenarioText;

    document.title = `${character.name} — OpenRP AI`;
    dom.charNameEl.textContent = character.name;
    if (scenarioText) dom.scenarioEl.textContent = scenarioText;
    renderScenarioBubble(scenarioText);

    // Background: sorteia uma imagem da galeria do personagem a cada visita.
    // O avatar do header/nav continua fixo no avatar principal (avatar_url).
    const galleryUrls = (character.images || []).map((img) => img.url);
    if (!galleryUrls.length && character.avatar_url) galleryUrls.push(character.avatar_url);
    if (galleryUrls.length) {
      const bgUrl = galleryUrls[Math.floor(Math.random() * galleryUrls.length)];
      dom.bg.style.backgroundImage = `url('${bgUrl}')`;
    }
    if (character.avatar_url) {
      dom.headerAvt.src = character.avatar_url;
      dom.headerAvt.style.display = 'block';
    }

    const editBtn = document.getElementById('edit-char-btn');
    if (editBtn) editBtn.href = `/character/${state.characterId}/edit`;

    const backBtn = document.getElementById('back-btn');
    if (backBtn) backBtn.href = `/character/${state.characterId}`;
    const newChatBtn = document.getElementById('nav-new-chat');
    if (newChatBtn) newChatBtn.href = `/character/${state.characterId}`;

    document.getElementById('nav-char-name').textContent = character.name;
    if (scenarioText) {
      document.getElementById('nav-char-scenario').textContent = scenarioText;
    }
    if (character.avatar_url) {
      const navAvatar = document.getElementById('nav-avatar');
      navAvatar.src = character.avatar_url;
      navAvatar.style.display = 'block';
      document.getElementById('nav-avatar-placeholder').style.display = 'none';
    }

    populateRecentChars();

    const msgsRes  = await fetch(`/api/conversations/${state.conversationId}/messages`);
    const msgsData = await msgsRes.json();
    if (msgsData.ok) {
      let isFirstMessage = true;
      for (const msg of msgsData.messages) {
        if (msg.role === 'system') continue;
        addBubble(msg.role, msg.content, msg.id, isFirstMessage);
        isFirstMessage = false;
      }
      updateLastCharRow();
    }

    setInputEnabled(true);
    dom.inputEl.focus();
    scrollToBottom();
    initInputListeners();
  } catch (err) {
    dom.charNameEl.textContent = 'Erro';
    showError(`Falha ao carregar: ${err.message}`);
  }
}

export function initImmersiveMode() {
  const btn  = document.getElementById('immersive-btn');
  const icon = btn.querySelector('i');
  btn.addEventListener('click', () => {
    const on = document.body.classList.toggle('immersive');
    icon.className = on ? 'bi bi-eye-slash' : 'bi bi-eye';
    btn.title = on ? 'Mostrar chat' : 'Ocultar chat';
  });
}
