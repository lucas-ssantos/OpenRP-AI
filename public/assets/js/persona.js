const form        = document.getElementById('persona-form');
const msgError    = document.getElementById('msg-error');
const loadingEl   = document.getElementById('loading-state');
const pageTitle   = document.getElementById('page-title');
const pageDesc    = document.getElementById('page-description');

async function fetchPersona() {
  const response = await fetch('/api/persona');
  if (response.status === 404) return null;
  if (!response.ok) throw new Error('Falha ao carregar a persona');
  return (await response.json()).persona;
}

async function initializePage() {
  try {
    const persona = await fetchPersona();
    loadingEl.style.display = 'none';

    if (persona) {
      pageTitle.textContent = 'Editar persona';
      pageDesc.textContent  = 'Atualize os dados da sua persona quando desejar.';
      document.getElementById('name').value        = persona.name        || '';
      document.getElementById('description').value = persona.description || '';
      document.getElementById('avatar_url').value  = persona.avatar_url  || '';
      await loadSidebar();
      // Perfil aprendido só faz sentido com persona já cadastrada
      document.getElementById('facts-card').style.display = '';
      loadPersonaFacts();
    } else {
      loadingEl.style.display = 'none';
    }
  } catch (err) {
    loadingEl.innerHTML = `<span class="text-danger"><i class="bi bi-exclamation-triangle me-1"></i>${err.message}</span>`;
  }
}

// ── Perfil aprendido (persona facts) ─────────────────────────────────────────

const FACT_CATEGORY_LABELS = {
  preference:   'Gosta',
  dislike:      'Não gosta',
  trait:        'Traço',
  fact:         'Fato',
  relationship: 'Relação',
  goal:         'Objetivo',
};

function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function renderFactItem(fact) {
  const item = document.createElement('div');
  item.className = 'fact-item' + (fact.status === 'superseded' ? ' superseded' : '');

  const confidencePct = Math.round((fact.confidence ?? 0) * 100);
  const meta = fact.status === 'superseded'
    ? 'substituído'
    : `confirmado ${fact.times_confirmed}× · confiança ${confidencePct}%`;

  item.innerHTML = `
    <span class="fact-badge">${escHtml(FACT_CATEGORY_LABELS[fact.category] || fact.category)}</span>
    <div class="fact-content">
      ${escHtml(fact.content)}
      <div class="fact-meta">${meta}</div>
    </div>
    <button type="button" class="fact-delete" title="Excluir fato"><i class="bi bi-trash"></i></button>
  `;

  item.querySelector('.fact-delete').addEventListener('click', async () => {
    if (!confirm('Excluir este fato do seu perfil?')) return;
    try {
      const res = await fetch(`/api/persona/facts/${fact.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Falha ao excluir o fato.');
      loadPersonaFacts();
    } catch (err) {
      alert(err.message);
    }
  });

  return item;
}

async function loadPersonaFacts() {
  const loadingFacts   = document.getElementById('facts-loading');
  const emptyEl        = document.getElementById('facts-empty');
  const listEl         = document.getElementById('facts-list');
  const supersededWrap = document.getElementById('facts-superseded-wrap');
  const supersededEl   = document.getElementById('facts-superseded');

  try {
    const res = await fetch('/api/persona/facts');
    if (!res.ok) throw new Error('Falha ao carregar o perfil.');
    const { facts } = await res.json();

    loadingFacts.style.display = 'none';
    listEl.innerHTML = '';
    supersededEl.innerHTML = '';

    const active     = facts.filter(f => f.status === 'active');
    const superseded = facts.filter(f => f.status !== 'active');

    emptyEl.style.display = active.length ? 'none' : '';
    active.forEach(f => listEl.appendChild(renderFactItem(f)));

    supersededWrap.style.display = superseded.length ? '' : 'none';
    superseded.forEach(f => supersededEl.appendChild(renderFactItem(f)));
  } catch (err) {
    loadingFacts.innerHTML = `<span class="text-danger"><i class="bi bi-exclamation-triangle me-1"></i>${escHtml(err.message)}</span>`;
    loadingFacts.style.display = '';
  }
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  msgError.style.display = 'none';

  const data = {
    name:        document.getElementById('name').value.trim(),
    description: document.getElementById('description').value.trim(),
    avatar_url:  document.getElementById('avatar_url').value.trim() || null,
  };

  if (!data.name || !data.description) {
    msgError.textContent = 'Por favor, preencha o nome e a descrição.';
    msgError.style.display = 'block';
    return;
  }

  try {
    const response = await fetch('/api/persona', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.message || 'Falha ao salvar persona');
    window.location.href = '/';
  } catch (err) {
    msgError.textContent = err.message || 'Erro ao salvar persona. Tente novamente.';
    msgError.style.display = 'block';
  }
});

window.addEventListener('load', initializePage);
