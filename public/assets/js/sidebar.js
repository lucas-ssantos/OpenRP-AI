function sidebarEscHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

async function populateRecentChars() {
  try {
    const res = await fetch('/api/characters/recent');
    if (!res.ok) return;
    const data = await res.json();
    if (!data.ok || !data.characters.length) return;

    const html = data.characters.map(char => {
      const avatar = char.avatar_url
        ? `<img class="recent-char-avatar" src="${sidebarEscHtml(char.avatar_url)}" alt="" />`
        : `<span class="recent-char-placeholder"><i class="bi bi-person-fill"></i></span>`;
      return `<a class="recent-char-link" href="/character/${sidebarEscHtml(char.id)}">${avatar}<span class="recent-char-name">${sidebarEscHtml(char.name)}</span></a>`;
    }).join('');

    document.querySelectorAll('.recent-chars-list').forEach(el => {
      el.innerHTML = html;
    });
  } catch { /* silent */ }
}

async function loadSidebar() {
  const res = await fetch('/sidebar.html');
  document.getElementById('sidebar-root').innerHTML = await res.text();
  document.querySelectorAll('.nav-links a').forEach(link => {
    if (link.dataset.path === window.location.pathname) link.classList.add('active');
  });
  await populateRecentChars();
}
