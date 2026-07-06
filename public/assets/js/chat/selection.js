import { state } from './state.js';
import { showPinnedMemoryToast } from './ui.js';

const selectedMessages = new Map(); // messageId -> { role, content }

function getRowContent(row) {
  return row.querySelector('.bubble-text')?.dataset.raw
    ?? row.querySelector('.bubble-text')?.textContent
    ?? '';
}

function getRowRole(row) {
  return row.classList.contains('msg-row-user') ? 'user' : 'assistant';
}

function updateCounter() {
  const count = selectedMessages.size;
  document.getElementById('selection-count').textContent =
    count === 0 ? 'Nenhuma selecionada' : `${count} selecionada${count !== 1 ? 's' : ''}`;
  document.getElementById('selection-generate-btn').disabled = count < 2;
}

function toggleRow(row) {
  const messageId = row.dataset.messageId;
  if (!messageId) return;

  if (selectedMessages.has(messageId)) {
    selectedMessages.delete(messageId);
    row.classList.remove('selected');
  } else {
    selectedMessages.set(messageId, {
      role: getRowRole(row),
      content: getRowContent(row),
    });
    row.classList.add('selected');
  }
  updateCounter();
}

export function enterSelectionMode() {
  selectedMessages.clear();
  document.querySelectorAll('.msg-row.selected').forEach(r => r.classList.remove('selected'));
  document.body.classList.add('selection-mode');
  updateCounter();
}

export function exitSelectionMode() {
  selectedMessages.clear();
  document.querySelectorAll('.msg-row.selected').forEach(r => r.classList.remove('selected'));
  document.body.classList.remove('selection-mode');
}

function showToast(count, error = null) {
  const existing = document.querySelector('.selection-result-toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = 'pinned-memory-toast selection-result-toast';

  if (error) {
    toast.style.borderColor = 'rgba(239,68,68,0.4)';
    toast.style.color = '#fca5a5';
    toast.innerHTML = `<i class="bi bi-exclamation-circle"></i> Erro ao gerar memória`;
  } else if (count === 0) {
    toast.innerHTML = `<i class="bi bi-info-circle"></i> Nenhuma memória nova criada`;
  } else {
    toast.innerHTML = `<i class="bi bi-brain"></i> ${count} memória${count !== 1 ? 's' : ''} criada${count !== 1 ? 's' : ''}`;
  }

  document.body.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('show'));
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 350);
  }, 3500);
}

async function generateFromSelected() {
  if (selectedMessages.size < 2 || !state.conversationId) return;

  const btn = document.getElementById('selection-generate-btn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1" style="width:.9rem;height:.9rem;border-width:2px;"></span>Gerando…';

  const messages = [...selectedMessages.values()];

  try {
    const res = await fetch(`/api/conversations/${state.conversationId}/memories/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages }),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.message);

    exitSelectionMode();
    showToast(data.created);
    if (data.pinned > 0) setTimeout(() => showPinnedMemoryToast(data.pinned), 3800);
  } catch {
    btn.disabled = false;
    btn.innerHTML = '<i class="bi bi-brain"></i> Gerar memória';
    showToast(0, true);
  }
}

export function initSelectionMode() {
  const messagesEl = document.getElementById('messages');

  document.getElementById('nav-select-messages').addEventListener('click', (e) => {
    e.preventDefault();
    const offcanvas = bootstrap.Offcanvas.getInstance(document.getElementById('chatNav'));
    if (offcanvas) {
      offcanvas.hide();
      document.getElementById('chatNav').addEventListener('hidden.bs.offcanvas', () => {
        enterSelectionMode();
      }, { once: true });
    } else {
      enterSelectionMode();
    }
  });

  messagesEl.addEventListener('click', (e) => {
    if (!document.body.classList.contains('selection-mode')) return;
    const row = e.target.closest('.msg-row');
    if (row) toggleRow(row);
  });

  document.getElementById('selection-cancel-btn').addEventListener('click', exitSelectionMode);
  document.getElementById('selection-generate-btn').addEventListener('click', generateFromSelected);
}
