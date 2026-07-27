const characterId = window.location.pathname.split('/')[2];

function escHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Substitui {{user}}/{{char}} pelo nome da persona e do personagem para exibição.
function expandPlaceholders(text, charName, userName) {
  if (!text) return text;
  return text
    .replace(/\{\{char\}\}/gi, charName || '')
    .replace(/\{\{user\}\}/gi, userName || 'você');
}

let userName = 'você';
let charName = '';

function formatDate(value) {
  if (!value) return '';
  const d = new Date(value.includes('T') ? value : value.replace(' ', 'T'));
  if (isNaN(d)) return value;
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

async function loadCharacter() {
  const [res, personaRes] = await Promise.all([
    fetch(`/api/characters/${characterId}`),
    fetch('/api/persona'),
  ]);
  if (!res.ok) throw new Error('Personagem não encontrado.');
  const { character } = await res.json();
  const personaData = personaRes.ok ? await personaRes.json() : null;
  userName = personaData?.persona?.name || 'você';
  charName = character.name;

  document.title = `${character.name} — OpenRP AI`;
  document.getElementById('char-name').textContent = character.name;
  document.getElementById('char-desc').textContent =
    expandPlaceholders(character.personality, character.name, userName) || 'Sem descrição.';

  if (character.avatar_url) {
    const avatar = document.getElementById('char-avatar');
    avatar.src = character.avatar_url;
    avatar.style.display = 'block';
    document.getElementById('char-avatar-placeholder').style.display = 'none';
  }
}

async function loadConversations() {
  const list = document.getElementById('conv-list');
  const res = await fetch(`/api/characters/${characterId}/conversations`);
  const data = await res.json();
  if (!res.ok || !data.ok) throw new Error(data.message || 'Falha ao carregar conversas.');

  if (!data.conversations.length) {
    list.innerHTML = `
      <div class="glass-card card p-4 text-center">
        <i class="bi bi-chat-square-dots fs-1 opacity-25 mb-2"></i>
        <p class="text-secondary mb-0">Nenhuma conversa ainda. Crie uma nova para começar o roleplay com este personagem.</p>
      </div>`;
    return;
  }

  list.innerHTML = data.conversations.map(conv => {
    const title    = expandPlaceholders(conv.title, charName, userName);
    const scenario = expandPlaceholders(conv.scenario, charName, userName);
    return `
    <a class="conv-item" href="/chat/${conv.id}">
      <div style="min-width:0;">
        <div class="conv-title">${escHtml(title) || 'Conversa sem título'}</div>
        ${scenario ? `<div class="conv-scenario">${escHtml(scenario)}</div>` : ''}
        <div class="conv-meta">${conv.message_count} mensagem(ns) · ${formatDate(conv.last_activity)}</div>
      </div>
      <i class="bi bi-chevron-right conv-arrow"></i>
    </a>
  `;
  }).join('');
}

async function loadModels() {
  const select = document.getElementById('conv-model');
  try {
    const res = await fetch('/api/models');
    const data = await res.json();
    if (!res.ok || !data.ok || !data.models?.length) return;
    const opts = data.models.map(m => `<option value="${escHtml(m.name)}">${escHtml(m.name)}</option>`).join('');
    select.insertAdjacentHTML('beforeend', opts);
  } catch { /* Ollama indisponível — fica só o padrão */ }
}

function initNewConvForm() {
  const form = document.getElementById('new-conv-form');
  const errEl = document.getElementById('conv-error');

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    errEl.style.display = 'none';

    const title        = document.getElementById('conv-title').value.trim();
    const scenario     = document.getElementById('conv-scenario').value.trim();
    const firstMessage = document.getElementById('conv-first-message').value.trim();
    const model        = document.getElementById('conv-model').value;

    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.disabled = true;

    try {
      const res = await fetch('/api/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ character_id: characterId, title, scenario, first_message: firstMessage, model }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.message || 'Falha ao criar conversa.');

      window.location.href = `/chat/${data.id}`;
    } catch (err) {
      errEl.textContent = err.message || 'Erro ao criar conversa.';
      errEl.style.display = 'block';
      submitBtn.disabled = false;
    }
  });
}

window.addEventListener('load', async () => {
  await loadSidebar();
  initNewConvForm();
  loadModels();
  try {
    await loadCharacter();
    await loadConversations();
  } catch (err) {
    document.getElementById('conv-list').innerHTML =
      `<p class="text-danger small"><i class="bi bi-exclamation-triangle me-1"></i>${escHtml(err.message)}</p>`;
  }
});
