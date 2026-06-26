import { state } from './state.js';

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Seletor de modelo exclusivo da conversa (override model-only).
export function initConvModelModal() {
  const modalEl = document.getElementById('convModelModal');
  const link    = document.getElementById('nav-conv-model');
  if (!modalEl || !link) return;

  const modal   = new bootstrap.Modal(modalEl);
  const select  = document.getElementById('conv-model-select');
  const saveBtn = document.getElementById('conv-model-save');
  const errEl   = document.getElementById('conv-model-error');

  link.addEventListener('click', (e) => {
    e.preventDefault();
    const offcanvas = bootstrap.Offcanvas.getInstance(document.getElementById('chatNav'));
    if (offcanvas) {
      offcanvas.hide();
      document.getElementById('chatNav').addEventListener('hidden.bs.offcanvas', openModal, { once: true });
    } else {
      openModal();
    }
  });

  async function openModal() {
    if (!state.conversationId) return;
    errEl.style.display = 'none';
    select.innerHTML = '<option value="">Carregando…</option>';
    modal.show();
    try {
      const [modelsRes, cfgRes] = await Promise.all([
        fetch('/api/models'),
        fetch(`/api/conversations/${state.conversationId}/model`),
      ]);
      const modelsData = await modelsRes.json();
      const cfgData    = await cfgRes.json();

      const current   = cfgData.ok ? cfgData.model : null;
      const inherited = cfgData.ok ? cfgData.inherited_model : null;
      const models    = modelsData.ok ? (modelsData.models || []) : [];

      const opts = [`<option value="" ${!current ? 'selected' : ''}>Padrão (${esc(inherited) || 'global / personagem'})</option>`]
        .concat(models.map(m => `<option value="${esc(m.name)}" ${m.name === current ? 'selected' : ''}>${esc(m.name)}</option>`));
      select.innerHTML = opts.join('');
    } catch {
      select.innerHTML = '<option value="">Padrão (global / personagem)</option>';
      errEl.textContent = 'Não foi possível listar os modelos do Ollama.';
      errEl.style.display = 'block';
    }
  }

  saveBtn.addEventListener('click', async () => {
    if (!state.conversationId) return;
    saveBtn.disabled = true;
    errEl.style.display = 'none';
    try {
      const res = await fetch(`/api/conversations/${state.conversationId}/model`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: select.value }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.message);
      modal.hide();
    } catch (err) {
      errEl.textContent = err.message || 'Erro ao salvar.';
      errEl.style.display = 'block';
    } finally {
      saveBtn.disabled = false;
    }
  });
}
