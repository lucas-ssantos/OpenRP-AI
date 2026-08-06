const convListEl     = document.getElementById('conv-list');
const convCountEl    = document.getElementById('conv-count');
const detailEmptyEl  = document.getElementById('detail-empty');
const detailContent  = document.getElementById('detail-content');
const msgsEl         = document.getElementById('messages-container');
const memsEl         = document.getElementById('memories-container');

let currentConvId = null;
let currentMemories = { pinned: [], auto: [], manual: [] };
let activeMemType   = 'pinned';

// ── Overview ──────────────────────────────────────────────────────────────────

async function loadOverview() {
  try {
    const res  = await fetch('/api/viewdb/overview');
    const data = await res.json();
    if (!data.ok) throw new Error(data.message);
    renderConvList(data.conversations);
  } catch (err) {
    convListEl.innerHTML = `<p class="text-danger small p-3 mb-0"><i class="bi bi-exclamation-triangle me-1"></i>${err.message}</p>`;
  }
}

function renderConvList(conversations) {
  convCountEl.textContent = conversations.length;

  if (!conversations.length) {
    convListEl.innerHTML = '<p class="text-secondary small p-3 mb-0">Nenhuma conversa encontrada.</p>';
    return;
  }

  convListEl.innerHTML = conversations.map(c => {
    const initial = (c.character_name || '?')[0].toUpperCase();
    const avatar  = c.avatar_url
      ? `<img class="vdb-conv-avatar" src="${c.avatar_url}" alt="" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
         <div class="vdb-conv-placeholder" style="display:none">${initial}</div>`
      : `<div class="vdb-conv-placeholder">${initial}</div>`;
    return `
      <button class="vdb-conv-item" data-id="${c.id}">
        ${avatar}
        <div class="vdb-conv-info">
          <div class="vdb-conv-name">${escape(c.character_name || 'Personagem')}</div>
          <div class="vdb-conv-title">${escape(c.title || 'Sem título')}</div>
          <div class="vdb-conv-stats">
            <span><i class="bi bi-chat-left-dots"></i> ${c.message_count}</span>
            <span><i class="bi bi-brain"></i> ${c.memory_count}</span>
          </div>
        </div>
      </button>`;
  }).join('');

  convListEl.querySelectorAll('.vdb-conv-item').forEach(btn => {
    btn.addEventListener('click', () => selectConversation(btn.dataset.id, btn));
  });
}

// ── Detail ────────────────────────────────────────────────────────────────────

async function selectConversation(id, btn) {
  if (currentConvId === id) return;
  currentConvId = id;

  convListEl.querySelectorAll('.vdb-conv-item').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');

  detailEmptyEl.classList.add('d-none');
  detailContent.classList.remove('d-none');
  detailContent.classList.add('vdb-loading');
  msgsEl.innerHTML   = loadingSpinner();
  memsEl.innerHTML   = '';

  try {
    const res  = await fetch(`/api/viewdb/conversation/${id}`);
    const data = await res.json();
    if (!data.ok) throw new Error(data.message);

    renderCharacter(data.character, data.conversation);
    renderPersona(data.persona);
    renderMessages(data.messages);
    currentMemories = data.memories;
    renderMemoryTabs(data.memories);
    renderMemories(activeMemType);

    detailContent.classList.remove('vdb-loading');
  } catch (err) {
    msgsEl.innerHTML = `<p class="text-danger small"><i class="bi bi-exclamation-triangle me-1"></i>${err.message}</p>`;
    detailContent.classList.remove('vdb-loading');
  }
}

// ── Character ─────────────────────────────────────────────────────────────────

function renderCharacter(ch, conv) {
  const avatarEl = document.getElementById('char-avatar');
  const placeholder = document.getElementById('char-avatar-placeholder');
  if (ch.avatar_url) {
    avatarEl.src = ch.avatar_url;
    avatarEl.classList.remove('d-none');
    placeholder.classList.add('d-none');
    avatarEl.onerror = () => { avatarEl.classList.add('d-none'); placeholder.classList.remove('d-none'); };
  } else {
    avatarEl.classList.add('d-none');
    placeholder.classList.remove('d-none');
  }

  document.getElementById('char-name').textContent = ch.name;
  const link = document.getElementById('char-link');
  link.href = `/chat/${conv.id}`;

  const fields = [
    { label: 'Descrição',      value: ch.description },
    { label: 'Personalidade',  value: ch.personality },
    { label: 'Gosta de',       value: ch.likes },
    { label: 'Não gosta de',   value: ch.dislikes },
    { label: 'Cenário',        value: conv.scenario },
    { label: 'Primeira msg',   value: conv.first_message },
    { label: 'Conversa',       value: conv.title },
  ];
  document.getElementById('char-fields').innerHTML = fields
    .filter(f => f.value)
    .map(f => fieldHtml(f.label, f.value))
    .join('');
}

// ── Persona ───────────────────────────────────────────────────────────────────

function renderPersona(persona) {
  const el = document.getElementById('persona-fields');
  if (!persona) {
    el.innerHTML = '<p class="text-secondary small mb-0">Nenhuma persona configurada.</p>';
    return;
  }
  el.innerHTML = [
    { label: 'Nome',      value: persona.name },
    { label: 'Descrição', value: persona.description },
  ].filter(f => f.value).map(f => fieldHtml(f.label, f.value)).join('');
}

// ── Messages ─────────────────────────────────────────────────────────────────

function renderMessages(messages) {
  document.getElementById('msg-count').textContent = messages.length;
  if (!messages.length) {
    msgsEl.innerHTML = '<p class="text-secondary small mb-0">Sem mensagens.</p>';
    return;
  }

  msgsEl.innerHTML = messages.map(m => {
    const roleClass = m.role === 'user' ? 'vdb-role-user' : m.role === 'assistant' ? 'vdb-role-char' : 'vdb-role-sys';
    const roleLabel = m.role === 'user' ? 'usuário' : m.role === 'assistant' ? 'personagem' : 'sistema';
    return `
      <div class="vdb-message">
        <div class="vdb-msg-meta">
          <span class="vdb-role-badge ${roleClass}">${roleLabel}</span>
          <span class="vdb-msg-pos">#${m.position ?? '—'}</span>
          <span class="vdb-msg-time">${formatDate(m.created_at)}</span>
        </div>
        <div class="vdb-msg-content">${escape(m.content)}</div>
      </div>`;
  }).join('');
}

// ── Memories ─────────────────────────────────────────────────────────────────

function renderMemoryTabs(memories) {
  const total = memories.pinned.length + memories.auto.length + memories.manual.length;
  document.getElementById('mem-total').textContent   = total;
  document.getElementById('count-pinned').textContent = memories.pinned.length;
  document.getElementById('count-auto').textContent   = memories.auto.length;
  document.getElementById('count-manual').textContent = memories.manual.length;

  // Default to first non-empty tab
  const preferred = ['pinned', 'auto', 'manual'].find(t => memories[t].length > 0) || 'pinned';
  setActiveMemTab(preferred);
}

function setActiveMemTab(type) {
  activeMemType = type;
  document.querySelectorAll('.vdb-mem-tab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.type === type);
  });
  renderMemories(type);
}

function renderMemories(type) {
  const list = currentMemories[type] || [];
  if (!list.length) {
    memsEl.innerHTML = '<p class="text-secondary small mb-0 mt-3">Nenhuma memória deste tipo.</p>';
    return;
  }

  const configs = {
    pinned: { icon: 'bi-pin-fill',    cls: 'vdb-mem-pinned' },
    auto:   { icon: 'bi-cpu',         cls: 'vdb-mem-auto'   },
    manual: { icon: 'bi-pencil-fill', cls: 'vdb-mem-manual' },
  };
  const cfg = configs[type];

  memsEl.innerHTML = list.map(m => `
    <div class="vdb-memory ${cfg.cls}" data-mem-id="${m.id}" data-mem-type="${type}">
      <div class="vdb-mem-header">
        <i class="bi ${cfg.icon}"></i>
        ${m.keywords ? `<span class="vdb-mem-keywords">${escape(m.keywords)}</span>` : ''}
        ${m.relevance_weight && m.relevance_weight !== 1 ? `<span class="vdb-mem-weight">peso ${m.relevance_weight}</span>` : ''}
        <div class="vdb-mem-actions">
          <select class="vdb-type-sel" title="Mudar tipo">
            <option value="pinned"${type === 'pinned' ? ' selected' : ''}>📌 Fixada</option>
            <option value="auto"${type === 'auto' ? ' selected' : ''}>🤖 Auto</option>
            <option value="manual"${type === 'manual' ? ' selected' : ''}>✏️ Manual</option>
          </select>
          <button class="vdb-mem-btn-edit" title="Editar"><i class="bi bi-pencil"></i></button>
          <button class="vdb-mem-btn-del" title="Excluir"><i class="bi bi-trash3"></i></button>
        </div>
      </div>
      <div class="vdb-mem-view">
        <div class="vdb-mem-content">${escape(m.content)}</div>
        ${m.summary ? `<div class="vdb-mem-summary"><i class="bi bi-card-text me-1"></i>${escape(m.summary)}</div>` : ''}
        <div class="vdb-mem-date-small">${formatDate(m.created_at)}</div>
      </div>
      <div class="vdb-mem-edit-form" style="display:none;">
        <textarea class="vdb-ef-content" rows="3">${escape(m.content)}</textarea>
        <div class="vdb-ef-row">
          <input class="vdb-ef-keywords" type="text" placeholder="Keywords" value="${escape(m.keywords || '')}" />
          <input class="vdb-ef-weight" type="number" step="0.1" min="0.1" placeholder="Peso" title="Peso de relevância" value="${m.relevance_weight ?? ''}" />
        </div>
        <input class="vdb-ef-summary" type="text" placeholder="Resumo (opcional)" value="${escape(m.summary || '')}" />
        <div class="vdb-ef-actions">
          <button class="vdb-btn-cancel-edit" type="button">Cancelar</button>
          <button class="vdb-btn-save-edit" type="button">Salvar</button>
        </div>
      </div>
    </div>
  `).join('');
}

function showMemError(msg) {
  const el = document.createElement('div');
  el.className = 'vdb-mem-error';
  el.innerHTML = `<i class="bi bi-exclamation-triangle me-1"></i>${escape(msg)}`;
  memsEl.prepend(el);
  setTimeout(() => el.remove(), 3500);
}

function initMemoryActions() {
  memsEl.addEventListener('change', async e => {
    const sel = e.target.closest('.vdb-type-sel');
    if (!sel) return;
    const card    = sel.closest('.vdb-memory');
    const id      = card.dataset.memId;
    const oldType = card.dataset.memType;
    const newType = sel.value;
    if (oldType === newType) return;

    try {
      const res  = await fetch(`/api/memories/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: newType }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.message);

      const idx = currentMemories[oldType].findIndex(m => m.id === id);
      if (idx !== -1) {
        const [mem] = currentMemories[oldType].splice(idx, 1);
        mem.type     = newType;
        mem.is_pinned = newType === 'pinned';
        currentMemories[newType].push(mem);
      }
      renderMemoryTabs(currentMemories);
      renderMemories(activeMemType);
    } catch (err) {
      showMemError(err.message);
      sel.value = oldType;
    }
  });

  memsEl.addEventListener('click', async e => {
    if (e.target.closest('.vdb-mem-btn-edit')) {
      const card = e.target.closest('.vdb-memory');
      card.querySelector('.vdb-mem-view').style.display = 'none';
      card.querySelector('.vdb-mem-edit-form').style.display = 'flex';
      card.querySelector('.vdb-ef-content').focus();
      return;
    }

    if (e.target.closest('.vdb-btn-cancel-edit')) {
      const card = e.target.closest('.vdb-memory');
      card.querySelector('.vdb-mem-view').style.display = '';
      card.querySelector('.vdb-mem-edit-form').style.display = 'none';
      return;
    }

    if (e.target.closest('.vdb-btn-save-edit')) {
      const btn      = e.target.closest('.vdb-btn-save-edit');
      const card     = btn.closest('.vdb-memory');
      const id       = card.dataset.memId;
      const memType  = card.dataset.memType;
      const content    = card.querySelector('.vdb-ef-content').value.trim();
      const keywords   = card.querySelector('.vdb-ef-keywords').value.trim();
      const summary    = card.querySelector('.vdb-ef-summary').value.trim();
      const weightRaw  = card.querySelector('.vdb-ef-weight').value.trim();
      if (!content) return;

      const body = { content, keywords: keywords || null, summary: summary || null };
      if (weightRaw !== '') {
        const weight = Number(weightRaw);
        if (!Number.isFinite(weight) || weight <= 0) {
          showMemError('Peso inválido.');
          return;
        }
        body.relevance_weight = weight;
      }

      btn.disabled = true;
      try {
        const res  = await fetch(`/api/memories/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const data = await res.json();
        if (!data.ok) throw new Error(data.message);

        const mem = currentMemories[memType]?.find(m => m.id === id);
        if (mem) {
          mem.content  = content;
          mem.keywords = keywords || null;
          mem.summary  = summary || null;
          if (body.relevance_weight !== undefined) mem.relevance_weight = body.relevance_weight;
        }
        renderMemories(activeMemType);
      } catch (err) {
        showMemError(err.message);
        btn.disabled = false;
      }
      return;
    }

    const delBtn = e.target.closest('.vdb-mem-btn-del');
    if (!delBtn) return;

    if (!delBtn.classList.contains('confirm')) {
      delBtn.dataset.delOrig = delBtn.innerHTML;
      delBtn.classList.add('confirm');
      delBtn.innerHTML = '<i class="bi bi-exclamation-triangle"></i> Confirmar';
      setTimeout(() => {
        if (delBtn.classList.contains('confirm')) {
          delBtn.classList.remove('confirm');
          delBtn.innerHTML = delBtn.dataset.delOrig;
        }
      }, 3000);
      return;
    }

    const card    = delBtn.closest('.vdb-memory');
    const id      = card.dataset.memId;
    const memType = card.dataset.memType;
    try {
      const res  = await fetch(`/api/memories/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!data.ok) throw new Error(data.message);
      currentMemories[memType] = currentMemories[memType].filter(m => m.id !== id);
      renderMemoryTabs(currentMemories);
      renderMemories(activeMemType);
    } catch (err) {
      showMemError(err.message);
    }
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fieldHtml(label, value) {
  return `
    <div class="vdb-field">
      <div class="vdb-field-label">${label}</div>
      <div class="vdb-field-value">${escape(value)}</div>
    </div>`;
}

function loadingSpinner() {
  return `<div class="d-flex align-items-center gap-2 text-secondary small py-2">
    <div class="spinner-border spinner-border-sm text-info" role="status"></div>Carregando…</div>`;
}

function escape(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatDate(str) {
  if (!str) return '';
  try {
    return new Date(str).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return str;
  }
}

// ── Init ──────────────────────────────────────────────────────────────────────

document.getElementById('mem-tabs').addEventListener('click', e => {
  const btn = e.target.closest('.vdb-mem-tab');
  if (btn) setActiveMemTab(btn.dataset.type);
});

window.addEventListener('load', async () => {
  await loadSidebar();
  initMemoryActions();
  loadOverview();
});
