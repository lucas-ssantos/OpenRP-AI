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

function showPageError(text) {
  const el = document.getElementById('page-error');
  el.textContent = text;
  el.style.display = 'block';
}

async function loadCharacters() {
  try {
    const [res, personaRes] = await Promise.all([
      fetch('/api/characters'),
      fetch('/api/persona'),
    ]);
    if (!res.ok) throw new Error('Falha ao carregar personagens');
    const data = await res.json();
    const personaData = personaRes.ok ? await personaRes.json() : null;
    const userName = personaData?.persona?.name || 'você';

    const grid = document.getElementById('character-grid');

    if (data.ok && Array.isArray(data.characters) && data.characters.length > 0) {
      data.characters.forEach((character) => {
        const col = document.createElement('div');
        col.className = 'col';

        const name = escHtml(character.name);
        const description = expandPlaceholders(character.description, character.name, userName);
        const thumb = character.avatar_url
          ? `<img src="${escHtml(character.avatar_url)}" class="card-thumb" alt="Avatar de ${name}" />`
          : `<div class="card-thumb-placeholder"><i class="bi bi-person-circle fs-1 opacity-25"></i></div>`;

        col.innerHTML = `
          <div class="card glass-card char-card h-100">
            ${thumb}
            <div class="card-body d-flex flex-column gap-2">
              <h5 class="card-title mb-0 fw-semibold">${name}</h5>
              <p class="text-secondary small mb-0" style="line-height:1.5;">${escHtml(description) || 'Sem descrição disponível.'}</p>
              <div class="d-flex align-items-center justify-content-between pt-2 mt-1" style="border-top:1px solid rgba(148,163,184,0.1);">
                <span class="badge-blue">${name}</span>
                <div class="d-flex align-items-center gap-2">
                  <button class="btn-edit-char" title="Editar personagem" data-id="${escHtml(character.id)}">
                    <i class="bi bi-pencil"></i>
                  </button>
                  <button class="btn-delete-char" title="Apagar personagem" data-id="${escHtml(character.id)}">
                    <i class="bi bi-trash3"></i>
                  </button>
                </div>
              </div>
            </div>
          </div>
        `;

        col.querySelector('.char-card').addEventListener('click', () => {
          window.location.href = `/character/${character.id}`;
        });

        col.querySelector('.btn-edit-char').addEventListener('click', (e) => {
          e.stopPropagation();
          window.location.href = `/character/${character.id}/edit`;
        });

        col.querySelector('.btn-delete-char').addEventListener('click', (e) => {
          e.stopPropagation();
          openDeleteFlow({
            label: `o personagem "${character.name}" e tudo relacionado a ele`,
            warning: 'Isso apagará permanentemente o personagem, todas as suas conversas, mensagens e memórias.',
            onConfirm: () => deleteCharacter(character.id, col),
          });
        });

        grid.appendChild(col);
      });
    }
  } catch (err) {
    console.error(err);
  }
}

function addCharacter() {
  window.location.href = '/character/new';
}

// ── Delete flow (duplo aviso: passo 1 explica, passo 2 confirma de novo) ─────

let deleteStep1Modal, deleteStep2Modal;
let pendingDeleteConfirm = null;

function initDeleteModals() {
  deleteStep1Modal = new bootstrap.Modal(document.getElementById('deleteStep1Modal'));
  deleteStep2Modal = new bootstrap.Modal(document.getElementById('deleteStep2Modal'));

  document.getElementById('delete-step1-confirm').addEventListener('click', () => {
    deleteStep1Modal.hide();
    deleteStep2Modal.show();
  });

  document.getElementById('delete-step2-confirm').addEventListener('click', () => {
    deleteStep2Modal.hide();
    const confirmFn = pendingDeleteConfirm;
    pendingDeleteConfirm = null;
    if (confirmFn) confirmFn();
  });
}

function openDeleteFlow({ label, warning, onConfirm }) {
  document.getElementById('delete-step1-body').textContent = warning;
  document.getElementById('delete-step2-target').textContent = label;
  pendingDeleteConfirm = onConfirm;
  document.getElementById('page-error').style.display = 'none';
  deleteStep1Modal.show();
}

async function deleteCharacter(characterId, cardCol) {
  try {
    const res = await fetch(`/api/characters/${characterId}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.message || 'Falha ao apagar personagem.');
    cardCol.remove();
  } catch (err) {
    showPageError(err.message || 'Erro ao apagar personagem.');
  }
}

window.addEventListener('load', async () => {
  await loadSidebar();
  initDeleteModals();
  loadCharacters();
});
