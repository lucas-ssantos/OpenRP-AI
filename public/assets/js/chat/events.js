import { state, dom } from './state.js';
import {
  scrollToBottom, renderBubbleText, updateLastCharRow,
  addTypingIndicator, removeTypingIndicator, showError, setInputEnabled,
  showPinnedMemoryToast, showChatStatus, clearChatStatus,
} from './ui.js';

// ── Rollback state ────────────────────────────────────────────────────

let rollbackModal;
let rollbackTargetId  = null;
let rollbackTargetRow = null;

// ── Edit state ────────────────────────────────────────────────────────

let editConfirmModal;
let editPendingCallback = null;

// ── Reset state ───────────────────────────────────────────────────────

let resetModal;

// ── Bubbles ───────────────────────────────────────────────────────────

export function addBubble(role, content, messageId = null) {
  const isUser = role === 'user';
  const row = document.createElement('div');
  row.className = `msg-row msg-row-${isUser ? 'user' : 'char'}`;
  row.dataset.messageId = messageId ?? '';

  const bubble = document.createElement('div');
  bubble.className = `bubble bubble-${isUser ? 'user' : 'char'}`;

  const textEl = document.createElement('span');
  textEl.className = 'bubble-text';
  renderBubbleText(textEl, content);
  bubble.appendChild(textEl);
  row.appendChild(bubble);

  const actionsEl = document.createElement('div');
  actionsEl.className = 'msg-actions';
  row.appendChild(actionsEl);

  if (!isUser) {
    const regenBtn = document.createElement('button');
    regenBtn.className = 'regenerate-btn';
    regenBtn.title = 'Regenerar resposta';
    regenBtn.innerHTML = '<i class="bi bi-arrow-clockwise"></i>';
    regenBtn.style.display = 'none';
    regenBtn.addEventListener('click', (e) => { e.stopPropagation(); regenerateLastMessage(row); });
    actionsEl.appendChild(regenBtn);
  }

  if (messageId && !isUser) attachRollbackBtn(row, messageId);
  if (messageId) attachEditBtn(row, messageId);

  dom.messagesEl.appendChild(row);
  scrollToBottom();
  return { row, textEl };
}

// ── Rollback ──────────────────────────────────────────────────────────

export function attachRollbackBtn(row, messageId) {
  const btn = document.createElement('button');
  btn.className = 'rollback-btn';
  btn.title = 'Retroceder a esta mensagem';
  btn.innerHTML = '<i class="bi bi-arrow-counterclockwise"></i>';
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    openRollbackModal(messageId, row);
  });
  (row.querySelector('.msg-actions') ?? row).appendChild(btn);
}

function openRollbackModal(messageId, rowEl) {
  rollbackTargetId  = messageId;
  rollbackTargetRow = rowEl;
  rollbackModal.show();
}

export function initRollbackModal() {
  rollbackModal = new bootstrap.Modal(document.getElementById('rollbackModal'));
  document.getElementById('rollback-confirm-btn').addEventListener('click', async () => {
    if (!rollbackTargetId || !state.conversationId) return;
    rollbackModal.hide();
    try {
      const res = await fetch(`/api/conversations/${state.conversationId}/rollback`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messageId: rollbackTargetId }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.message);

      const rows = [...dom.messagesEl.querySelectorAll('.msg-row')];
      const idx = rows.indexOf(rollbackTargetRow);
      if (idx !== -1) rows.slice(idx + 1).forEach(r => r.remove());
      updateLastCharRow();
    } catch (err) {
      showError(`Erro ao retroceder: ${err.message}`);
    } finally {
      rollbackTargetId  = null;
      rollbackTargetRow = null;
    }
  });
}

// ── Edit ──────────────────────────────────────────────────────────────

export function initEditModal() {
  editConfirmModal = new bootstrap.Modal(document.getElementById('editConfirmModal'));
  document.getElementById('edit-confirm-btn').addEventListener('click', () => {
    editConfirmModal.hide();
    if (editPendingCallback) { editPendingCallback(); editPendingCallback = null; }
  });
  document.getElementById('editConfirmModal').addEventListener('hidden.bs.modal', () => {
    editPendingCallback = null;
  });
}

function isLastRow(row) {
  const all = [...dom.messagesEl.querySelectorAll('.msg-row')];
  return all[all.length - 1] === row;
}

function enterEditMode(row, messageId) {
  if (row.querySelector('.edit-textarea')) return;
  const textEl = row.querySelector('.bubble-text');
  const bubble = row.querySelector('.bubble');
  const originalText = textEl.dataset.raw ?? textEl.textContent;

  textEl.style.display = 'none';

  const ta = document.createElement('textarea');
  ta.className = 'edit-textarea';
  ta.value = originalText;
  ta.rows = Math.max(2, (originalText.match(/\n/g) || []).length + 2);
  ta.addEventListener('input', () => {
    ta.style.height = 'auto';
    ta.style.height = ta.scrollHeight + 'px';
  });

  const actions = document.createElement('div');
  actions.className = 'edit-actions';

  const saveBtn = document.createElement('button');
  saveBtn.className = 'edit-save-btn';
  saveBtn.textContent = 'Salvar';

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'edit-cancel-btn';
  cancelBtn.textContent = 'Cancelar';

  actions.appendChild(cancelBtn);
  actions.appendChild(saveBtn);
  bubble.appendChild(ta);
  bubble.appendChild(actions);
  ta.focus();
  ta.setSelectionRange(ta.value.length, ta.value.length);

  cancelBtn.addEventListener('click', () => {
    ta.remove();
    actions.remove();
    textEl.style.display = '';
  });

  saveBtn.addEventListener('click', async () => {
    const newText = ta.value.trim();
    if (!newText) return;
    saveBtn.disabled = true;
    try {
      const res = await fetch(`/api/conversations/${state.conversationId}/messages/${messageId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: newText }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.message);
      ta.remove();
      actions.remove();
      textEl.style.display = '';
      renderBubbleText(textEl, newText);
    } catch (err) {
      showError(`Erro ao salvar: ${err.message}`);
      saveBtn.disabled = false;
    }
  });
}

export function attachEditBtn(row, messageId) {
  const btn = document.createElement('button');
  btn.className = 'edit-btn';
  btn.title = 'Editar mensagem';
  btn.innerHTML = '<i class="bi bi-pencil"></i>';
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (isLastRow(row)) {
      enterEditMode(row, messageId);
    } else {
      editPendingCallback = () => enterEditMode(row, messageId);
      editConfirmModal.show();
    }
  });
  (row.querySelector('.msg-actions') ?? row).appendChild(btn);
}

// ── Regenerate ────────────────────────────────────────────────────────

export async function regenerateLastMessage(rowEl) {
  if (state.isStreaming) return;
  state.isStreaming = true;
  setInputEnabled(false);

  const bubble = rowEl.querySelector('.bubble');
  const regenBtn = rowEl.querySelector('.regenerate-btn');
  if (regenBtn) regenBtn.disabled = true;
  rowEl.querySelector('.rollback-btn')?.remove();

  bubble.innerHTML = '<span class="dot"></span><span class="dot"></span><span class="dot"></span>';
  bubble.classList.add('typing-bubble');

  let newContent = '';
  let newTextEl  = null;

  try {
    const res = await fetch(`/api/conversations/${state.conversationId}/regenerate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.message || 'Erro ao regenerar.');
    }

    const reader  = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const raw = line.slice(6).trim();
        if (!raw) continue;
        let data;
        try { data = JSON.parse(raw); } catch { continue; }

        if (data.error) throw new Error(data.error);

        if (data.delta) {
          if (!newTextEl) {
            bubble.classList.remove('typing-bubble');
            bubble.innerHTML = '';
            newTextEl = document.createElement('span');
            newTextEl.className = 'bubble-text';
            bubble.appendChild(newTextEl);
          }
          newContent += data.delta;
          renderBubbleText(newTextEl, newContent);
          scrollToBottom();
        }

        if (data.done && data.message_id) {
          attachRollbackBtn(rowEl, data.message_id);
          rowEl.dataset.messageId = data.message_id;
        }
      }
    }
  } catch (err) {
    bubble.classList.remove('typing-bubble');
    bubble.innerHTML = '<span class="bubble-text" style="color:#fca5a5;">Erro ao regenerar. Tente novamente.</span>';
    showError(`Erro ao regenerar: ${err.message}`);
  } finally {
    if (regenBtn) regenBtn.disabled = false;
    state.isStreaming = false;
    setInputEnabled(true);
    dom.inputEl.focus();
    scrollToBottom();
  }
}

// ── Reset ─────────────────────────────────────────────────────────────

export function initResetModal() {
  resetModal = new bootstrap.Modal(document.getElementById('resetModal'));

  document.getElementById('nav-reset-chat').addEventListener('click', (e) => {
    e.preventDefault();
    const offcanvas = bootstrap.Offcanvas.getInstance(document.getElementById('chatNav'));
    if (offcanvas) {
      offcanvas.hide();
      document.getElementById('chatNav').addEventListener('hidden.bs.offcanvas', () => {
        resetModal.show();
      }, { once: true });
    } else {
      resetModal.show();
    }
  });

  document.getElementById('reset-confirm-btn').addEventListener('click', async () => {
    if (!state.conversationId) return;
    resetModal.hide();
    try {
      const res  = await fetch(`/api/conversations/${state.conversationId}/reset`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.message);

      dom.messagesEl.innerHTML = '';

      if (data.first_message) {
        addBubble('assistant', data.first_message.content, data.first_message.id);
      }

      updateLastCharRow();
    } catch (err) {
      showError(`Erro ao reiniciar conversa: ${err.message}`);
    }
  });
}

// ── Auto-resize ───────────────────────────────────────────────────────

export function autoResize() {
  dom.inputEl.style.height = 'auto';
  dom.inputEl.style.height = Math.min(dom.inputEl.scrollHeight, 130) + 'px';
}

// ── Send ──────────────────────────────────────────────────────────────

export async function sendMessage() {
  if (state.isStreaming || !state.conversationId) return;
  const content = dom.inputEl.value.trim();
  if (!content) return;

  dom.inputEl.value = '';
  autoResize();
  const { row: userRow } = addBubble('user', content);
  addTypingIndicator();

  state.isStreaming = true;
  setInputEnabled(false);

  let charRow     = null;
  let charText    = null;
  let charRawText = '';

  try {
    const res = await fetch(`/api/conversations/${state.conversationId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.message || 'Erro ao enviar mensagem.');
    }

    const reader  = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const raw = line.slice(6).trim();
        if (!raw) continue;

        let data;
        try { data = JSON.parse(raw); } catch { continue; }

        if (data.error) {
          removeTypingIndicator();
          showError(`Erro: ${data.error}`);
          return;
        }

        if (data.type === 'memory_processing') {
          showChatStatus('Criando memória fixada…');
          continue;
        }

        if (data.delta) {
          if (!charText) {
            removeTypingIndicator();
            const b = addBubble('assistant', '');
            charRow  = b.row;
            charText = b.textEl;
          }
          charRawText += data.delta;
          renderBubbleText(charText, charRawText);
          scrollToBottom();
        }

        if (data.done) {
          if (data.message_id && charRow) {
            attachRollbackBtn(charRow, data.message_id);
            charRow.dataset.messageId = data.message_id;
          }
          if (data.user_message_id && userRow) {
            attachRollbackBtn(userRow, data.user_message_id);
            userRow.dataset.messageId = data.user_message_id;
          }
          updateLastCharRow();
          if (data.pinned_memories_created > 0) showPinnedMemoryToast(data.pinned_memories_created);
        }
      }
    }
  } catch (err) {
    removeTypingIndicator();
    charRow?.remove();
    showError(`Erro: ${err.message}`);
  } finally {
    removeTypingIndicator();
    clearChatStatus();
    state.isStreaming = false;
    setInputEnabled(true);
    dom.inputEl.focus();
    scrollToBottom();
  }
}

// ── Input listeners ───────────────────────────────────────────────────

export function initInputListeners() {
  dom.inputEl.addEventListener('input', autoResize);
  dom.inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });
  dom.sendBtn.addEventListener('click', sendMessage);
}
