const listEl       = document.getElementById('log-list');
const countEl       = document.getElementById('log-count');
const emptyEl       = document.getElementById('log-empty');
const contentWrapEl = document.getElementById('log-content-wrap');
const nameEl        = document.getElementById('log-name');
const metaEl        = document.getElementById('log-meta');
const preEl         = document.getElementById('log-pre');
const truncNoteEl   = document.getElementById('log-truncated');
const loadFullBtn   = document.getElementById('log-load-full');
const downloadBtn   = document.getElementById('log-download');

let currentFile = null;

// ── List ──────────────────────────────────────────────────────────────────────

async function loadFiles() {
  try {
    const res  = await fetch('/api/logs');
    const data = await res.json();
    if (!data.ok) throw new Error(data.message);
    renderList(data.files);
  } catch (err) {
    listEl.innerHTML = `<p class="text-danger small p-3 mb-0"><i class="bi bi-exclamation-triangle me-1"></i>${escape(err.message)}</p>`;
  }
}

function renderList(files) {
  countEl.textContent = files.length;

  if (!files.length) {
    listEl.innerHTML = '<p class="text-secondary small p-3 mb-0">Nenhum log encontrado em <code>data/logs</code>.</p>';
    return;
  }

  listEl.innerHTML = files.map(f => `
    <button class="vdb-conv-item" data-name="${escape(f.name)}">
      <div class="vdb-conv-placeholder"><i class="bi bi-file-earmark-text"></i></div>
      <div class="vdb-conv-info">
        <div class="vdb-conv-name">${escape(f.name)}</div>
        <div class="vdb-conv-stats">
          <span><i class="bi bi-hdd"></i> ${formatSize(f.size)}</span>
          <span>${formatDate(f.mtime)}</span>
        </div>
      </div>
    </button>`).join('');

  listEl.querySelectorAll('.vdb-conv-item').forEach(btn => {
    btn.addEventListener('click', () => selectFile(btn.dataset.name, btn));
  });
}

// ── Detail ────────────────────────────────────────────────────────────────────

async function selectFile(name, btn, full = false) {
  currentFile = name;

  listEl.querySelectorAll('.vdb-conv-item').forEach(b => b.classList.remove('active'));
  const target = btn || [...listEl.querySelectorAll('.vdb-conv-item')].find(b => b.dataset.name === name);
  if (target) target.classList.add('active');

  emptyEl.classList.add('d-none');
  contentWrapEl.classList.remove('d-none');
  nameEl.textContent = name;
  metaEl.textContent = '';
  truncNoteEl.classList.add('d-none');
  preEl.innerHTML = loadingSpinner();

  try {
    const url  = `/api/logs/${encodeURIComponent(name)}${full ? '?full=1' : ''}`;
    const res  = await fetch(url);
    const data = await res.json();
    if (!data.ok) throw new Error(data.message);

    metaEl.textContent    = `${formatSize(data.size)} · atualizado ${formatDate(data.mtime)}`;
    downloadBtn.href      = `/api/logs/${encodeURIComponent(name)}/download`;
    preEl.textContent     = data.content || '(arquivo vazio)';
    truncNoteEl.classList.toggle('d-none', !data.truncated);

    // Entradas são gravadas por append — as mais recentes ficam no fim do arquivo.
    preEl.scrollTop = preEl.scrollHeight;
  } catch (err) {
    preEl.textContent = '';
    preEl.innerHTML = `<span class="text-danger"><i class="bi bi-exclamation-triangle me-1"></i>${escape(err.message)}</span>`;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function loadingSpinner() {
  return `<div class="d-flex align-items-center gap-2 text-secondary small py-2">
    <div class="spinner-border spinner-border-sm text-info" role="status"></div>Carregando…</div>`;
}

function formatSize(bytes) {
  if (bytes == null) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(str) {
  if (!str) return '';
  try {
    return new Date(str).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return str;
  }
}

function escape(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Init ──────────────────────────────────────────────────────────────────────

loadFullBtn.addEventListener('click', () => {
  if (currentFile) selectFile(currentFile, null, true);
});

window.addEventListener('load', async () => {
  await loadSidebar();
  loadFiles();
});
