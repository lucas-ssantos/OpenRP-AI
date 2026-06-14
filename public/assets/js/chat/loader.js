import { characterId, state, dom } from './state.js';
import { showError, setInputEnabled, scrollToBottom, updateLastCharRow } from './ui.js';
import { addBubble, initInputListeners } from './events.js';

export async function init() {
  if (!characterId) {
    dom.charNameEl.textContent = 'Personagem não encontrado';
    showError('URL inválida — nenhum personagem especificado.');
    return;
  }

  try {
    const charRes  = await fetch(`/api/characters/${characterId}`);
    const charData = await charRes.json();
    if (!charData.ok) throw new Error(charData.message);
    const character = charData.character;

    document.title = `${character.name} — OpenRP AI`;
    dom.charNameEl.textContent = character.name;
    if (character.scenario) dom.scenarioEl.textContent = character.scenario;

    if (character.avatar_url) {
      dom.bg.style.backgroundImage = `url('${character.avatar_url}')`;
      dom.headerAvt.src = character.avatar_url;
      dom.headerAvt.style.display = 'block';
    }

    const editBtn = document.getElementById('edit-char-btn');
    if (editBtn) editBtn.href = `/character/${characterId}/edit`;

    document.getElementById('nav-char-name').textContent = character.name;
    if (character.scenario) {
      document.getElementById('nav-char-scenario').textContent = character.scenario;
    }
    if (character.avatar_url) {
      const navAvatar = document.getElementById('nav-avatar');
      navAvatar.src = character.avatar_url;
      navAvatar.style.display = 'block';
      document.getElementById('nav-avatar-placeholder').style.display = 'none';
    }

    populateRecentChars();

    const convRes  = await fetch(`/api/characters/${characterId}/conversation`);
    const convData = await convRes.json();
    if (!convData.ok) throw new Error(convData.message);
    state.conversationId = convData.conversation.id;

    const msgsRes  = await fetch(`/api/conversations/${state.conversationId}/messages`);
    const msgsData = await msgsRes.json();
    if (msgsData.ok) {
      for (const msg of msgsData.messages) {
        if (msg.role === 'system') continue;
        addBubble(msg.role, msg.content, msg.id);
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
