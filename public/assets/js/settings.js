let presetsData = {};
let configData  = null;

const form       = document.getElementById('settings-form');
const feedbackEl = document.getElementById('feedback-msg');

function showFeedback(text, isError = false) {
  feedbackEl.className = isError ? 'alert-glass-error' : 'alert-glass-success';
  feedbackEl.innerHTML = `<i class="bi bi-${isError ? 'exclamation-triangle' : 'check-circle'} me-2"></i>${text}`;
  feedbackEl.style.display = 'block';
  if (!isError) setTimeout(() => { feedbackEl.style.display = 'none'; }, 4000);
}

// ── Curated recommendations ───────────────────────────────────────────────────

const RECOMMENDED_MODELS = [
  { name: "gemma4:e4b",      params: "4B",  vram: "~2.3 GB", desc: "Padrão da aplicação · leve e rápido" },
  { name: "gemma4:12b",      params: "12B", vram: "~7 GB",   desc: "Mais coerente e expressivo" },
  { name: "gemma3:4b",       params: "4B",  vram: "~2.5 GB", desc: "Bom contexto visual e lore" },
  { name: "gemma3:12b",      params: "12B", vram: "~7 GB",   desc: "Contexto longo · boa narrativa" },
  { name: "llama3.2:3b",     params: "3B",  vram: "~2 GB",   desc: "Ultra leve · bom para HW fraco" },
  { name: "llama3.1:8b",     params: "8B",  vram: "~5 GB",   desc: "Fluente e criativo" },
  { name: "qwen3:4b",        params: "4B",  vram: "~2.6 GB", desc: "Bom roleplay · suporte a CoT" },
  { name: "qwen3:8b",        params: "8B",  vram: "~5 GB",   desc: "Excelente criatividade e reasoning" },
  { name: "mistral:7b",      params: "7B",  vram: "~4 GB",   desc: "Rápido e equilibrado" },
  { name: "phi4:14b",        params: "14B", vram: "~9 GB",   desc: "Raciocínio avançado" },
  { name: "deepseek-r1:7b",  params: "7B",  vram: "~4.7 GB", desc: "Raciocínio longo e profundo" },
  { name: "command-r:35b",   params: "35B", vram: "~20 GB",  desc: "Narrativas longas · HW potente" },
];

// ── Installed models ──────────────────────────────────────────────────────────

async function loadModels() {
  const modelSelect = document.getElementById('model');
  try {
    const res  = await fetch('/api/models');
    const data = await res.json();

    if (!data.ok || !data.models?.length) {
      modelSelect.innerHTML = '<option value="">— Nenhum modelo instalado —</option>';
      return [];
    }

    const models   = data.models;
    const names    = new Set(models.map(m => m.name));

    // group by family, gemma4 first
    const groups = {};
    for (const m of models) {
      const fam = m.family || 'outros';
      (groups[fam] = groups[fam] || []).push(m);
    }
    const families = Object.keys(groups).sort((a, b) => {
      if (a === 'gemma4') return -1;
      if (b === 'gemma4') return 1;
      return a.localeCompare(b);
    });

    modelSelect.innerHTML = '<option value="">— Selecione o modelo —</option>';
    for (const fam of families) {
      const og = document.createElement('optgroup');
      og.label = fam;
      for (const m of groups[fam]) {
        const opt = document.createElement('option');
        opt.value = m.name;
        const gb  = m.size ? ` · ${(m.size / 1e9).toFixed(1)} GB` : '';
        const ps  = m.parameter_size ? ` ${m.parameter_size}` : '';
        const rec = m.name === 'gemma4:e4b-32k' ? ' ★' : '';
        opt.textContent = `${m.name}${ps}${gb}${rec}`;
        og.appendChild(opt);
      }
      modelSelect.appendChild(og);
    }

    return [...names];
  } catch {
    modelSelect.innerHTML = '<option value="">— Erro ao carregar modelos —</option>';
    return [];
  }
}

function ensureModelOption(modelName) {
  if (!modelName) return;
  const modelSelect = document.getElementById('model');
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

// ── Recommendations ───────────────────────────────────────────────────────────

function renderRecommendations(installedNames) {
  const installed = new Set(installedNames);
  const available = RECOMMENDED_MODELS.filter(m => !installed.has(m.name));
  const select    = document.getElementById('recommended-models');

  if (!available.length) {
    select.innerHTML = '<option value="">— Todos os modelos recomendados já estão instalados —</option>';
    return;
  }

  select.innerHTML = '<option value="">— Selecione um modelo para baixar —</option>';
  for (const m of available) {
    const opt = document.createElement('option');
    opt.value = m.name;
    opt.textContent = `${m.name} (${m.params} · ${m.vram}) — ${m.desc}`;
    select.appendChild(opt);
  }
}

// ── Pull ──────────────────────────────────────────────────────────────────────

async function pullModel() {
  const input     = document.getElementById('pull-model-input');
  const modelName = input.value.trim();
  if (!modelName) return showFeedback('Selecione ou insira o nome do modelo antes de baixar.', true);

  const btn         = document.getElementById('pull-model-btn');
  const progressEl  = document.getElementById('pull-progress');
  const statusText  = document.getElementById('pull-status-text');
  const progressBar = document.getElementById('pull-progress-bar');
  const bytesText   = document.getElementById('pull-bytes-text');

  btn.disabled             = true;
  progressEl.style.display = 'block';
  progressBar.style.width  = '0%';
  statusText.textContent   = 'Conectando ao Ollama Hub…';
  bytesText.textContent    = '';

  try {
    const res = await fetch('/api/models/pull', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ model: modelName }),
    });

    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      throw new Error(d.message || `HTTP ${res.status}`);
    }

    const reader  = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer    = '';
    let success   = false;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        let data;
        try { data = JSON.parse(line.slice(6)); } catch { continue; }

        if (data.error) throw new Error(data.error);

        statusText.textContent = data.status || '';

        if (data.total && data.completed !== undefined) {
          const pct  = Math.min(100, Math.round((data.completed / data.total) * 100));
          const dlGB = (data.completed / 1e9).toFixed(2);
          const toGB = (data.total     / 1e9).toFixed(2);
          progressBar.style.width = `${pct}%`;
          bytesText.textContent   = `${dlGB} GB / ${toGB} GB`;
        }

        if (data.status === 'success') {
          success = true;
          progressBar.style.width = '100%';
          statusText.textContent  = 'Download concluído!';
          bytesText.textContent   = '';
          showFeedback(`Modelo "${modelName}" baixado com sucesso!`);

          // refresh installed list and recommendations
          const installed = await loadModels();
          renderRecommendations(installed);

          // auto-select the new model in #model
          ensureModelOption(modelName);
          document.getElementById('model').value = modelName;

          // clear pull input and recommendations select
          input.value = '';
          document.getElementById('recommended-models').value = '';
        }
      }
    }

    if (!success) showFeedback(`Download finalizado. Verifique se "${modelName}" aparece na lista de instalados.`);
  } catch (err) {
    showFeedback(err.message || 'Erro durante o download.', true);
  } finally {
    btn.disabled = false;
    setTimeout(() => { progressEl.style.display = 'none'; }, 4000);
  }
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
  document.getElementById('model').value          = config.model          || '';
  document.getElementById('temperature').value    = config.temperature    ?? '';
  document.getElementById('top_p').value          = config.top_p          ?? '';
  document.getElementById('top_k').value          = config.top_k          ?? '';
  document.getElementById('min_p').value          = config.min_p          ?? '';
  document.getElementById('tfs_z').value          = config.tfs_z          ?? '';
  document.getElementById('repeat_penalty').value = config.repeat_penalty ?? '';
  document.getElementById('repeat_last_n').value  = config.repeat_last_n  ?? '';
  document.getElementById('context_size').value      = config.context_size      ?? '';
  document.getElementById('num_ctx_messages').value  = config.num_ctx_messages  ?? '';
  document.getElementById('min_tokens').value        = config.min_tokens        ?? '';
  document.getElementById('memory_interval').value   = config.memory_interval   ?? 5;
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

  const config = {
    model:            document.getElementById('model').value.trim(),
    temperature:      parseFloat(document.getElementById('temperature').value)    || null,
    top_p:            parseFloat(document.getElementById('top_p').value)          || null,
    top_k:            parseInt(document.getElementById('top_k').value)            || null,
    min_p:            parseFloat(document.getElementById('min_p').value)          || null,
    tfs_z:            parseFloat(document.getElementById('tfs_z').value)          || null,
    repeat_penalty:   parseFloat(document.getElementById('repeat_penalty').value) || null,
    repeat_last_n:    parseInt(document.getElementById('repeat_last_n').value)    || null,
    context_size:     parseInt(document.getElementById('context_size').value)     || null,
    num_ctx_messages: parseInt(document.getElementById('num_ctx_messages').value) || null,
    min_tokens:       parseInt(document.getElementById('min_tokens').value)       || null,
    max_tokens:       parseInt(document.getElementById('max_tokens').value)       || null,
    memory_interval:  parseInt(document.getElementById('memory_interval').value)  || 5,
    stream:           parseInt(document.getElementById('stream').value)           || null,
    seed:             parseInt(document.getElementById('seed').value)             || -1,
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
    showFeedback('Configuração salva com sucesso!');
  } catch (err) {
    showFeedback(err.message || 'Erro ao salvar configuração.', true);
  }
}

// ── Init ──────────────────────────────────────────────────────────────────────

window.addEventListener('load', async () => {
  await loadSidebar();

  // load models first so #model select is populated before fillForm runs
  const [installedNames] = await Promise.all([loadModels(), loadPresets(), loadConfig()]);
  renderRecommendations(installedNames);

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

  // selecting a recommendation fills the pull input
  document.getElementById('recommended-models').addEventListener('change', (e) => {
    if (e.target.value) document.getElementById('pull-model-input').value = e.target.value;
  });

  document.getElementById('pull-model-btn').addEventListener('click', pullModel);
  form.addEventListener('submit', handleSubmit);

  document.querySelectorAll('[data-bs-toggle="tooltip"]').forEach(
    (el) => new bootstrap.Tooltip(el)
  );
});
