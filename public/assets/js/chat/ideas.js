import { state, dom } from './state.js';
import { renderBubbleText } from './ui.js';
import { sendMessage, autoResize } from './events.js';

// Painel de ideias: páginas de 4 sugestões geradas pela IA, até MAX_PAGES.
// As páginas ficam em cache até a conversa avançar (nova mensagem invalida tudo).

const MAX_PAGES = 5;

let panel, listEl, pageEl, prevBtn, nextBtn, ideasBtn;
let pages = [];
let current = 0;
let loading = false;
let cacheMsgCount = -1;

const allIdeas = () => pages.flat();
const msgCount = () => dom.messagesEl.querySelectorAll('.msg-row').length;

function updateNav() {
  pageEl.textContent = `${pages.length ? current + 1 : '–'}/${MAX_PAGES}`;
  prevBtn.disabled = loading || current === 0;
  nextBtn.disabled = loading || current >= MAX_PAGES - 1;
}

function showLoading() {
  listEl.innerHTML = '<div class="ideas-loading"><span class="chat-status-spinner"></span>Gerando ideias…</div>';
}

function showIdeasError(msg) {
  listEl.innerHTML = '';
  const div = document.createElement('div');
  div.className = 'ideas-error';
  div.textContent = msg;
  listEl.appendChild(div);
}

function renderPage() {
  listEl.innerHTML = '';
  for (const idea of pages[current] || []) {
    const item = document.createElement('div');
    item.className = 'idea-item';

    const textBtn = document.createElement('button');
    textBtn.type = 'button';
    textBtn.className = 'idea-text';
    textBtn.title = 'Enviar esta ação';
    const span = document.createElement('span');
    renderBubbleText(span, idea);
    textBtn.appendChild(span);
    textBtn.addEventListener('click', () => useIdea(idea, true));

    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'idea-edit';
    editBtn.title = 'Editar antes de enviar';
    editBtn.innerHTML = '<i class="bi bi-pencil"></i>';
    editBtn.addEventListener('click', (e) => { e.stopPropagation(); useIdea(idea, false); });

    item.appendChild(textBtn);
    item.appendChild(editBtn);
    listEl.appendChild(item);
  }
  updateNav();
}

function useIdea(idea, send) {
  closePanel();
  dom.inputEl.value = idea;
  autoResize();
  if (send) {
    sendMessage();
  } else {
    dom.inputEl.focus();
    dom.inputEl.setSelectionRange(idea.length, idea.length);
  }
}

async function fetchPage() {
  loading = true;
  showLoading();
  updateNav();
  try {
    const res = await fetch(`/api/conversations/${state.conversationId}/ideas`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ exclude: allIdeas() }),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.message || 'Falha ao gerar ideias.');
    if (!Array.isArray(data.ideas) || !data.ideas.length) throw new Error('Nenhuma ideia gerada.');

    pages.push(data.ideas);
    current = pages.length - 1;
    cacheMsgCount = msgCount();
    loading = false;
    renderPage();
  } catch (err) {
    loading = false;
    showIdeasError(`Erro: ${err.message}`);
    updateNav();
  }
}

function openPanel() {
  if (!state.conversationId || state.isStreaming) return;
  // Conversa avançou desde a última geração → as ideias antigas ficaram obsoletas
  if (cacheMsgCount !== msgCount()) { pages = []; current = 0; }
  panel.style.display = 'flex';
  ideasBtn.classList.add('active');
  if (pages.length) renderPage();
  else if (!loading) fetchPage();
  else { showLoading(); updateNav(); }
}

function closePanel() {
  panel.style.display = 'none';
  ideasBtn.classList.remove('active');
}

export function initIdeas() {
  panel    = document.getElementById('ideas-panel');
  listEl   = document.getElementById('ideas-list');
  pageEl   = document.getElementById('ideas-page');
  prevBtn  = document.getElementById('ideas-prev');
  nextBtn  = document.getElementById('ideas-next');
  ideasBtn = document.getElementById('ideas-btn');

  ideasBtn.addEventListener('click', () => {
    panel.style.display === 'none' ? openPanel() : closePanel();
  });
  document.getElementById('ideas-close').addEventListener('click', closePanel);

  prevBtn.addEventListener('click', () => {
    if (current > 0) { current--; renderPage(); }
  });
  nextBtn.addEventListener('click', () => {
    if (current < pages.length - 1) { current++; renderPage(); }
    else if (pages.length < MAX_PAGES && !loading) fetchPage();
  });

  // Enviar mensagem manualmente também fecha o painel (as ideias ficarão obsoletas)
  dom.sendBtn.addEventListener('click', closePanel);
  dom.inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) closePanel();
  });

  // Clique fora fecha o painel
  document.addEventListener('click', (e) => {
    if (panel.style.display === 'none') return;
    if (!panel.contains(e.target) && !ideasBtn.contains(e.target)) closePanel();
  });
}
