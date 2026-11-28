'use strict';
// Admin panel: "Author's choice" tab. Needs window.__admin (set by admin.js).
(function () {
  const A = () => window.__admin;
  const NOTE_MAX = 140;
  let picks = [];
  let max = 100;
  let searchType = 'movie';
  let results = [];
  let searched = false;

  const body = () => document.getElementById('picks-body');

  function thumb(path) {
    const u = A().posterUrl(path);
    return A().el('div', { class: 'pick-thumb' }, u && A().el('img', { src: u, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' }));
  }

  async function load() {
    try {
      const d = await A().call('/admin/picks');
      picks = d.items || [];
      max = d.max || 100;
      render();
    } catch (e) {
      if (e.status === 403) {
        A().clear(body()).append(A().el('div', { class: 'empty', text: "Author's choice is for admins only." }));
      } else {
        A().clear(body()).append(A().el('div', { class: 'empty', text: "Could not load Author's choice." }));
        A().handleError(e);
      }
    }
  }

  async function search(q) {
    if (!q.trim()) return;
    try {
      const d = await A().call('/admin/picks/search?q=' + encodeURIComponent(q.trim()) + '&type=' + searchType);
      results = d.results || [];
      searched = true;
      render(q);
    } catch (e) { A().handleError(e); }
  }

  async function add(r) {
    try {
      await A().call('/admin/picks', { method: 'POST', body: { type: r.type, tmdbId: r.tmdbId, title: r.title, posterPath: r.posterPath || '', year: r.year || '' } });
      A().toast('Added "' + r.title + '"');
      results = results.filter((x) => !(x.type === r.type && x.tmdbId === r.tmdbId));
      await load();
    } catch (e) { A().handleError(e); }
  }

  async function saveNote(p, value, btn) {
    btn.disabled = true;
    try {
      await A().call('/admin/picks/' + encodeURIComponent(p.id), { method: 'PATCH', body: { note: value } });
      p.note = value.trim();
      A().toast('Note saved');
    } catch (e) { A().handleError(e); } finally { btn.disabled = false; }
  }

  async function remove(p) {
    if (!window.confirm('Remove "' + p.title + '" from Author\'s choice?')) return;
    try { await A().call('/admin/picks/' + encodeURIComponent(p.id), { method: 'DELETE' }); await load(); }
    catch (e) { A().handleError(e); }
  }

  async function move(index, dir) {
    const to = index + dir;
    if (to < 0 || to >= picks.length) return;
    const next = picks.slice();
    [next[index], next[to]] = [next[to], next[index]];
    try {
      await A().call('/admin/picks/reorder', { method: 'POST', body: { ids: next.map((p) => p.id) } });
      picks = next;
      render();
    } catch (e) { A().handleError(e); }
  }

  function render(lastQuery) {
    const { el, clear } = A();
    const root = clear(body());
    const q = el('input', { type: 'search', class: 'pick-q', placeholder: 'Search a title to add…', value: lastQuery || '', maxlength: '100' });
    const go = () => search(q.value);
    q.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') go(); });
    const typeBtn = (t, label) => el('button', { class: 'btn small' + (searchType === t ? ' primary' : ''), onclick: () => { searchType = t; results = []; searched = false; render(q.value); } , text: label });

    root.append(el('div', { class: 'card section' },
      el('h3', { text: 'Add a title' }),
      el('div', { class: 'pick-search' }, typeBtn('movie', 'Movie'), typeBtn('tv', 'Series'), q, el('button', { class: 'btn small primary', onclick: go, text: 'Search' })),
      searched && !results.length && el('div', { class: 'muted small', text: 'No results.' }),
      results.map((r) => {
        const have = picks.some((p) => p.id === r.type + '-' + r.tmdbId);
        return el('div', { class: 'pick-row' },
          thumb(r.posterPath),
          el('div', { class: 'pick-text' }, el('div', { class: 'label', text: r.title }), el('div', { class: 'hint', text: [r.year, r.type === 'tv' ? 'Series' : 'Movie'].filter(Boolean).join(' · ') })),
          have ? el('span', { class: 'chip', text: 'Added' }) : el('button', { class: 'btn small primary', onclick: () => add(r), text: 'Add' }));
      })));

    root.append(el('div', { class: 'card section' },
      el('h3', { text: "Author's choice (" + picks.length + ' / ' + max + ')' }),
      !picks.length && el('div', { class: 'muted small', text: 'Nothing picked yet. Search above to add your first title.' }),
      picks.length > 0 && el('div', { class: 'muted small', text: 'Shown in this order in the app. Changes reach the app within a couple of minutes.' }),
      picks.map((p, i) => {
        const note = el('input', { type: 'text', class: 'pick-note', value: p.note || '', maxlength: String(NOTE_MAX), placeholder: 'Optional one-line note shown under the poster' });
        const save = el('button', { class: 'btn small', text: 'Save note' });
        save.addEventListener('click', () => saveNote(p, note.value, save));
        return el('div', { class: 'pick-row' },
          thumb(p.posterPath),
          el('div', { class: 'pick-text' },
            el('div', { class: 'label', text: p.title }),
            el('div', { class: 'hint', text: [p.year, p.type === 'tv' ? 'Series' : 'Movie'].filter(Boolean).join(' · ') }),
            el('div', { class: 'pick-note-row' }, note, save)),
          el('div', { class: 'pick-actions' },
            el('button', { class: 'btn small', disabled: i === 0, onclick: () => move(i, -1), 'aria-label': 'Move up', text: '↑' }),
            el('button', { class: 'btn small', disabled: i === picks.length - 1, onclick: () => move(i, 1), 'aria-label': 'Move down', text: '↓' }),
            el('button', { class: 'btn small', onclick: () => remove(p), text: 'Remove' })));
      })));
  }

  window.CineLinkPicks = { load };
  const refresh = document.getElementById('picks-refresh');
  if (refresh) refresh.addEventListener('click', load);
})();
