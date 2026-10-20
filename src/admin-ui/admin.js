'use strict';
(function () {
  const RT_KEY = 'cl_admin_rt';
  const REASONS = ['spam', 'offensive', 'copyright', 'other'];
  const VIS_LABEL = { visible: 'Visible', auto_hidden: 'Auto-hidden', taken_down: 'Taken down', deleted: 'Deleted' };

  const $ = (id) => document.getElementById(id);
  const state = { cfg: null, idToken: null, refreshToken: null, expiresAt: 0, email: '', selected: null, timer: null };

  // ── tiny DOM helper: text only, never innerHTML, so user content cannot inject markup ──
  function el(tag, props, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) n.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    return n;
  }
  const clear = (n) => { while (n.firstChild) n.removeChild(n.firstChild); return n; };

  function ago(iso) {
    if (!iso) return '';
    const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + 'm ago';
    if (s < 86400) return Math.floor(s / 3600) + 'h ago';
    return Math.floor(s / 86400) + 'd ago';
  }
  const fullDate = (iso) => (iso ? new Date(iso).toLocaleString() : '');
  const posterUrl = (p) => (!p ? null : /^https?:\/\//.test(p) ? p : p.startsWith('/') ? 'https://image.tmdb.org/t/p/w185' + p : null);

  let toastTimer;
  function toast(msg, bad) {
    const t = $('toast');
    t.textContent = msg;
    t.className = 'toast' + (bad ? ' bad' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.add('hidden'), 3500);
  }

  // ── auth (Firebase email + password over REST) ──
  async function googleCall(url, body, asForm) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': asForm ? 'application/x-www-form-urlencoded' : 'application/json' },
      body: asForm ? new URLSearchParams(body).toString() : JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error?.message || 'Sign-in failed');
    return data;
  }
  function setSession({ idToken, refreshToken, expiresIn }) {
    state.idToken = idToken;
    state.refreshToken = refreshToken;
    state.expiresAt = Date.now() + Number(expiresIn || 3600) * 1000;
    try { sessionStorage.setItem(RT_KEY, refreshToken); } catch (_) { /* storage can be blocked */ }
  }
  async function signIn(email, password) {
    const d = await googleCall(
      'https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=' + encodeURIComponent(state.cfg.apiKey),
      { email, password, returnSecureToken: true },
    );
    if (!d.idToken) throw new Error('This account needs a second sign-in step, which this panel does not support yet.');
    state.email = d.email || email;
    setSession({ idToken: d.idToken, refreshToken: d.refreshToken, expiresIn: d.expiresIn });
  }
  async function refresh() {
    if (!state.refreshToken) throw new Error('Signed out');
    const d = await googleCall(
      'https://securetoken.googleapis.com/v1/token?key=' + encodeURIComponent(state.cfg.apiKey),
      { grant_type: 'refresh_token', refresh_token: state.refreshToken }, true,
    );
    setSession({ idToken: d.id_token, refreshToken: d.refresh_token, expiresIn: d.expires_in });
  }
  function signOut() {
    state.idToken = state.refreshToken = null;
    state.selected = null;
    clearInterval(state.timer);
    try { sessionStorage.removeItem(RT_KEY); } catch (_) { /* ignore */ }
    $('app').classList.add('hidden');
    $('login').classList.remove('hidden');
    $('password').value = '';
  }

  // ── API ──
  async function api(path, opts = {}, retried = false) {
    if (Date.now() > state.expiresAt - 60000) await refresh();
    const res = await fetch(state.cfg.apiBase + '/admin/moderation' + path, {
      method: opts.method || 'GET',
      headers: { Authorization: 'Bearer ' + state.idToken, 'Content-Type': 'application/json' },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    if (res.status === 401 && !retried) { await refresh(); return api(path, opts, true); }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error?.userMessage || data.error?.message || data.error || 'Request failed (' + res.status + ')');
      err.status = res.status;
      throw err;
    }
    return data.data;
  }

  // ── queue ──
  async function loadQueue() {
    try {
      const { items, total } = await api('/queue?limit=100');
      $('queue-count').textContent = total ? String(total) : '';
      $('queue-meta').textContent = total ? total + ' open report' + (total === 1 ? '' : ' groups') : 'Nothing to review';
      const box = clear($('queue-list'));
      if (!items.length) box.append(el('div', { class: 'empty', text: 'The queue is empty. Nice.' }));
      items.forEach((q) => {
        box.append(el('button', {
          class: 'queue-item' + (q.watchlistId === state.selected ? ' active' : ''),
          onclick: () => openDetail(q.watchlistId),
        },
        el('div', { class: 'row' }, el('span', { class: 'name', text: q.name || '(untitled)' }), el('span', { class: 'count', text: q.openReportCount + ' report' + (q.openReportCount === 1 ? '' : 's') })),
        el('div', { class: 'chips' },
          el('span', { class: 'chip ' + q.visibility, text: VIS_LABEL[q.visibility] || q.visibility }),
          q.topReason && el('span', { class: 'chip', text: q.topReason }),
          el('span', { class: 'muted small', text: ago(q.lastReportAt) }))));
      });
    } catch (e) { handleError(e); }
  }

  // ── detail ──
  async function openDetail(id) {
    state.selected = id;
    document.querySelectorAll('.queue-item').forEach((n) => n.classList.remove('active'));
    try { renderDetail(await api('/lists/' + encodeURIComponent(id))); loadQueue(); } catch (e) { handleError(e); }
  }

  function renderDetail(d) {
    const box = clear($('detail'));
    const l = d.list;
    const openReports = d.reports.filter((r) => r.status === 'open').length;
    box.append(
      el('h2', { text: l ? l.name || '(untitled)' : '(list deleted)' }),
      el('div', { class: 'chips' },
        el('span', { class: 'chip ' + d.visibility, text: VIS_LABEL[d.visibility] || d.visibility }),
        l && el('span', { class: 'muted small', text: 'by ' + (l.ownerName || l.ownerId) + ' · ' + l.itemCount + ' titles' }),
        l && l.tags.map((t) => el('span', { class: 'chip', text: '#' + t }))),
      l && l.description && el('p', { text: l.description }),
    );
    if (l) {
      const posters = (l.items.length ? l.items.map((i) => i.poster) : l.previewPosters).map(posterUrl).filter(Boolean);
      if (posters.length) box.append(el('div', { class: 'posters' }, posters.map((u) => el('img', { class: 'poster', src: u, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' }))));
      if (l.items.length) box.append(el('ul', { class: 'items' }, l.items.map((i) => el('li', { text: i.title + (i.year ? ' (' + i.year + ')' : '') }))));
      if (l.moderation && l.moderation.status !== 'visible') {
        box.append(el('p', { class: 'muted small', text: 'Last decision: ' + l.moderation.status + (l.moderation.reason ? ' (' + l.moderation.reason + ')' : '') + ' by ' + l.moderation.by + ', ' + ago(l.moderation.at) }));
      }
    }

    box.append(el('h3', { text: 'Reports (' + d.reports.length + ')' }));
    if (!d.reports.length) box.append(el('p', { class: 'muted', text: 'No reports.' }));
    d.reports.forEach((r) => box.append(el('div', { class: 'entry' },
      el('div', null, el('strong', { text: r.reason }), ' ', el('span', { class: 'muted small', text: r.status + ' · ' + ago(r.createdAt) + ' · ' + r.reporterId })),
      r.note && el('div', { class: 'note', text: r.note }))));

    box.append(el('h3', { text: 'History' }));
    if (!d.history.length) box.append(el('p', { class: 'muted', text: 'No decisions yet.' }));
    d.history.forEach((h) => box.append(el('div', { class: 'entry' },
      el('div', null, el('strong', { text: h.action }), ' ', el('span', { class: 'muted small', text: 'by ' + (h.actorType === 'system' ? 'system' : h.actorId) + ' · ' + fullDate(h.createdAt) })),
      (h.reason || h.note) && el('div', { class: 'note', text: [h.reason, h.note].filter(Boolean).join(': ') }))));

    box.append(actionsBlock(d, openReports));
  }

  function actionsBlock(d, openReports) {
    const reason = el('select', null, REASONS.map((r) => el('option', { value: r, text: r })));
    const note = el('textarea', { maxlength: '500', placeholder: 'Optional note for the audit log' });
    const canTakedown = d.visibility === 'visible';
    const canRestore = d.visibility !== 'visible' && d.visibility !== 'deleted';
    const canDismiss = openReports > 0;

    const run = (kind, label, needsReason) => async (ev) => {
      const btn = ev.currentTarget;
      btn.disabled = true;
      try {
        const body = { note: note.value };
        if (needsReason) body.reason = reason.value;
        const out = await api('/lists/' + encodeURIComponent(d.watchlistId) + '/' + kind, { method: 'POST', body });
        toast(label + ' done: ' + out.reportsResolved + ' report(s) resolved');
        await openDetail(d.watchlistId);
      } catch (e) { btn.disabled = false; handleError(e); }
    };

    return el('div', { class: 'actions' },
      el('h3', { text: 'Decision' }),
      el('div', { class: 'form-row' },
        el('label', null, 'Reason (takedown)', reason),
        el('label', null, 'Note', note)),
      el('div', { class: 'btns' },
        el('button', { class: 'btn danger', disabled: !canTakedown, onclick: run('takedown', 'Takedown', true), text: 'Take down' }),
        el('button', { class: 'btn', disabled: !canRestore, onclick: run('restore', 'Restore', false), text: 'Restore' }),
        el('button', { class: 'btn', disabled: !canDismiss, onclick: run('dismiss', 'Dismiss', false), text: 'Dismiss reports' })),
      el('p', { class: 'muted small', text: 'Dismiss means the reports were wrong. An auto-hidden list comes back; a manual takedown stays hidden until you restore it.' }));
  }

  // ── audit ──
  async function loadAudit() {
    const body = clear($('audit-body'));
    try {
      const { items } = await api('/audit?limit=100');
      if (!items.length) { body.append(el('div', { class: 'empty', text: 'No decisions recorded yet.' })); return; }
      body.append(el('table', null,
        el('thead', null, el('tr', null, ['When', 'Action', 'List', 'By', 'Reason / note', 'Reports'].map((h) => el('th', { text: h })))),
        el('tbody', null, items.map((a) => el('tr', null,
          el('td', { text: fullDate(a.createdAt) }),
          el('td', { text: a.action }),
          el('td', null, el('a', { href: '#', text: a.watchlistId, onclick: (e) => { e.preventDefault(); showTab('queue'); openDetail(a.watchlistId); } })),
          el('td', { text: a.actorType === 'system' ? 'system' : a.actorId }),
          el('td', { text: [a.reason, a.note].filter(Boolean).join(': ') }),
          el('td', { text: String(a.reportCount) }))))));
    } catch (e) {
      if (e.status === 403) body.append(el('div', { class: 'empty', text: 'The audit log is for admins only.' }));
      else handleError(e);
    }
  }

  function showTab(name) {
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
    $('view-queue').classList.toggle('hidden', name !== 'queue');
    $('view-audit').classList.toggle('hidden', name !== 'audit');
    if (name === 'audit') loadAudit(); else loadQueue();
  }

  function handleError(e) {
    if (e.status === 403) toast('Your account is not a moderator. Ask an admin for access.', true);
    else if (e.message === 'Signed out' || /TOKEN_EXPIRED|INVALID_REFRESH_TOKEN|USER_NOT_FOUND|USER_DISABLED/.test(e.message)) { signOut(); $('login-error').textContent = 'Session ended. Please sign in again.'; }
    else toast(e.message || 'Something went wrong', true);
  }

  // ── boot ──
  function enterApp() {
    $('login').classList.add('hidden');
    $('app').classList.remove('hidden');
    $('who').textContent = state.email;
    showTab('queue');
    clearInterval(state.timer);
    state.timer = setInterval(() => { if (!document.hidden && !$('view-queue').classList.contains('hidden')) loadQueue(); }, 60000);
  }

  async function boot() {
    try { state.cfg = await (await fetch('config.json', { cache: 'no-store' })).json(); }
    catch (_) { document.body.textContent = 'Admin panel is not available.'; return; }

    $('login-form').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      $('login-error').textContent = '';
      $('login-btn').disabled = true;
      try { await signIn($('email').value.trim(), $('password').value); enterApp(); }
      catch (e) { $('login-error').textContent = /INVALID|EMAIL_NOT_FOUND|CREDENTIAL/.test(e.message) ? 'Wrong email or password.' : e.message; }
      finally { $('login-btn').disabled = false; }
    });
    $('signout').addEventListener('click', signOut);
    $('refresh').addEventListener('click', loadQueue);
    document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => showTab(t.dataset.tab)));

    let rt = null;
    try { rt = sessionStorage.getItem(RT_KEY); } catch (_) { /* ignore */ }
    if (rt) {
      state.refreshToken = rt;
      try {
        await refresh();
        state.email = '';
        enterApp();
        return;
      } catch (_) { signOut(); }
    }
    $('login').classList.remove('hidden');
  }
  boot();
})();
