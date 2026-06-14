async function loadCharacters() {
  try {
    const res = await fetch('/api/characters');
    if (!res.ok) throw new Error('Falha ao carregar personagens');
    const data = await res.json();

    const grid = document.getElementById('character-grid');

    if (data.ok && Array.isArray(data.characters) && data.characters.length > 0) {
      data.characters.forEach((character) => {
        const col = document.createElement('div');
        col.className = 'col';

        const thumb = character.avatar_url
          ? `<img src="${character.avatar_url}" class="card-thumb" alt="Avatar de ${character.name}" />`
          : `<div class="card-thumb-placeholder"><i class="bi bi-person-circle fs-1 opacity-25"></i></div>`;

        col.innerHTML = `
          <div class="card glass-card char-card h-100">
            ${thumb}
            <div class="card-body d-flex flex-column gap-2">
              <h5 class="card-title mb-0 fw-semibold">${character.name}</h5>
              <p class="text-secondary small mb-0" style="line-height:1.5;">${character.scenario || character.description || 'Sem descrição disponível.'}</p>
              <p class="flex-grow-1 mb-0" style="color:#cbd5e1; font-size:.88rem; line-height:1.65;">${character.personality || 'Personalidade não definida.'}</p>
              <div class="d-flex align-items-center justify-content-between pt-2 mt-1" style="border-top:1px solid rgba(148,163,184,0.1);">
                <span class="badge-blue">${character.name}</span>
                <button class="btn-edit-char" title="Editar personagem" data-id="${character.id}">
                  <i class="bi bi-pencil"></i>
                </button>
              </div>
            </div>
          </div>
        `;

        col.querySelector('.char-card').addEventListener('click', () => {
          window.location.href = `/chat/${character.id}`;
        });

        col.querySelector('.btn-edit-char').addEventListener('click', (e) => {
          e.stopPropagation();
          window.location.href = `/character/${character.id}/edit`;
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

window.addEventListener('load', async () => {
  await loadSidebar();
  loadCharacters();
});
