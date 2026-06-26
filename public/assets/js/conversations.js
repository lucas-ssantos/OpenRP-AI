const characterId = window.location.pathname.split('/')[2];

function escHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatDate(value) {
  if (!value) return '';
  const d = new Date(value.includes('T') ? value : value.replace(' ', 'T'));
  if (isNaN(d)) return value;
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

async function loadCharacter() {
  const res = await fetch(`/api/characters/${characterId}`);
  if (!res.ok) throw new Error('Personagem não encontrado.');
  const { character } = await res.json();

  document.title = `${character.name} — OpenRP AI`;
  document.getElementById('char-name').textContent = character.name;
  document.getElementById('char-desc').textContent = character.description || 'Sem descrição.';
  document.getElementById('edit-char-btn').href = `/character/${characterId}/edit`;

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

  list.innerHTML = data.conversations.map(conv => `
    <a class="conv-item" href="/chat/${conv.id}">
      <div style="min-width:0;">
        <div class="conv-title">${escHtml(conv.title) || 'Conversa sem título'}</div>
        ${conv.scenario ? `<div class="conv-scenario">${escHtml(conv.scenario)}</div>` : ''}
        <div class="conv-meta">${conv.message_count} mensagem(ns) · ${formatDate(conv.last_activity)}</div>
      </div>
      <i class="bi bi-chevron-right conv-arrow"></i>
    </a>
  `).join('');
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
