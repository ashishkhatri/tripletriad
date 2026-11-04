'use strict';
/* Triad admin page: accounts list + editor, and a SQL console. */
(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const when = (t) => {
    if (!t) return '—';
    const d = Date.now() - t;
    if (d < 6e4) return 'just now';
    if (d < 36e5) return `${Math.round(d / 6e4)} min ago`;
    if (d < 864e5) return `${Math.round(d / 36e5)} h ago`;
    if (d < 30 * 864e5) return `${Math.round(d / 864e5)} d ago`;
    return new Date(t).toLocaleDateString();
  };

  let toastT;
  function toast(msg, err) {
    const t = $('#toast');
    t.textContent = msg; t.className = 'toast' + (err ? ' err' : ''); t.hidden = false;
    clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, err ? 5000 : 2200);
  }
  async function api(method, url, body) {
    const r = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined, credentials: 'same-origin' });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(j.error || `Error ${r.status}`); e.status = r.status; throw e; }
    return j;
  }

  // ---------- tabs ----------
  $$('.tabs button').forEach((b) => b.onclick = () => {
    $$('.tabs button').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
    $$('.tab').forEach((t) => { t.hidden = t.id !== `tab-${b.dataset.tab}`; });
    if (b.dataset.tab === 'sql') loadSchema();
  });

  // ---------- accounts ----------
  let users = [], sortK = 'lastSeen', sortAsc = false, current = null, detail = null;
  async function loadUsers() {
    try {
      const r = await api('GET', '/api/admin/users');
      users = r.users;
      $('#dbinfo').textContent = r.mode === 'sqlite' ? `SQLite · ${r.file}` : `JSON fallback · ${r.file} (update Node to 22.13+ for SQLite)`;
      renderUsers();
    } catch (e) {
      if (e.status === 401 || e.status === 403) { $('#denied').hidden = false; $$('.tab').forEach((t) => { t.hidden = true; }); $('.tabs').hidden = true; }
      else toast(e.message, true);
    }
  }
  function renderUsers() {
    const q = $('#search').value.trim().toLowerCase();
    const list = users.filter((u) => !q || u.name.toLowerCase().includes(q))
      .sort((a, b) => {
        const x = a[sortK] ?? 0, y = b[sortK] ?? 0;
        const c = typeof x === 'string' ? x.localeCompare(y) : x - y;
        return sortAsc ? c : -c;
      });
    $('#count').textContent = `${list.length} of ${users.length} accounts`;
    $$('#users th').forEach((th) => { th.classList.toggle('sorted', th.dataset.k === sortK); th.classList.toggle('asc', th.dataset.k === sortK && sortAsc); });
    $('#users tbody').innerHTML = list.map((u) => `<tr data-key="${esc(u.key)}" class="${current === u.key ? 'sel' : ''}">
      <td>${esc(u.name)}${u.admin ? '<span class="badge">ADMIN</span>' : ''}</td>
      <td class="n">${u.level}</td><td class="n">${u.xp}</td><td class="n">${u.shards}</td><td class="n">${u.packs}</td>
      <td class="n">${u.cards}</td><td class="n">${u.games}</td><td class="n">${u.wins}</td>
      <td title="${u.lastSeen ? new Date(u.lastSeen).toLocaleString() : ''}">${when(u.lastSeen)}</td>
      <td title="${u.created ? new Date(u.created).toLocaleString() : ''}">${u.created ? new Date(u.created).toLocaleDateString() : '—'}</td></tr>`).join('');
  }
  $('#search').oninput = renderUsers;
  $$('#users th').forEach((th) => th.onclick = () => {
    if (sortK === th.dataset.k) sortAsc = !sortAsc; else { sortK = th.dataset.k; sortAsc = th.dataset.k === 'name'; }
    renderUsers();
  });
  $('#users tbody').onclick = (e) => { const tr = e.target.closest('tr'); if (tr) openUser(tr.dataset.key); };

  async function openUser(key) {
    try {
      detail = await api('GET', `/api/admin/user?key=${encodeURIComponent(key)}`);
      current = key;
      renderDetail();
      renderUsers();
    } catch (e) { toast(e.message, true); }
  }
  function closeUser() { current = null; detail = null; $('#detail').hidden = true; $('.split').classList.remove('open'); renderUsers(); }
  $('#d-close').onclick = closeUser;

  function renderDetail(keepSet) {
    const d = detail;
    $('#detail').hidden = false; $('.split').classList.add('open');
    $('#d-name').innerHTML = esc(d.name) + (d.admin ? '<span class="badge">ADMIN</span>' : '');
    $('#d-sub').textContent = `Level ${d.level} · ${d.packs} pack${d.packs === 1 ? '' : 's'} to open · ${d.games} games, ${d.wins} wins · ${d.sessions} active sign-in${d.sessions === 1 ? '' : 's'} · joined ${d.created ? new Date(d.created).toLocaleDateString() : '—'}`;
    const f = $('#d-form');
    for (const k of ['name', 'xp', 'shards', 'bonusPacks', 'packsOpened', 'levelClaimed']) f.elements[k].value = d[k];
    f.elements.admin.checked = d.admin;
    $('#d-calc').textContent = '';
    const setIds = Object.keys(d.sets);
    const prev = keepSet && $('#d-set').value;
    $('#d-set').innerHTML = setIds.map((id) => `<option value="${esc(id)}">${esc(d.sets[id].name)}</option>`).join('') || '<option value="">No sets yet</option>';
    if (prev && d.sets[prev]) $('#d-set').value = prev;
    const missing = d.decks.filter((x) => !d.sets[x.id]);
    $('#d-addset-row').hidden = !missing.length;
    $('#d-addset').innerHTML = missing.map((x) => `<option value="${esc(x.id)}">${esc(x.name)}</option>`).join('');
    renderCards();
    $('#d-levels').textContent = Object.keys(d.levelLog).length ? Object.entries(d.levelLog).map(([l, e]) => `Level ${l}: ${e.kind}${e.shards ? ` (${e.shards} shards)` : ''}${e.packs ? ` (${e.packs} pack)` : ''}${e.cards && e.cards.length ? ` · ${e.deck}: ${e.cards.map((c) => `#${c.id}${c.foil ? ' foil' : ''}`).join(', ')}` : ''}`).join('\n') : 'None yet.';
    $('#d-daily').textContent = d.daily ? JSON.stringify(d.daily, null, 2) : 'None yet.';
  }
  function renderCards() {
    const set = detail && detail.sets[$('#d-set').value];
    const q = $('#d-cardq').value.trim().toLowerCase(), ownedOnly = $('#d-owned').checked;
    const rows = set ? set.cards.filter((c) => (!ownedOnly || c.normal || c.foil) && (!q || c.name.toLowerCase().includes(q) || String(c.id) === q)) : [];
    $('#d-cards tbody').innerHTML = rows.map((c) => `<tr class="${c.normal || c.foil ? '' : 'zero'}" data-id="${c.id}">
      <td class="n">${c.id}</td><td>${esc(c.name)}</td><td class="n">${c.level}</td>
      <td class="n"><input type="number" min="0" max="999" data-k="normal" value="${c.normal}"></td>
      <td class="n"><input type="number" min="0" max="999" data-k="foil" value="${c.foil}"></td></tr>`).join('')
      || `<tr><td colspan="5" class="muted">${set ? 'No cards match.' : 'This account has no sets yet.'}</td></tr>`;
  }
  $('#d-set').onchange = renderCards;
  $('#d-cardq').oninput = renderCards;
  $('#d-owned').onchange = renderCards;
  $('#d-cards tbody').addEventListener('change', async (e) => {
    const inp = e.target.closest('input'); if (!inp) return;
    const tr = inp.closest('tr');
    try {
      detail = await api('POST', '/api/admin/cards', { key: current, deck: $('#d-set').value, card: Number(tr.dataset.id), [inp.dataset.k]: Number(inp.value) });
      const y = $('#d-cards').parentElement.scrollTop;
      renderDetail(true); $('#d-cards').parentElement.scrollTop = y;
      toast('Collection saved.');
      loadUsers();
    } catch (err) { toast(err.message, true); }
  });
  $('#d-addset-btn').onclick = async () => {
    try { detail = await api('POST', '/api/admin/addset', { key: current, deck: $('#d-addset').value }); const id = $('#d-addset').value; renderDetail(); $('#d-set').value = id; renderCards(); loadUsers(); toast('Set started.'); }
    catch (e) { toast(e.message, true); }
  };

  $('#d-form').onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target, fields = {};
    for (const k of ['name', 'xp', 'shards', 'bonusPacks', 'packsOpened', 'levelClaimed']) if (String(f.elements[k].value) !== String(detail[k])) fields[k] = f.elements[k].value;
    if (f.elements.admin.checked !== detail.admin) fields.admin = f.elements.admin.checked;
    if (!Object.keys(fields).length) return toast('Nothing changed.');
    try { detail = await api('POST', '/api/admin/user', { key: current, fields }); renderDetail(true); loadUsers(); toast('Saved.'); }
    catch (err) { toast(err.message, true); }
  };
  $('#d-pass-btn').onclick = async () => {
    const pw = $('#d-pass').value;
    try { await api('POST', '/api/admin/password', { key: current, password: pw }); $('#d-pass').value = ''; toast(`Password changed for ${detail.name}.`); }
    catch (e) { toast(e.message, true); }
  };
  $('#d-signout').onclick = async () => {
    try { await api('POST', '/api/admin/signout', { key: current }); await openUser(current); toast('Signed out on every device.'); }
    catch (e) { toast(e.message, true); }
  };
  $('#d-delete').onclick = async () => {
    if (prompt(`This permanently deletes ${detail.name} and their whole collection. Type the name to confirm:`) !== detail.name) return;
    try { await api('POST', '/api/admin/delete', { key: current }); closeUser(); await loadUsers(); toast('Account deleted.'); }
    catch (e) { toast(e.message, true); }
  };

  // ---------- SQL ----------
  const PRESETS = [
    ['All accounts', 'SELECT key, name, is_admin, xp, shards, bonus_packs, packs_opened, level_claimed, datetime(created/1000, \'unixepoch\') AS joined, datetime(last_seen/1000, \'unixepoch\') AS last_seen FROM users ORDER BY xp DESC;'],
    ['Cards owned per account', 'SELECT user, deck, SUM(normal) AS normal, SUM(foil) AS foil, COUNT(*) AS different FROM user_cards GROUP BY user, deck ORDER BY user, deck;'],
    ['One account\'s collection', "SELECT deck, card, normal, foil FROM user_cards WHERE user = 'ashishduh' ORDER BY deck, card;"],
    ['Win rates', 'SELECT user, SUM(games) AS games, SUM(wins) AS wins, ROUND(100.0 * SUM(wins) / MAX(SUM(games), 1), 1) AS win_pct FROM user_sets GROUP BY user ORDER BY games DESC;'],
    ['Give everyone 100 shards', 'UPDATE users SET shards = COALESCE(shards, 0) + 100;'],
    ['Active sign-ins', "SELECT user, COUNT(*) AS devices, datetime(MAX(expires)/1000, 'unixepoch') AS latest_expiry FROM sessions WHERE expires > strftime('%s','now')*1000 GROUP BY user;"],
    ['Level rewards claimed', 'SELECT user, level, kind, deck, shards, packs, cards FROM level_log ORDER BY user, level;'],
  ];
  $('#sql-presets').innerHTML += PRESETS.map(([n], i) => `<option value="${i}">${esc(n)}</option>`).join('');
  $('#sql-presets').onchange = (e) => { if (e.target.value !== '') $('#sql').value = PRESETS[e.target.value][1]; e.target.value = ''; $('#sql').focus(); };

  let schemaLoaded = false;
  async function loadSchema() {
    if (schemaLoaded) return;
    try {
      const r = await api('GET', '/api/admin/tables');
      if (r.mode !== 'sqlite') { $('#schema').textContent = 'SQL needs the SQLite database (Node 22.13 or newer).'; return; }
      $('#schema').innerHTML = r.tables.map((t) => `<div><b data-t="${esc(t.name)}">${esc(t.name)}</b><br>${t.columns.map(esc).join(', ')}</div>`).join('');
      schemaLoaded = true;
    } catch (e) { toast(e.message, true); }
  }
  $('#schema').onclick = (e) => { const b = e.target.closest('b'); if (b) { $('#sql').value = `SELECT * FROM ${b.dataset.t} LIMIT 100;`; runSql(); } };

  async function runSql() {
    const text = $('#sql').value;
    if (/\b(delete|drop|update)\b/i.test(text) && !/\bwhere\b/i.test(text)) {
      if (!confirm('This changes or deletes rows without a WHERE clause, so it affects every row. Run it?')) return;
    }
    $('#sql-msg').textContent = 'Running…';
    try {
      const r = await api('POST', '/api/admin/sql', { sql: text });
      const head = $('#sql-out thead'), body = $('#sql-out tbody');
      head.innerHTML = r.columns.length ? `<tr>${r.columns.map((c) => `<th>${esc(c)}</th>`).join('')}</tr>` : '';
      body.innerHTML = r.rows.map((row) => `<tr>${row.map((v) => v === null ? '<td class="null">NULL</td>' : `<td title="${esc(v)}">${esc(v)}</td>`).join('')}</tr>`).join('');
      const parts = [];
      if (r.columns.length) parts.push(`${r.total ?? r.rows.length} row${(r.total ?? r.rows.length) === 1 ? '' : 's'}${r.total > r.rows.length ? ` (showing ${r.rows.length})` : ''}`);
      if (r.changes) parts.push(`${r.changes} row${r.changes === 1 ? '' : 's'} changed`);
      $('#sql-msg').textContent = parts.join(' · ') || 'Done.';
      if (r.changes) { loadUsers(); if (current) openUser(current); }
    } catch (e) { $('#sql-msg').textContent = ''; toast(e.message, true); }
  }
  $('#sql-run').onclick = runSql;
  $('#sql').onkeydown = (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); runSql(); } };

  loadUsers();
})();
