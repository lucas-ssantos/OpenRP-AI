const form     = document.getElementById('character-form');
const msgError = document.getElementById('msg-error');
const msgOk    = document.getElementById('msg-success');

const characterId = window.location.pathname.split('/')[2];

let characterImages = [];          // galeria atual vinda do banco
const removeImageIds = new Set();  // marcadas para remoção — aplicadas no salvar

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
    const [charRes, lbAllRes, lbCharRes, affRes] = await Promise.all([
      fetch(`/api/characters/${characterId}`),
      fetch('/api/lorebooks'),
      fetch(`/api/characters/${characterId}/lorebooks`),
      fetch('/api/affection/levels'),
    ]);

    if (!charRes.ok) throw new Error('Personagem não encontrado.');
    const { character } = await charRes.json();

    document.title = `Editar ${character.name} — OpenRP AI`;
    document.getElementById('subtitle').textContent = `Modificando dados de ${character.name}`;

    document.getElementById('name').value             = character.name             || '';
    document.getElementById('description').value      = character.description      || '';
    document.getElementById('personality').value      = character.personality      || '';
    document.getElementById('physical_traits').value  = character.physical_traits  || '';
    document.getElementById('likes').value             = character.likes            || '';
    document.getElementById('dislikes').value          = character.dislikes         || '';

    characterImages = character.images || [];
    if (!characterImages.length && character.avatar_url) {
      characterImages = [{ id: null, url: character.avatar_url }];
    }
    renderImagesGallery();

    document.getElementById('btn-cancel').addEventListener('click', () => {
      window.location.href = `/character/${characterId}`;
    });

    const allLorebooks  = lbAllRes.ok  ? (await lbAllRes.json()).lorebooks  || [] : [];
    const assignedIds   = lbCharRes.ok ? (await lbCharRes.json()).lorebook_ids || [] : [];
    renderLorebookPicker(allLorebooks, new Set(assignedIds));

    const affLevels = affRes.ok ? (await affRes.json()).levels || [] : [];
    renderAffectionSelect(affLevels, character);
  } catch (err) {
    showError(err.message || 'Erro ao carregar personagem.');
  }
}

function renderImagesGallery() {
  const wrap    = document.getElementById('images-gallery-wrap');
  const gallery = document.getElementById('images-gallery');
  if (!characterImages.length) { wrap.style.display = 'none'; return; }

  gallery.innerHTML = '';
  for (const img of characterImages) {
    const item = document.createElement('div');
    item.className = 'img-thumb-wrap';

    const thumb = document.createElement('img');
    thumb.src = img.url;
    thumb.alt = 'Imagem do personagem';
    item.appendChild(thumb);

    // Imagens sem id (fallback do avatar_url legado) não são removíveis
    if (img.id) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'img-thumb-remove';
      btn.innerHTML = '<i class="bi bi-x"></i>';
      btn.title = 'Marcar para remoção';
      btn.addEventListener('click', () => {
        if (removeImageIds.has(img.id)) {
          removeImageIds.delete(img.id);
          item.classList.remove('marked');
          btn.innerHTML = '<i class="bi bi-x"></i>';
          btn.title = 'Marcar para remoção';
        } else {
          removeImageIds.add(img.id);
          item.classList.add('marked');
          btn.innerHTML = '<i class="bi bi-arrow-counterclockwise"></i>';
          btn.title = 'Desfazer remoção';
        }
      });
      item.appendChild(btn);
    }

    gallery.appendChild(item);
  }
  wrap.style.display = 'block';
}

function renderLorebookPicker(lorebooks, selectedIds) {
  const picker = document.getElementById('lorebook-picker');
  if (!lorebooks.length) {
    picker.innerHTML = '<p class="text-secondary small mb-0">Nenhum lorebook criado ainda. <a href="/lorebooks" class="text-info">Criar lorebooks</a></p>';
    return;
  }
  picker.innerHTML = lorebooks.map(lb => `
    <label class="lb-picker-item">
      <input type="checkbox" name="lorebook_ids" value="${lb.id}" ${selectedIds.has(lb.id) ? 'checked' : ''} />
      <div>
        <div class="lb-picker-name">${escHtml(lb.title)}</div>
        <div class="lb-picker-kw">${lb.keywords ? lb.keywords : '<em>Sem keywords — sempre ativo</em>'}</div>
      </div>
    </label>
  `).join('');
}

function renderAffectionSelect(levels, character) {
  const select = document.getElementById('affection_override');
  const hint   = document.getElementById('affection-current');
  if (!levels.length) return;

  for (const lvl of levels) {
    const opt = document.createElement('option');
    opt.value = String(lvl.level);
    opt.textContent = `${lvl.name} (nível ${lvl.level})`;
    select.appendChild(opt);
  }

  const override = character.affection_override;
  select.value = override !== null && override !== undefined ? String(override) : '';

  // Estágio que os pontos acumulados dariam no modo automático
  const points = character.affection_points ?? 0;
  let autoLevel = levels[0];
  for (const lvl of levels) {
    if (points >= lvl.threshold) autoLevel = lvl;
  }
  hint.textContent = `Progressão atual: ${autoLevel.name} — ${points} ponto${points === 1 ? '' : 's'} acumulado${points === 1 ? '' : 's'}.`;
}

function escHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

async function handleSubmit(event) {
  event.preventDefault();
  msgError.style.display = 'none';
  msgOk.style.display = 'none';

  const name           = document.getElementById('name').value.trim();
  const description    = document.getElementById('description').value.trim();
  const personality    = document.getElementById('personality').value.trim();
  const physicalTraits = document.getElementById('physical_traits').value.trim();
  const likes          = document.getElementById('likes').value.trim();
  const dislikes       = document.getElementById('dislikes').value.trim();
  const avatarLink     = document.getElementById('avatar_link').value.trim();
  const avatarFiles    = [...document.getElementById('avatar_upload').files];

  if (!name) { showError('O nome do personagem é obrigatório.'); return; }

  const remainingCount = characterImages.length - removeImageIds.size + avatarFiles.length + (avatarLink ? 1 : 0);
  if (remainingCount === 0) {
    showError('O personagem precisa de ao menos uma imagem — adicione uma antes de remover todas.');
    return;
  }

  const overrideValue = document.getElementById('affection_override').value;
  const body = {
    name, description, personality, physical_traits: physicalTraits, likes, dislikes,
    affection_override: overrideValue === '' ? null : Number(overrideValue),
  };

  if (avatarFiles.length) {
    body.avatar_uploads = await Promise.all(avatarFiles.map(async (file) => ({
      data: await readFileAsBase64(file),
      filename: file.name,
    })));
  }
  if (avatarLink) body.avatar_link = avatarLink;
  if (removeImageIds.size) body.remove_image_ids = [...removeImageIds];

  const checkedIds = [...document.querySelectorAll('input[name="lorebook_ids"]:checked')].map(el => el.value);

  try {
    const [charRes, lbRes] = await Promise.all([
      fetch(`/api/characters/${characterId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
      fetch(`/api/characters/${characterId}/lorebooks`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lorebook_ids: checkedIds }),
      }),
    ]);

    const result = await charRes.json();
    if (!charRes.ok || !result.ok) throw new Error(result.message || 'Falha ao salvar alterações.');

    showSuccess('Alterações salvas! Redirecionando...');
    setTimeout(() => { window.location.href = `/character/${characterId}`; }, 1200);
  } catch (err) {
    showError(err.message || 'Erro ao salvar alterações.');
  }
}

window.addEventListener('load', async () => {
  await loadSidebar();
  await loadCharacter();
  form.addEventListener('submit', handleSubmit);
});
