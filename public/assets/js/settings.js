let presetsData = {};
let configData  = null;
let routerMode  = false;

const form       = document.getElementById('settings-form');
const feedbackEl = document.getElementById('feedback-msg');

function showFeedback(text, isError = false) {
  feedbackEl.className = `mb-4 ${isError ? 'alert-glass-error' : 'alert-glass-success'}`;
  feedbackEl.innerHTML = `<i class="bi bi-${isError ? 'exclamation-triangle' : 'check-circle'} me-2"></i>${text}`;
  feedbackEl.style.display = 'block';

  // Sobe a página até a mensagem — o formulário é longo e o botão de salvar fica
  // no rodapé, então sem isso a mensagem fica fora da área visível. Calculado
  // manualmente (em vez de scrollIntoView) para descontar a topbar fixa do mobile,
  // que senão cobre o topo da mensagem.
  requestAnimationFrame(() => {
    const topbar = document.querySelector('.mobile-topbar');
    const topbarHeight = topbar && getComputedStyle(topbar).display !== 'none' ? topbar.offsetHeight : 0;
    const y = feedbackEl.getBoundingClientRect().top + window.scrollY - topbarHeight - 16;
    window.scrollTo({ top: Math.max(y, 0), behavior: 'smooth' });
  });

  if (!isError) setTimeout(() => { feedbackEl.style.display = 'none'; }, 4000);
}

// ── Installed models ──────────────────────────────────────────────────────────

async function loadModels() {
  const modelSelect = document.getElementById('model');
  const affectionSelect = document.getElementById('affection_model');
  try {
    const res  = await fetch('/api/models');
    const data = await res.json();

    routerMode = data.ok && data.router_mode === true;
    const models = data.ok ? (data.models || []) : [];

    if (!models.length) {
      modelSelect.innerHTML = '<option value="">— Nenhum modelo instalado —</option>';
      affectionSelect.innerHTML = '<option value="">Mesmo modelo principal (padrão)</option>';
      return [];
    }

    modelSelect.innerHTML = '<option value="">— Selecione o modelo —</option>';
    affectionSelect.innerHTML = '<option value="">Mesmo modelo principal (padrão)</option>';

    for (const m of models) {
      const gb = m.size ? ` · ${(m.size / 1e9).toFixed(1)} GB` : '';
      const status = m.loaded ? ' · carregado' : (routerMode ? ' · carrega ao usar' : ' · requer reinicialização');

      const mainOpt = document.createElement('option');
      mainOpt.value = m.name;
      mainOpt.textContent = `${m.name}${gb}${status}`;
      modelSelect.appendChild(mainOpt);

      const affectionOpt = document.createElement('option');
      affectionOpt.value = m.name;
      affectionOpt.textContent = `${m.name}${gb}`;
      affectionSelect.appendChild(affectionOpt);
    }

    return models.map(m => m.name);
  } catch {
    modelSelect.innerHTML = '<option value="">— Erro ao carregar modelos —</option>';
    affectionSelect.innerHTML = '<option value="">Mesmo modelo principal (padrão)</option>';
    return [];
  }
}

function ensureModelOption(modelName, selectId = 'model') {
  if (!modelName) return;
  const modelSelect = document.getElementById(selectId);
  if (!modelSelect) return;
  const exists = Array.from(modelSelect.options).some(o => o.value === modelName);
  if (!exists) {
    const opt = document.createElement('option');
    opt.value = modelName;
    opt.textContent = `${modelName} (configurado)`;
    // Inserir como filho DIRETO do <select>, logo após o placeholder.
    // Não usar modelSelect.options[1]: com <optgroup>, options[] inclui <option>s
    // aninhados, e insertBefore com um nó que não é filho direto lança DOMException.
    const placeholder = [...modelSelect.children].find((c) => c.tagName === 'OPTION');
    modelSelect.insertBefore(opt, placeholder ? placeholder.nextSibling : modelSelect.firstChild);
  }
  modelSelect.value = modelName;
}

// ── Presets ───────────────────────────────────────────────────────────────────

async function loadPresets() {
  try {
    const res  = await fetch('/api/presets');
    const data = await res.json();
    if (data.ok && data.presets) { presetsData = data.presets; renderPresets(); }
  } catch { showFeedback('Erro ao carregar presets.', true); }
}

async function loadConfig() {
  try {
    const res  = await fetch('/api/config');
    const data = await res.json();
    if (data.ok && data.config) configData = data.config;
  } catch { /* silent */ }
}

function fillForm(config) {
  ensureModelOption(config.model);
  ensureModelOption(config.affection_model, 'affection_model');
  document.getElementById('model').value          = config.model          || '';
  document.getElementById('affection_model').value = config.affection_model || '';
  // think_mode ausente (presets antigos / payload legado com boolean think):
  // think=true equivale a 'always'; sem nada, 'off'.
  document.getElementById('think_mode').value     = config.think_mode || (config.think ? 'always' : 'off');
  document.getElementById('temperature').value    = config.temperature    ?? '';
  document.getElementById('top_p').value          = config.top_p          ?? '';
  document.getElementById('top_k').value          = config.top_k          ?? '';
  document.getElementById('min_p').value          = config.min_p          ?? '';
  document.getElementById('repeat_penalty').value = config.repeat_penalty ?? '';
  document.getElementById('repeat_last_n').value  = config.repeat_last_n  ?? '';
  const ctxAuto = config.context_size == null || config.context_size === 0;
  document.getElementById('context_auto').checked     = ctxAuto;
  document.getElementById('context_size').value       = ctxAuto ? '' : config.context_size;
  document.getElementById('context_size').disabled    = ctxAuto;
  document.getElementById('num_ctx_messages').value  = config.num_ctx_messages  ?? '';
  document.getElementById('min_tokens').value        = config.min_tokens        ?? '';
  document.getElementById('persona_interval').value  = config.persona_interval  ?? 10;
  document.getElementById('max_tokens').value     = config.max_tokens     ?? '';
  document.getElementById('stream').value         = config.stream ? '1' : '0';
  document.getElementById('seed').value           = config.seed           ?? '';
  if (config.stop) {
    document.getElementById('stop').value =
      Array.isArray(config.stop) ? config.stop.join(', ') : config.stop;
  }
}

function loadPreset(key) {
  const preset = presetsData[key];
  if (!preset?.config) return showFeedback('Erro ao carregar preset.', true);
  fillForm(preset.config);
  document.querySelectorAll('.preset-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.preset === key);
  });
  showFeedback(`Preset "${preset.name}" carregado.`);
}

function renderPresets() {
  const el = document.getElementById('presets');
  el.innerHTML = Object.entries(presetsData).map(([key, p]) => `
    <div class="col-12 col-sm-4">
      <button type="button" class="preset-btn" data-preset="${key}" onclick="loadPreset('${key}')">
        <strong>${p.name}</strong>
        <small>${p.desc}</small>
      </button>
    </div>
  `).join('');
}

// ── Submit ────────────────────────────────────────────────────────────────────

async function handleSubmit(e) {
  e.preventDefault();
  feedbackEl.style.display = 'none';

  const stopStr = document.getElementById('stop').value.trim();
  const stop    = stopStr.split(',').map(s => s.trim()).filter(Boolean);

  // Contexto automático → usa LLAMA_CTX_SIZE ao iniciar o llama-server.
  const contextAuto = document.getElementById('context_auto').checked;

  // 0 = perfil desligado (deliberado) — por isso não usa `|| 10`, que engoliria o 0.
  const personaIntervalRaw = parseInt(document.getElementById('persona_interval').value);
  const personaInterval    = Number.isInteger(personaIntervalRaw) && personaIntervalRaw >= 0 ? personaIntervalRaw : 10;

  const config = {
    model:            document.getElementById('model').value.trim(),
    affection_model:  document.getElementById('affection_model').value || null,
    temperature:      parseFloat(document.getElementById('temperature').value)    || null,
    top_p:            parseFloat(document.getElementById('top_p').value)          || null,
    top_k:            parseInt(document.getElementById('top_k').value)            || null,
    min_p:            parseFloat(document.getElementById('min_p').value)          || null,
    repeat_penalty:   parseFloat(document.getElementById('repeat_penalty').value) || null,
    repeat_last_n:    parseInt(document.getElementById('repeat_last_n').value)    || null,
    context_size:     contextAuto ? null : (parseInt(document.getElementById('context_size').value) || null),
    num_ctx_messages: parseInt(document.getElementById('num_ctx_messages').value) || null,
    min_tokens:       parseInt(document.getElementById('min_tokens').value)       || null,
    max_tokens:       parseInt(document.getElementById('max_tokens').value)       || null,
    persona_interval: personaInterval,
    stream:           parseInt(document.getElementById('stream').value)           || null,
    seed:             parseInt(document.getElementById('seed').value)             || -1,
    think_mode:       document.getElementById('think_mode').value,
    stop,
  };

  try {
    const res    = await fetch('/api/config', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(config),
    });
    const result = await res.json();
    if (!res.ok || !result.ok) throw new Error(result.message || 'Erro ao salvar.');
    showFeedback(result.message || 'Configuração salva com sucesso!');
  } catch (err) {
    showFeedback(err.message || 'Erro ao salvar configuração.', true);
  }
}

// ── Init ──────────────────────────────────────────────────────────────────────

window.addEventListener('load', async () => {
  await loadSidebar();

  // load models first so #model select is populated before fillForm runs
  await Promise.all([loadModels(), loadPresets(), loadConfig()]);

  if (configData) {
    fillForm(configData);
  } else if (presetsData.medium?.config) {
    // Sem configuração salva → parte do preset "Máquina Média".
    fillForm(presetsData.medium.config);
    document.querySelectorAll('.preset-btn').forEach(
      (btn) => btn.classList.toggle('active', btn.dataset.preset === 'medium')
    );
    showFeedback('Nenhuma configuração salva ainda — carregado o preset "Máquina Média". Ajuste se quiser e clique em Salvar.');
  }

  // Toggle "contexto automático" habilita/desabilita o campo Context Size.
  document.getElementById('context_auto').addEventListener('change', (e) => {
    const input = document.getElementById('context_size');
    input.disabled = e.target.checked;
    if (e.target.checked) input.value = '';
  });

  form.addEventListener('submit', handleSubmit);

  document.querySelectorAll('[data-bs-toggle="tooltip"]').forEach(
    (el) => new bootstrap.Tooltip(el)
  );
});
