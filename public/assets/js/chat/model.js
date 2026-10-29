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
  const warnEl  = document.getElementById('conv-model-context-warning');

  let models        = [];  // [{name, context_length}] — vem de /api/models
  let inheritedModel = null;
  let contextSize    = null; // context_size global resolvido (null = automático)

  // llama-server carrega um único modelo, definido na inicialização do processo.
  function updateContextWarning() {
    if (contextSize == null) { warnEl.style.display = 'none'; return; }

    const modelName = select.value || inheritedModel;
    const model = models.find(m => m.name === modelName);
    const cl = model?.context_length;
    if (!cl) { warnEl.style.display = 'none'; return; }

    if (contextSize < cl) {
      warnEl.innerHTML = `<i class="bi bi-info-circle me-1"></i>Este modelo suporta até ${cl.toLocaleString('pt-BR')} tokens de contexto, mas o <strong>Context Size</strong> em Configurações está fixo em ${contextSize.toLocaleString('pt-BR')} — o restante não será usado. Ative "Contexto automático" ou aumente o valor em /settings para aproveitar o contexto completo.`;
      warnEl.style.display = 'block';
    } else if (contextSize > cl) {
      warnEl.innerHTML = `<i class="bi bi-exclamation-triangle me-1"></i>O <strong>Context Size</strong> fixo em Configurações (${contextSize.toLocaleString('pt-BR')}) é maior do que este modelo suporta nativamente (${cl.toLocaleString('pt-BR')}) — pode exigir mais memória do que o necessário.`;
      warnEl.style.display = 'block';
    } else {
      warnEl.style.display = 'none';
    }
  }

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
    warnEl.style.display = 'none';
    select.innerHTML = '<option value="">Carregando…</option>';
    modal.show();
    try {
      const [modelsRes, cfgRes] = await Promise.all([
        fetch('/api/models'),
        fetch(`/api/conversations/${state.conversationId}/model`),
      ]);
      const modelsData = await modelsRes.json();
      const cfgData    = await cfgRes.json();

      const current = cfgData.ok ? cfgData.model : null;
      inheritedModel = cfgData.ok ? cfgData.inherited_model : null;
      contextSize    = cfgData.ok ? cfgData.context_size : null;
      models         = modelsData.ok ? (modelsData.models || []) : [];
      const routerMode = modelsData.ok && modelsData.router_mode === true;

      const available = routerMode ? models : models.filter(m => m.loaded);
      const opts = [`<option value="" ${!current ? 'selected' : ''}>Padrão (${esc(inheritedModel) || 'global / personagem'})</option>`]
        .concat(available.map(m => {
          const suffix = m.loaded ? ' (carregado)' : (routerMode ? ' (carrega ao usar)' : '');
          return `<option value="${esc(m.name)}" ${m.name === current ? 'selected' : ''}>${esc(m.name)}${suffix}</option>`;
        }));
      select.innerHTML = opts.join('');
      updateContextWarning();
    } catch {
      select.innerHTML = '<option value="">Padrão (global / personagem)</option>';
      errEl.textContent = 'Não foi possível listar os modelos disponíveis.';
      errEl.style.display = 'block';
    }
  }

  select.addEventListener('change', updateContextWarning);

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
