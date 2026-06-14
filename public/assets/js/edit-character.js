const form     = document.getElementById('character-form');
const msgError = document.getElementById('msg-error');
const msgOk    = document.getElementById('msg-success');

const characterId = window.location.pathname.split('/')[2];

function showError(text) {
  msgError.textContent = text;
  msgError.style.display = 'block';
  msgOk.style.display = 'none';
}

function showSuccess(text) {
  msgOk.textContent = text;
  msgOk.style.display = 'block';
  msgError.style.display = 'none';
}

async function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function loadCharacter() {
  try {
    const res = await fetch(`/api/characters/${characterId}`);
    if (!res.ok) throw new Error('Personagem não encontrado.');
    const { character } = await res.json();

    document.title = `Editar ${character.name} — OpenRP AI`;
    document.getElementById('subtitle').textContent = `Modificando dados de ${character.name}`;

    document.getElementById('name').value          = character.name          || '';
    document.getElementById('scenario').value      = character.scenario      || '';
    document.getElementById('description').value   = character.description   || '';
    document.getElementById('first_message').value = character.first_message || '';
    document.getElementById('personality').value   = character.personality   || '';

    if (character.avatar_url) {
      const wrap = document.getElementById('avatar-preview-wrap');
      document.getElementById('avatar-preview').src = character.avatar_url;
      wrap.style.display = 'block';
    }

    document.getElementById('btn-cancel').addEventListener('click', () => {
      window.location.href = `/chat/${characterId}`;
    });
  } catch (err) {
    showError(err.message || 'Erro ao carregar personagem.');
  }
}

async function handleSubmit(event) {
  event.preventDefault();
  msgError.style.display = 'none';
  msgOk.style.display = 'none';

  const name         = document.getElementById('name').value.trim();
  const scenario     = document.getElementById('scenario').value.trim();
  const description  = document.getElementById('description').value.trim();
  const personality  = document.getElementById('personality').value.trim();
  const firstMessage = document.getElementById('first_message').value.trim();
  const avatarLink   = document.getElementById('avatar_link').value.trim();
  const avatarFile   = document.getElementById('avatar_upload').files[0];

  if (!name) { showError('O nome do personagem é obrigatório.'); return; }

  const body = { name, scenario, description, personality, first_message: firstMessage };

  if (avatarFile) {
    body.avatar_upload   = await readFileAsBase64(avatarFile);
    body.avatar_filename = avatarFile.name;
  } else if (avatarLink) {
    body.avatar_link = avatarLink;
  }

  try {
    const response = await fetch(`/api/characters/${characterId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const result = await response.json();

    if (!response.ok || !result.ok) throw new Error(result.message || 'Falha ao salvar alterações.');

    showSuccess('Alterações salvas! Redirecionando...');
    setTimeout(() => { window.location.href = `/chat/${characterId}`; }, 1200);
  } catch (err) {
    showError(err.message || 'Erro ao salvar alterações.');
  }
}

window.addEventListener('load', async () => {
  await loadSidebar();
  await loadCharacter();
  form.addEventListener('submit', handleSubmit);
});
