async function loadStatus() {
  try {
    const res  = await fetch('/api/status');
    if (!res.ok) throw new Error('Falha na requisição');
    const data = await res.json();

    document.getElementById('llama-status').querySelector('div > div:last-child').innerHTML =
      `<span style="color:${data.llama.ok ? '#86efac' : '#fda4af'}">
         <i class="bi bi-${data.llama.ok ? 'check-circle-fill' : 'x-circle-fill'} me-1"></i>${data.llama.message}
       </span>`;

    document.getElementById('db-status').querySelector('div > div:last-child').innerHTML =
      `<span style="color:${data.database.ok ? '#86efac' : '#fda4af'}">
         <i class="bi bi-${data.database.ok ? 'check-circle-fill' : 'x-circle-fill'} me-1"></i>${data.database.message}
       </span>`;

    if (data.llama.ok && data.database.ok) {
      setTimeout(() => { window.location.href = '/'; }, 1500);
    }
  } catch (err) {
    ['llama-status', 'db-status'].forEach((id) => {
      document.getElementById(id).querySelector('div > div:last-child').innerHTML =
        `<span style="color:#fda4af"><i class="bi bi-x-circle-fill me-1"></i>Erro ao obter status</span>`;
    });
  }
}

window.addEventListener('load', loadStatus);
