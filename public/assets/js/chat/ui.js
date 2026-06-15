import { dom } from './state.js';

export function scrollToBottom(smooth = false) {
  dom.messagesEl.scrollTo({ top: dom.messagesEl.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
}

export function renderBubbleText(el, text) {
  el.dataset.raw = text;
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n{2,}/g, '\n');
  el.innerHTML = escaped.replace(/\*([^*]+)\*/g, '<em class="action-text">$1</em>');
}

export function updateLastCharRow() {
  const charRows = [...dom.messagesEl.querySelectorAll('.msg-row-char')];
  charRows.forEach(r => {
    const btn = r.querySelector('.regenerate-btn');
    if (btn) btn.style.display = 'none';
  });
  const last = charRows[charRows.length - 1];
  if (last) {
    const btn = last.querySelector('.regenerate-btn');
    if (btn) btn.style.display = '';
  }
}

export function addTypingIndicator() {
  const el = document.createElement('div');
  el.id = 'typing-indicator';
  el.className = 'bubble bubble-char typing-bubble';
  el.innerHTML = '<span class="dot"></span><span class="dot"></span><span class="dot"></span>';
  dom.messagesEl.appendChild(el);
  scrollToBottom();
}

export function removeTypingIndicator() {
  document.getElementById('typing-indicator')?.remove();
}

export function showError(text) {
  const el = document.createElement('div');
  el.className = 'system-msg';
  el.textContent = text;
  dom.messagesEl.appendChild(el);
  scrollToBottom();
}

export function setInputEnabled(enabled) {
  dom.inputEl.disabled = !enabled;
  dom.sendBtn.disabled = !enabled;
}

export function showChatStatus(text) {
  document.getElementById('chat-status-text').textContent = text;
  document.getElementById('chat-status').style.display = 'flex';
}

export function clearChatStatus() {
  const el = document.getElementById('chat-status');
  if (el) el.style.display = 'none';
}

export function showPinnedMemoryToast(count) {
  document.getElementById('pinned-memory-toast')?.remove();

  const toast = document.createElement('div');
  toast.id = 'pinned-memory-toast';
  toast.className = 'pinned-memory-toast';
  toast.innerHTML = `<i class="bi bi-pin-fill"></i><span>${count === 1 ? 'Nova memória fixada' : `${count} memórias fixadas`}</span>`;
  document.body.appendChild(toast);

  requestAnimationFrame(() => requestAnimationFrame(() => toast.classList.add('show')));

  setTimeout(() => {
    toast.classList.remove('show');
    toast.addEventListener('transitionend', () => toast.remove(), { once: true });
  }, 3500);
}
