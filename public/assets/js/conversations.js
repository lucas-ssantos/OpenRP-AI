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
    <div class="conv-item" data-id="${escHtml(conv.id)}">
      <div class="conv-main">
        <div class="conv-title">${escHtml(title) || 'Conversa sem título'}</div>
        ${scenario ? `<div class="conv-scenario">${escHtml(scenario)}</div>` : ''}
        <div class="conv-meta">${conv.message_count} mensagem(ns) · ${formatDate(conv.last_activity)}</div>
      </div>
      <div class="conv-actions">
        <button type="button" class="btn-edit-char btn-edit-conv" title="Editar conversa" data-id="${escHtml(conv.id)}">
          <i class="bi bi-pencil"></i>
        </button>
        <button type="button" class="btn-delete-char btn-delete-conv" title="Apagar conversa" data-id="${escHtml(conv.id)}">
          <i class="bi bi-trash3"></i>
        </button>
      </div>
      <i class="bi bi-chevron-right conv-arrow"></i>
    </div>
  `;
  }).join('');

  list.querySelectorAll('.conv-main').forEach((el) => {
    el.addEventListener('click', () => {
      window.location.href = `/chat/${el.closest('.conv-item').dataset.id}`;
    });
  });
  list.querySelectorAll('.conv-arrow').forEach((el) => {
    el.addEventListener('click', () => {
      window.location.href = `/chat/${el.closest('.conv-item').dataset.id}`;
    });
  });
  list.querySelectorAll('.btn-edit-conv').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      openEditConv(el.dataset.id);
    });
  });
  list.querySelectorAll('.btn-delete-conv').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const item  = el.closest('.conv-item');
      const title = item.querySelector('.conv-title').textContent;
      openDeleteConvFlow(el.dataset.id, title);
    });
  });
}

async function loadModels() {
  try {
    const res = await fetch('/api/models');
    const data = await res.json();
    if (!res.ok || !data.ok || !data.models?.length) return;
    const opts = data.models.map(m => `<option value="${escHtml(m.name)}">${escHtml(m.name)}</option>`).join('');
    document.getElementById('conv-model').insertAdjacentHTML('beforeend', opts);
    document.getElementById('conv-edit-model').insertAdjacentHTML('beforeend', opts);
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

// ── Editar conversa ───────────────────────────────────────────────────

let editConvModal;
let editingConvId = null;

async function openEditConv(conversationId) {
  const errEl = document.getElementById('conv-edit-error');
  errEl.style.display = 'none';
  try {
    const [convRes, modelRes] = await Promise.all([
      fetch(`/api/conversations/${conversationId}`),
      fetch(`/api/conversations/${conversationId}/model`),
    ]);
    const convData  = await convRes.json();
    const modelData = await modelRes.json();
    if (!convRes.ok || !convData.ok) throw new Error(convData.message || 'Falha ao carregar conversa.');

    editingConvId = conversationId;
    document.getElementById('conv-edit-title').value         = convData.conversation.title || '';
    document.getElementById('conv-edit-scenario').value      = convData.conversation.scenario || '';
    document.getElementById('conv-edit-first-message').value = convData.conversation.first_message || '';
    document.getElementById('conv-edit-model').value         = (modelRes.ok && modelData.ok && modelData.model) || '';

    editConvModal.show();
  } catch (err) {
    showPageError(err.message || 'Erro ao carregar conversa.');
  }
}

function initEditConvForm() {
  editConvModal = new bootstrap.Modal(document.getElementById('editConvModal'));
  const form  = document.getElementById('edit-conv-form');
  const errEl = document.getElementById('conv-edit-error');

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    errEl.style.display = 'none';
    if (!editingConvId) return;

    const title        = document.getElementById('conv-edit-title').value.trim();
    const scenario     = document.getElementById('conv-edit-scenario').value.trim();
    const firstMessage = document.getElementById('conv-edit-first-message').value.trim();
    const model        = document.getElementById('conv-edit-model').value;

    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.disabled = true;

    try {
      const res = await fetch(`/api/conversations/${editingConvId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, scenario, first_message: firstMessage, model }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.message || 'Falha ao salvar conversa.');

      editConvModal.hide();
      editingConvId = null;
      await loadConversations();
    } catch (err) {
      errEl.textContent = err.message || 'Erro ao salvar conversa.';
      errEl.style.display = 'block';
    } finally {
      submitBtn.disabled = false;
    }
  });
}

// ── Apagar conversa (duplo aviso) ───────────────────────────────────────

let deleteConvStep1Modal, deleteConvStep2Modal;
let deletingConvId = null;

function initDeleteConvModals() {
  deleteConvStep1Modal = new bootstrap.Modal(document.getElementById('deleteConvStep1Modal'));
  deleteConvStep2Modal = new bootstrap.Modal(document.getElementById('deleteConvStep2Modal'));

  document.getElementById('delete-conv-step1-confirm').addEventListener('click', () => {
    deleteConvStep1Modal.hide();
    deleteConvStep2Modal.show();
  });

  document.getElementById('delete-conv-step2-confirm').addEventListener('click', async () => {
    deleteConvStep2Modal.hide();
    if (!deletingConvId) return;
    try {
      const res  = await fetch(`/api/conversations/${deletingConvId}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.message || 'Falha ao apagar conversa.');
      deletingConvId = null;
      await loadConversations();
    } catch (err) {
      showPageError(err.message || 'Erro ao apagar conversa.');
    }
  });
}

function openDeleteConvFlow(conversationId, title) {
  deletingConvId = conversationId;
  document.getElementById('delete-conv-step2-target').textContent = title || 'esta conversa';
  document.getElementById('page-error').style.display = 'none';
  deleteConvStep1Modal.show();
}

function showPageError(text) {
  const el = document.getElementById('page-error');
  el.textContent = text;
  el.style.display = 'block';
}

window.addEventListener('load', async () => {
  await loadSidebar();
  initNewConvForm();
  initEditConvForm();
  initDeleteConvModals();
  loadModels();
  try {
    await loadCharacter();
    await loadConversations();
  } catch (err) {
    document.getElementById('conv-list').innerHTML =
      `<p class="text-danger small"><i class="bi bi-exclamation-triangle me-1"></i>${escHtml(err.message)}</p>`;
  }
});
