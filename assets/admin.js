/* ================================================================== admin ==

   The dashboard. Runs entirely in the browser, talking to:
     - Supabase  (sign-in, and the projects / media / categories tables). What
                 this page may read or change is decided by the database's own
                 rules (supabase/schema.sql), not by this file: a person who is
                 not an admin gets nothing back even if they edit this code.
     - /api/*    two small server functions that hold the Cloudinary secret:
                 one signs an upload, one deletes files.
     - Cloudinary directly, for the files themselves (never through our server).

   Everything that comes from the database is put on the page with
   textContent / DOM calls, never innerHTML, so nothing typed into a title or a
   caption can run as code.
   ========================================================================= */

(function () {
  'use strict';

  const cfg = window.OPULA_CONFIG || {};
  const app = document.getElementById('app');

  const MB = 1024 * 1024;
  const IMAGE_EXT = ['jpg', 'jpeg', 'png', 'webp', 'avif', 'gif', 'heic', 'heif'];
  const VIDEO_EXT = ['mp4', 'mov', 'webm', 'm4v'];
  const MAX_IMAGE = (cfg.maxImageMB || 10) * MB;
  const MAX_VIDEO = (cfg.maxVideoMB || 100) * MB;
  const CHUNK_AT = 40 * MB;          // larger files go up in pieces
  const CHUNK = 20 * MB;             // Cloudinary needs >= 5 MB per piece
  const CONCURRENCY = 3;             // files uploading at once

  /* ------------------------------------------------------------- helpers -- */

  function h(tag, props) {
    const el = document.createElement(tag);
    Object.keys(props || {}).forEach(function (k) {
      const v = props[k];
      if (v === null || v === undefined || v === false) return;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v);
      else if (k === 'value' || k === 'checked' || k === 'disabled' || k === 'hidden' || k === 'selected') el[k] = v;
      else if (k === 'style') el.setAttribute('style', v);
      else el.setAttribute(k, v === true ? '' : v);
    });
    for (let i = 2; i < arguments.length; i++) append(el, arguments[i]);
    return el;
  }
  function append(el, kid) {
    if (kid === null || kid === undefined || kid === false) return;
    if (Array.isArray(kid)) kid.forEach(function (k) { append(el, k); });
    else el.appendChild(typeof kid === 'object' ? kid : document.createTextNode(String(kid)));
  }
  function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); }
  function field(label, input, hint, id) {
    return h('div', { class: 'field' },
      h('label', { for: id }, label), input, hint ? h('span', { class: 'hint', text: hint }) : null);
  }

  function toast(msg, kind) {
    const box = document.getElementById('toasts');
    const t = h('div', { class: 'toast ' + (kind || ''), text: msg });
    box.appendChild(t);
    setTimeout(function () { t.remove(); }, kind === 'bad' ? 9000 : 4500);
  }

  function modal(opts) {
    return new Promise(function (resolve) {
      const back = h('div', { class: 'modal-back', role: 'presentation' });
      const done = function (v) { back.remove(); document.removeEventListener('keydown', onKey); resolve(v); };
      const onKey = function (e) { if (e.key === 'Escape') done(false); };
      const ok = h('button', { class: 'btn ' + (opts.danger ? 'btn-danger' : 'btn-gold'), type: 'button', text: opts.ok || 'OK', onclick: function () { done(true); } });
      const no = h('button', { class: 'btn btn-quiet', type: 'button', text: opts.cancel || 'Cancel', onclick: function () { done(false); } });
      back.appendChild(h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': opts.title },
        h('h3', { text: opts.title }), h('p', { class: 'muted', text: opts.body || '' }),
        h('div', { class: 'acts' }, opts.noCancel ? null : no, ok)));
      back.addEventListener('click', function (e) { if (e.target === back) done(false); });
      document.addEventListener('keydown', onKey);
      document.body.appendChild(back);
      (opts.danger ? no : ok).focus();
    });
  }

  function slugify(s) {
    return String(s).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
      .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  }

  /* Turn a failure into something a non-technical person can act on. */
  function explain(err) {
    if (!err) return 'Something went wrong.';
    const msg = err.message || String(err);
    if (err.code === '23505' || /duplicate|already exists/i.test(msg)) return 'That web address (slug) is already used by another project. Change it and save again.';
    if (err.code === '42501' || /row-level security|not an admin|permission/i.test(msg)) return 'You are not allowed to do that. Sign out and in again; if it continues, ask the site owner to check your admin access.';
    if (/Failed to fetch|NetworkError|Network error/i.test(msg)) return 'Network problem. Check your connection and try again.';
    if (err.code === '23514') return 'One of the values is not allowed (for example the web address may only use lowercase letters, numbers and dashes).';
    return msg;
  }

  /* ---------------------------------------------------------- start-up ---- */

  function notice(title, bodyKids, bad) {
    clear(app);
    app.appendChild(h('div', { class: 'login' }, h('h1', { text: title }),
      h('div', { class: 'notice' + (bad ? ' bad' : '') }, bodyKids)));
  }

  if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) {
    notice('Not set up yet', ['Open ', h('code', { text: 'assets/config.js' }), ' and fill in ',
      h('code', { text: 'supabaseUrl' }), ' and ', h('code', { text: 'supabaseAnonKey' }),
      '. The steps are in docs/BACKEND_SETUP.md.']);
    return;
  }
  if (!window.supabase || !window.supabase.createClient) {
    notice('Could not load', ['A required library did not load (check your internet connection and reload).'], true);
    return;
  }

  const sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  });

  const state = {
    user: null, categories: [], projects: [], view: 'login', tab: 'projects',
    filter: { q: '', status: 'all' }, loginMessage: '', entering: false,
  };

  const whoEl = document.getElementById('who');
  const outBtn = document.getElementById('signout');
  const siteBtn = document.getElementById('viewsite');
  outBtn.addEventListener('click', function () { sb.auth.signOut(); });

  function chrome(signedIn) {
    outBtn.hidden = !signedIn; siteBtn.hidden = !signedIn;
    whoEl.textContent = signedIn && state.user ? state.user.email : '';
  }

  /* Ask our server functions to do something only they may do. The caller's
     own sign-in token goes with the request; the server checks it against the
     database before acting. */
  async function api(path, body) {
    const s = (await sb.auth.getSession()).data.session;
    if (!s) throw new Error('Your session has ended. Please sign in again.');
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + s.access_token },
      body: JSON.stringify(body),
    });
    let data = {};
    try { data = await res.json(); } catch (e) { /* not JSON */ }
    if (!res.ok) throw new Error(data.error || 'The server said no (' + res.status + ').');
    return data;
  }

  // The sign-out event can arrive a moment after our own code has already put
  // the sign-in form (and its message) on screen; only react if we are not
  // already there, or the message would be wiped.
  sb.auth.onAuthStateChange(function (evt) {
    if (evt === 'SIGNED_OUT' && !state.entering && state.view !== 'login') { state.user = null; showLogin(); }
  });

  async function boot() {
    const s = (await sb.auth.getSession()).data.session;
    if (s) await enter(s); else showLogin();
  }

  async function enter(session) {
    state.entering = true;
    try {
      const r = await sb.rpc('is_admin');
      if (r.error || r.data !== true) {
        await sb.auth.signOut();
        state.loginMessage = 'This account is not set up as an admin. Ask the site owner to add you.';
        state.user = null; chrome(false); showLogin();
        return;
      }
      state.user = session.user; chrome(true);
      await Promise.all([loadCategories(), loadProjects()]);
      state.tab = 'projects'; showList();
    } catch (e) {
      notice('Could not load', [explain(e)], true);
    } finally { state.entering = false; }
  }

  /* ---------------------------------------------------------------- data -- */

  async function loadCategories() {
    const r = await sb.from('categories').select('*').order('sort_order').order('name');
    if (r.error) throw r.error;
    state.categories = r.data;
  }

  async function loadProjects() {
    const r = await sb.from('projects')
      .select('id,slug,title,status,featured,is_story,sort_order,created_at,category_id,'
        + 'category:categories(name),cover:media!projects_cover_fk(id,type,thumb_url,url),'
        + 'media_count:media!media_project_id_fkey(count)')
      .order('created_at', { ascending: false }).limit(2000);
    if (r.error) throw r.error;
    state.projects = r.data;
  }

  async function removeFiles(rows) {
    // Delete from Cloudinary in batches; returns how many could not be removed.
    let failed = 0;
    for (let i = 0; i < rows.length; i += 200) {
      const batch = rows.slice(i, i + 200).map(function (m) { return { public_id: m.public_id, resource_type: m.type }; });
      failed += (await api('/api/delete-asset', { items: batch })).failed;
    }
    return failed;
  }

  /* --------------------------------------------------------------- login -- */

  function showLogin() {
    state.view = 'login'; chrome(false);
    clear(app);
    const email = h('input', { type: 'email', id: 'em', autocomplete: 'username', required: true });
    const pass = h('input', { type: 'password', id: 'pw', autocomplete: 'current-password', required: true });
    const err = h('p', { class: 'err', role: 'alert', style: 'color:var(--bad);font-size:13px;min-height:1.2em' }, state.loginMessage);
    state.loginMessage = '';
    const btn = h('button', { class: 'btn btn-gold', type: 'submit', text: 'Sign in' });
    const form = h('form', {
      class: 'login', novalidate: true,
      onsubmit: async function (e) {
        e.preventDefault();
        err.textContent = '';
        if (!email.value.trim() || !pass.value) { err.textContent = 'Enter your email and password.'; return; }
        btn.disabled = true; btn.textContent = 'Signing in…';
        const r = await sb.auth.signInWithPassword({ email: email.value.trim(), password: pass.value });
        btn.disabled = false; btn.textContent = 'Sign in';
        if (r.error) { err.textContent = 'That email or password is not right.'; pass.value = ''; pass.focus(); return; }
        await enter(r.data.session);
      },
    },
      h('h1', { text: 'Sign in' }),
      h('p', { class: 'muted', text: 'Manage the photos and videos on the website.' }),
      field('Email', email, null, 'em'), field('Password', pass, null, 'pw'), err, btn);
    app.appendChild(form);
    email.focus();
  }

  /* ---------------------------------------------------------------- tabs -- */

  function tabs() {
    function t(id, label) {
      return h('button', {
        class: 'tab', type: 'button', role: 'tab', 'aria-selected': String(state.tab === id), text: label,
        onclick: function () { state.tab = id; id === 'projects' ? showList() : showCategories(); },
      });
    }
    return h('div', { class: 'tabs', role: 'tablist' }, t('projects', 'Projects'), t('categories', 'Categories'));
  }

  /* ---------------------------------------------------------------- list -- */

  function showList() {
    state.view = 'list'; clear(app);
    const q = h('input', { type: 'search', placeholder: 'Search projects…', 'aria-label': 'Search projects', value: state.filter.q });
    const st = h('select', { 'aria-label': 'Filter by status' },
      h('option', { value: 'all', text: 'All', selected: state.filter.status === 'all' }),
      h('option', { value: 'published', text: 'Published', selected: state.filter.status === 'published' }),
      h('option', { value: 'draft', text: 'Drafts', selected: state.filter.status === 'draft' }));
    const list = h('ul', { class: 'plist' });
    const draw = function () {
      state.filter.q = q.value; state.filter.status = st.value;
      const needle = q.value.trim().toLowerCase();
      const rows = state.projects.filter(function (p) {
        return (st.value === 'all' || p.status === st.value)
          && (!needle || (p.title + ' ' + p.slug + ' ' + (p.category ? p.category.name : '')).toLowerCase().indexOf(needle) !== -1);
      });
      clear(list);
      if (!rows.length) {
        list.appendChild(h('li', { class: 'empty' }, state.projects.length
          ? 'No projects match.' : 'No projects yet. Click “New project” to add the first one.'));
      }
      rows.forEach(function (p) { list.appendChild(projectRow(p)); });
    };
    q.addEventListener('input', draw); st.addEventListener('change', draw);

    app.appendChild(h('div', { class: 'head' }, h('h1', { text: 'Website content' }),
      h('button', { class: 'btn btn-gold', type: 'button', text: '+ New project', onclick: function () { showEditor(null); } })));
    app.appendChild(tabs());
    app.appendChild(h('div', { class: 'tools' }, q, st));
    app.appendChild(list);
    draw();
  }

  function projectRow(p) {
    const media = p.media_count && p.media_count[0] ? p.media_count[0].count : 0;
    const cover = p.cover;
    const thumb = h('div', { class: 'thumb' });
    if (cover && (cover.thumb_url || cover.url) && cover.type !== 'video') thumb.style.backgroundImage = 'url("' + (cover.thumb_url || cover.url).replace(/"/g, '%22') + '")';
    else if (cover && cover.thumb_url) thumb.style.backgroundImage = 'url("' + cover.thumb_url.replace(/"/g, '%22') + '")';
    if (cover && cover.type === 'video') thumb.appendChild(h('span', { class: 'pill badge-v', text: 'Video' }));

    const warn = !cover && p.status === 'published';
    const row = h('li', { class: 'prow' }, thumb,
      h('div', null,
        h('div', { class: 'ptitle' }, p.featured ? h('span', { class: 'star', title: 'Featured', text: '★ ' }) : null, p.title),
        h('div', { class: 'pmeta' },
          h('span', { class: 'pill ' + (p.status === 'published' ? 'live' : 'draft'), text: p.status === 'published' ? 'Published' : 'Draft' }),
          p.is_story ? h('span', { class: 'pill story', text: 'Celebration' }) : null,
          p.category ? h('span', { text: p.category.name }) : h('span', { class: 'pill warn', text: 'No category' }),
          h('span', { text: media + (media === 1 ? ' file' : ' files') }),
          warn ? h('span', { class: 'pill warn', text: 'No cover — will not show' }) : null)),
      h('div', { class: 'pact' },
        h('button', { class: 'btn btn-quiet btn-small', type: 'button', text: 'Edit', onclick: function () { showEditor(p.id); } }),
        h('button', {
          class: 'btn btn-quiet btn-small', type: 'button', text: p.featured ? '★ Unfeature' : '☆ Feature',
          onclick: async function (e) { await guarded(e.target, async function () { await patchProject(p, { featured: !p.featured }); }); },
        }),
        h('button', {
          class: 'btn btn-quiet btn-small', type: 'button', text: p.status === 'published' ? 'Unpublish' : 'Publish',
          onclick: async function (e) {
            await guarded(e.target, async function () {
              if (p.status !== 'published' && !p.cover) { toast('Add at least one photo or video before publishing.', 'bad'); return; }
              await patchProject(p, { status: p.status === 'published' ? 'draft' : 'published' });
            });
          },
        }),
        h('button', { class: 'btn btn-danger btn-small', type: 'button', text: 'Delete', onclick: function () { deleteProject(p); } })));
    return row;
  }

  async function guarded(btn, fn) {
    const label = btn.textContent;
    btn.disabled = true;
    try { await fn(); } catch (e) { toast(explain(e), 'bad'); }
    finally { btn.disabled = false; btn.textContent = label; }
  }

  async function patchProject(p, patch) {
    const r = await sb.from('projects').update(patch).eq('id', p.id);
    if (r.error) throw r.error;
    Object.assign(p, patch);
    toast('Saved.', 'ok');
    if (state.view === 'list') showList();
  }

  async function deleteProject(p) {
    const ok = await modal({
      title: 'Delete “' + p.title + '”?',
      body: 'This permanently removes the project and every photo and video in it, from the website and from storage. It cannot be undone.',
      ok: 'Delete project', danger: true,
    });
    if (!ok) return;
    try {
      const m = await sb.from('media').select('public_id,type').eq('project_id', p.id);
      if (m.error) throw m.error;
      if (m.data.length) {
        const failed = await removeFiles(m.data);
        if (failed) {
          const go = await modal({
            title: failed + ' file' + (failed === 1 ? '' : 's') + ' could not be removed from storage',
            body: 'Delete the project anyway? The leftover files would stay in storage (and count against your space) until removed by hand.',
            ok: 'Delete anyway', danger: true,
          });
          if (!go) return;
        }
      }
      const r = await sb.from('projects').delete().eq('id', p.id);
      if (r.error) throw r.error;
      state.projects = state.projects.filter(function (x) { return x.id !== p.id; });
      toast('Project deleted.', 'ok');
      showList();
    } catch (e) { toast(explain(e), 'bad'); }
  }

  /* ---------------------------------------------------------- categories -- */

  function showCategories() {
    state.view = 'categories'; clear(app);
    app.appendChild(h('div', { class: 'head' }, h('h1', { text: 'Website content' })));
    app.appendChild(tabs());

    const card = h('div', { class: 'card' });
    card.appendChild(h('p', { class: 'muted small', text: 'Categories are the headings in the gallery. The gallery shows one picture per category, in this order (smallest number first). A category only appears once it has a published project.' }));

    state.categories.forEach(function (c) {
      const name = h('input', { type: 'text', value: c.name, 'aria-label': 'Name', maxlength: '80' });
      const order = h('input', { type: 'number', value: String(c.sort_order), 'aria-label': 'Order' });
      card.appendChild(h('div', { class: 'crow' },
        name, h('span', { class: 'muted small', text: c.slug }), order,
        h('span', { class: 'pact' },
          h('button', {
            class: 'btn btn-quiet btn-small', type: 'button', text: 'Save',
            onclick: function (e) {
              guarded(e.target, async function () {
                if (!name.value.trim()) throw new Error('A category needs a name.');
                const r = await sb.from('categories').update({ name: name.value.trim(), sort_order: parseInt(order.value, 10) || 0 }).eq('id', c.id);
                if (r.error) throw r.error;
                await loadCategories(); await loadProjects(); toast('Saved.', 'ok'); showCategories();
              });
            },
          }),
          h('button', {
            class: 'btn btn-danger btn-small', type: 'button', text: 'Delete',
            onclick: async function () {
              const used = state.projects.filter(function (p) { return p.category_id === c.id; }).length;
              const ok = await modal({
                title: 'Delete “' + c.name + '”?',
                body: used ? used + ' project' + (used === 1 ? ' uses' : 's use') + ' it. They stay, but will have no category (and will not appear in the gallery grid until you choose one).' : 'Nothing uses it.',
                ok: 'Delete', danger: true,
              });
              if (!ok) return;
              const r = await sb.from('categories').delete().eq('id', c.id);
              if (r.error) { toast(explain(r.error), 'bad'); return; }
              await loadCategories(); await loadProjects(); showCategories();
            },
          }))));
    });

    const nn = h('input', { type: 'text', placeholder: 'New category name', maxlength: '80', 'aria-label': 'New category name' });
    card.appendChild(h('div', { class: 'crow' }, nn, h('span', null), h('span', null),
      h('button', {
        class: 'btn btn-gold btn-small', type: 'button', text: 'Add category',
        onclick: function (e) {
          guarded(e.target, async function () {
            const name = nn.value.trim(); if (!name) throw new Error('Type a name first.');
            const slug = slugify(name); if (!slug) throw new Error('Use letters or numbers in the name.');
            const next = state.categories.reduce(function (m, c) { return Math.max(m, c.sort_order); }, 0) + 10;
            const r = await sb.from('categories').insert({ name: name, slug: slug, sort_order: next });
            if (r.error) throw r.error;
            await loadCategories(); toast('Added.', 'ok'); showCategories();
          });
        },
      })));
    app.appendChild(card);
  }

  /* -------------------------------------------------------------- editor -- */

  const ed = { p: null, queue: [], running: 0, dirty: false, els: {} };

  async function showEditor(id) {
    state.view = 'edit'; clear(app);
    ed.queue = []; ed.running = 0;
    if (id) {
      const r = await sb.from('projects').select('*,media:media!media_project_id_fkey(*)').eq('id', id)
        .order('sort_order', { referencedTable: 'media' }).single();
      if (r.error) { toast(explain(r.error), 'bad'); showList(); return; }
      ed.p = r.data; ed.p.media = r.data.media || [];
    } else {
      ed.p = { id: null, title: '', slug: '', description: '', category_id: null, is_story: false, location: '', occasion: '',
        credits: [], featured: false, status: 'draft', sort_order: 0, cover_media_id: null, media: [] };
    }
    ed.p._next = ed.p.media.reduce(function (m, x) { return Math.max(m, x.sort_order); }, -1) + 1;
    drawEditor();
  }

  function drawEditor() {
    const p = ed.p; clear(app);
    const isNew = !p.id;

    app.appendChild(h('div', { class: 'crumbs' },
      h('button', { class: 'btn btn-quiet btn-small', type: 'button', text: '← All projects', onclick: leaveEditor })));
    app.appendChild(h('h1', { text: isNew ? 'New project' : 'Edit project' }));

    const f = {};
    f.title = h('input', { type: 'text', id: 'f-title', value: p.title, maxlength: '160', required: true });
    f.slug = h('input', { type: 'text', id: 'f-slug', value: p.slug, maxlength: '80' });
    f.cat = h('select', { id: 'f-cat' }, h('option', { value: '', text: '— choose —' }),
      state.categories.map(function (c) { return h('option', { value: c.id, text: c.name, selected: c.id === p.category_id }); }));
    f.story = h('input', { type: 'checkbox', id: 'f-story', checked: !!p.is_story });
    f.loc = h('input', { type: 'text', id: 'f-loc', value: p.location, maxlength: '120' });
    f.occ = h('input', { type: 'text', id: 'f-occ', value: p.occasion, maxlength: '120' });
    f.desc = h('textarea', { id: 'f-desc', maxlength: '4000' }); f.desc.value = p.description;
    f.feat = h('input', { type: 'checkbox', id: 'f-feat', checked: !!p.featured });
    f.status = h('select', { id: 'f-status' },
      h('option', { value: 'draft', text: 'Draft (hidden)', selected: p.status === 'draft' }),
      h('option', { value: 'published', text: 'Published (live on the website)', selected: p.status === 'published' }));
    f.order = h('input', { type: 'number', id: 'f-order', value: String(p.sort_order) });
    const slugErr = h('span', { class: 'err', role: 'alert' });
    ed.els = f;

    // The web address follows the title until the person edits it by hand.
    let slugTouched = !isNew;
    f.slug.addEventListener('input', function () { slugTouched = true; });
    f.title.addEventListener('input', function () { if (!slugTouched) f.slug.value = slugify(f.title.value); });

    // credits
    const creditsBox = h('div');
    const drawCredits = function () {
      clear(creditsBox);
      p.credits.forEach(function (c, i) {
        creditsBox.appendChild(h('div', { class: 'credits-row' },
          h('input', { type: 'text', value: c[0] || '', placeholder: 'e.g. Photography', 'aria-label': 'Credit label', maxlength: '60', oninput: function (e) { p.credits[i][0] = e.target.value; } }),
          h('input', { type: 'text', value: c[1] || '', placeholder: 'e.g. Studio name', 'aria-label': 'Credit value', maxlength: '120', oninput: function (e) { p.credits[i][1] = e.target.value; } }),
          h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Remove credit', text: '✕', onclick: function () { p.credits.splice(i, 1); drawCredits(); } })));
      });
    };
    p.credits = (p.credits || []).map(function (c) { return [c[0], c[1]]; });
    drawCredits();

    const status = h('span', { class: 'status', role: 'status' });
    const save = h('button', { class: 'btn btn-gold', type: 'button', text: isNew ? 'Create project' : 'Save changes' });
    save.addEventListener('click', async function () {
      slugErr.textContent = '';
      const title = f.title.value.trim();
      const slug = slugify(f.slug.value || title);
      if (!title) { toast('Give the project a title.', 'bad'); f.title.focus(); return; }
      if (!slug) { slugErr.textContent = 'Use letters or numbers.'; f.slug.focus(); return; }
      if (f.status.value === 'published' && !ed.p.media.length) { toast('Add at least one photo or video before publishing.', 'bad'); return; }
      if (f.status.value === 'published' && !f.cat.value) {
        const go = await modal({ title: 'No category chosen', body: 'Without a category this project will not appear in the gallery grid (it can still appear in the slideshow and as a celebration). Publish anyway?', ok: 'Publish anyway' });
        if (!go) return;
      }
      const row = {
        title: title, slug: slug, description: f.desc.value.trim(), category_id: f.cat.value || null,
        is_story: f.story.checked, location: f.loc.value.trim(), occasion: f.occ.value.trim(),
        credits: p.credits.filter(function (c) { return (c[0] || '').trim() && (c[1] || '').trim(); }).map(function (c) { return [c[0].trim(), c[1].trim()]; }),
        featured: f.feat.checked, status: f.status.value, sort_order: parseInt(f.order.value, 10) || 0,
      };
      save.disabled = true; status.textContent = 'Saving…';
      try {
        if (isNew) {
          const r = await sb.from('projects').insert(row).select('*').single();
          if (r.error) throw r.error;
          ed.p = Object.assign(r.data, { media: [], _next: 0 });
          toast('Project created. Now add photos and videos.', 'ok');
        } else {
          const r = await sb.from('projects').update(row).eq('id', p.id);
          if (r.error) throw r.error;
          Object.assign(ed.p, row);
          toast('Saved.', 'ok');
        }
        await loadProjects();
        drawEditor();
      } catch (e) {
        if (e.code === '23505') slugErr.textContent = 'This web address is already used. Change it.';
        toast(explain(e), 'bad');
        status.textContent = '';
      } finally { save.disabled = false; }
    });

    app.appendChild(h('div', { class: 'card' },
      h('div', { class: 'row' },
        field('Title', f.title, 'For a celebration use both names, like “Aanya & Dev”.', 'f-title'),
        field('Category', f.cat, 'Decides which heading it appears under in the gallery.', 'f-cat')),
      h('div', { class: 'row' },
        h('div', { class: 'field' }, h('label', { for: 'f-slug', text: 'Web address' }), f.slug,
          h('span', { class: 'hint', text: 'Used in the link, like story.html?s=…  Lowercase letters, numbers and dashes. Changing it later breaks old links.' }), slugErr),
        field('Order', f.order, 'Smaller numbers come first.', 'f-order')),
      h('label', { class: 'check', for: 'f-story' }, f.story, 'Celebration story — gets its own page and appears under “Real Celebrations”'),
      h('div', { class: 'row' },
        field('Location', f.loc, 'e.g. Udaipur', 'f-loc'), field('Occasion', f.occ, 'e.g. Wedding & Reception', 'f-occ')),
      field('Description', f.desc, 'A short introduction. Shown on the celebration page.', 'f-desc'),
      h('div', { class: 'field' }, h('span', { class: 'label', text: 'Extra credits (optional)' }), creditsBox,
        h('button', { class: 'btn btn-quiet btn-small', type: 'button', text: '+ Add credit', style: 'align-self:flex-start', onclick: function () { p.credits.push(['', '']); drawCredits(); } })),
      h('div', { class: 'row' },
        h('label', { class: 'check', for: 'f-feat' }, f.feat, 'Featured — shown in the slideshow at the top of the gallery'),
        field('Status', f.status, null, 'f-status')),
      h('div', { class: 'sticky-save' }, save,
        h('button', { class: 'btn btn-quiet', type: 'button', text: 'Close', onclick: leaveEditor }), status)));

    // ---- media ------------------------------------------------------------
    const mediaCard = h('div', { class: 'card', id: 'media-card' });
    app.appendChild(mediaCard);
    if (isNew) {
      mediaCard.appendChild(h('h2', { text: 'Photos & videos' }));
      mediaCard.appendChild(h('p', { class: 'muted', text: 'Create the project first (button above), then you can add photos and videos.' }));
    } else {
      drawMedia(mediaCard);
    }
  }

  async function leaveEditor() {
    const active = ed.queue.some(function (q) { return q.status === 'uploading' || q.status === 'signing' || q.status === 'saving'; });
    if (active) {
      const ok = await modal({ title: 'Uploads are still running', body: 'If you leave now the unfinished uploads will be cancelled.', ok: 'Leave and cancel', danger: true });
      if (!ok) return;
      ed.queue.forEach(function (q) { if (q.abort) q.abort(); });
    }
    await loadProjects();
    showList();
  }

  window.addEventListener('beforeunload', function (e) {
    if (ed.queue.some(function (q) { return q.status === 'uploading' || q.status === 'signing' || q.status === 'saving'; })) {
      e.preventDefault(); e.returnValue = '';
    }
  });

  /* ---- media manager ----------------------------------------------------- */

  function drawMedia(card) {
    const p = ed.p; clear(card);
    card.appendChild(h('h2', { text: 'Photos & videos' }));
    card.appendChild(h('p', { class: 'muted small', text: 'Photos up to ' + (MAX_IMAGE / MB) + ' MB (JPG, PNG, WebP, AVIF, GIF, HEIC) and videos up to ' + (MAX_VIDEO / MB) + ' MB (MP4, MOV, WebM). Select as many files as you like; they upload a few at a time. The first file becomes the cover; change it with ★.' }));

    const input = h('input', { type: 'file', multiple: true, hidden: true, accept: IMAGE_EXT.concat(VIDEO_EXT).map(function (e) { return '.' + e; }).join(',') });
    input.addEventListener('change', function () { addFiles(Array.from(input.files)); input.value = ''; });
    const drop = h('div', { class: 'drop', tabindex: '0', role: 'button', 'aria-label': 'Choose photos and videos to upload' },
      h('strong', { text: 'Drop photos and videos here' }), h('span', { class: 'muted', text: 'or click to choose files' }));
    drop.addEventListener('click', function () { input.click(); });
    drop.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
    ['dragenter', 'dragover'].forEach(function (n) { drop.addEventListener(n, function (e) { e.preventDefault(); drop.classList.add('over'); }); });
    ['dragleave', 'drop'].forEach(function (n) { drop.addEventListener(n, function (e) { e.preventDefault(); drop.classList.remove('over'); }); });
    drop.addEventListener('drop', function (e) { addFiles(Array.from(e.dataTransfer.files)); });

    ed.els.queue = h('ul', { class: 'queue', 'aria-label': 'Uploads' });
    ed.els.grid = h('ul', { class: 'mgrid', 'aria-label': 'Files in this project' });
    card.appendChild(drop); card.appendChild(input); card.appendChild(ed.els.queue); card.appendChild(ed.els.grid);
    drawQueue(); drawGrid();
  }

  function drawGrid() {
    const p = ed.p, grid = ed.els.grid;
    if (!grid) return;
    clear(grid);
    if (!p.media.length) { grid.appendChild(h('li', { class: 'muted', text: 'Nothing here yet.' })); return; }

    p.media.forEach(function (m, i) {
      const isCover = p.cover_media_id === m.id;
      const img = h('div', { class: 'mimg' }, h('div', { class: 'tag' },
        m.type === 'video' ? h('span', { class: 'pill', text: 'Video' }) : null,
        isCover ? h('span', { class: 'pill live', text: '★ Cover' }) : null));
      if (m.thumb_url || m.type !== 'video') img.style.backgroundImage = 'url("' + String(m.thumb_url || m.url).replace(/"/g, '%22') + '")';

      const layout = h('select', { 'aria-label': 'Layout on the celebration page', disabled: m.type === 'video' },
        ['wide', 'tall', 'half'].map(function (v) {
          return h('option', { value: v, selected: m.layout === v, text: { wide: 'Auto (fits the rows)', tall: 'Big (its own full row)', half: 'Auto (fits the rows)' }[v] });
        }));
      layout.addEventListener('change', function () { updateMedia(m, { layout: layout.value }); });

      const alt = h('input', { type: 'text', value: m.alt || '', placeholder: 'Describe the picture (helps accessibility)', maxlength: '300', 'aria-label': 'Description' });
      alt.addEventListener('change', function () { updateMedia(m, { alt: alt.value.trim() }, true); });

      grid.appendChild(h('li', { class: 'mcard' + (isCover ? ' cover' : '') }, img,
        h('div', { class: 'mbody' }, alt, m.type === 'video' ? null : layout,
          h('div', { class: 'mrow' },
            h('button', { class: 'icon-btn', type: 'button', title: 'Move earlier', 'aria-label': 'Move earlier', text: '←', disabled: i === 0, onclick: function () { moveMedia(i, -1); } }),
            h('button', { class: 'icon-btn', type: 'button', title: 'Move later', 'aria-label': 'Move later', text: '→', disabled: i === p.media.length - 1, onclick: function () { moveMedia(i, 1); } }),
            h('button', { class: 'icon-btn', type: 'button', title: 'Use as cover', 'aria-label': 'Use as cover', text: isCover ? '★' : '☆', onclick: function () { setCover(m); } }),
            h('span', { class: 'grow' }),
            h('button', { class: 'icon-btn', type: 'button', title: 'Delete', 'aria-label': 'Delete this file', text: '🗑', onclick: function () { deleteMedia(m); } })))));
    });
  }

  async function updateMedia(m, patch, quiet) {
    const r = await sb.from('media').update(patch).eq('id', m.id);
    if (r.error) { toast(explain(r.error), 'bad'); drawGrid(); return; }
    Object.assign(m, patch);
    if (!quiet) toast('Saved.', 'ok');
  }

  async function moveMedia(i, dir) {
    const list = ed.p.media, j = i + dir;
    if (j < 0 || j >= list.length) return;
    const a = list[i], b = list[j];
    const ao = a.sort_order, bo = b.sort_order;
    // Rows from older uploads can share a number; give the pair distinct ones.
    const na = ao === bo ? j : bo, nb = ao === bo ? i : ao;
    const r1 = await sb.from('media').update({ sort_order: na }).eq('id', a.id);
    const r2 = await sb.from('media').update({ sort_order: nb }).eq('id', b.id);
    if (r1.error || r2.error) { toast(explain(r1.error || r2.error), 'bad'); return; }
    a.sort_order = na; b.sort_order = nb;
    list.sort(function (x, y) { return x.sort_order - y.sort_order; });
    drawGrid();
  }

  async function setCover(m) {
    const r = await sb.from('projects').update({ cover_media_id: m.id }).eq('id', ed.p.id);
    if (r.error) { toast(explain(r.error), 'bad'); return; }
    ed.p.cover_media_id = m.id; drawGrid(); toast('Cover updated.', 'ok');
  }

  async function deleteMedia(m) {
    const ok = await modal({ title: 'Delete this ' + (m.type === 'video' ? 'video' : 'photo') + '?', body: 'It is removed from the website and from storage. This cannot be undone.', ok: 'Delete', danger: true });
    if (!ok) return;
    try {
      const failed = await removeFiles([m]);
      if (failed) {
        const go = await modal({ title: 'Could not remove it from storage', body: 'Remove it from the website anyway? The file would stay in storage until deleted by hand.', ok: 'Remove anyway', danger: true });
        if (!go) return;
      }
      const r = await sb.from('media').delete().eq('id', m.id);
      if (r.error) throw r.error;
      ed.p.media = ed.p.media.filter(function (x) { return x.id !== m.id; });
      if (ed.p.cover_media_id === m.id) {
        const next = ed.p.media[0] ? ed.p.media[0].id : null;
        const u = await sb.from('projects').update({ cover_media_id: next }).eq('id', ed.p.id);
        if (u.error) throw u.error;
        ed.p.cover_media_id = next;
      }
      drawGrid(); toast('Deleted.', 'ok');
    } catch (e) { toast(explain(e), 'bad'); }
  }

  /* ---- uploading --------------------------------------------------------- */

  function extOf(name) { const m = /\.([A-Za-z0-9]+)$/.exec(name); return m ? m[1].toLowerCase() : ''; }

  /* Decide whether a file may be uploaded, before any bytes are sent. */
  function validate(file) {
    const ext = extOf(file.name);
    const kind = IMAGE_EXT.indexOf(ext) !== -1 ? 'image' : VIDEO_EXT.indexOf(ext) !== -1 ? 'video' : null;
    if (!kind) return { error: 'Not a supported file type (.' + (ext || '?') + ').' };
    if (!file.size) return { error: 'The file is empty.' };
    const max = kind === 'image' ? MAX_IMAGE : MAX_VIDEO;
    if (file.size > max) return { error: 'Too large: ' + (file.size / MB).toFixed(1) + ' MB (limit ' + (max / MB) + ' MB for ' + kind + 's).' };
    return { kind: kind };
  }

  function addFiles(files) {
    if (!ed.p || !ed.p.id) return;
    let added = 0;
    files.forEach(function (file) {
      const dupe = ed.queue.some(function (q) { return q.file.name === file.name && q.file.size === file.size && q.status !== 'error'; });
      if (dupe) return;
      const v = validate(file);
      ed.queue.push({ id: ++addFiles.n, file: file, kind: v.kind, status: v.error ? 'error' : 'queued', progress: 0, error: v.error || '' });
      added++;
    });
    if (added) { drawQueue(); pump(); }
  }
  addFiles.n = 0;

  function pump() {
    while (ed.running < CONCURRENCY) {
      const next = ed.queue.find(function (q) { return q.status === 'queued'; });
      if (!next) break;
      ed.running++;
      next.status = 'signing';
      run(next).finally(function () { ed.running--; drawQueue(); pump(); });
    }
  }

  async function run(item) {
    try {
      drawQueue();
      const sig = await api('/api/sign-upload', { resource_type: item.kind, folder: ed.p.slug });
      item.status = 'uploading'; drawQueue();
      const out = await sendFile(item, sig);
      item.status = 'saving'; item.progress = 1; drawQueue();

      const order = ed.p._next++;        // reserved now, so parallel uploads never share a number
      const cloud = sig.cloud_name;
      const thumb = item.kind === 'video'
        ? 'https://res.cloudinary.com/' + cloud + '/video/upload/so_10p,f_auto,q_auto,c_limit,w_600/' + out.public_id + '.jpg'
        : 'https://res.cloudinary.com/' + cloud + '/image/upload/f_auto,q_auto,c_limit,w_600/' + out.public_id;
      const row = {
        project_id: ed.p.id, type: item.kind, public_id: out.public_id, url: out.secure_url, thumb_url: thumb,
        width: out.width || null, height: out.height || null, duration: out.duration || null,
        bytes: out.bytes || item.file.size, format: out.format || extOf(item.file.name),
        layout: 'wide',
        sort_order: order,
      };
      const r = await sb.from('media').insert(row).select('*').single();
      if (r.error) {
        // The file is on Cloudinary but not recorded: remove it so nothing is orphaned.
        try { await api('/api/delete-asset', { items: [{ public_id: out.public_id, resource_type: item.kind }] }); } catch (e) { /* best effort */ }
        throw r.error;
      }
      ed.p.media.push(r.data);
      ed.p.media.sort(function (a, b) { return a.sort_order - b.sort_order; });
      if (!ed.p.cover_media_id) {
        const u = await sb.from('projects').update({ cover_media_id: r.data.id }).eq('id', ed.p.id);
        if (!u.error) ed.p.cover_media_id = r.data.id;
      }
      item.status = 'done'; drawGrid();
    } catch (e) {
      item.status = e && e.cancelled ? 'cancelled' : 'error';
      item.error = e && e.cancelled ? 'Cancelled.' : explain(e);
    }
  }

  function post(item, url, form, headers, onBytes) {
    return new Promise(function (resolve, reject) {
      const x = new XMLHttpRequest();
      x.open('POST', url);
      Object.keys(headers || {}).forEach(function (k) { x.setRequestHeader(k, headers[k]); });
      x.upload.onprogress = function (e) { if (e.lengthComputable) onBytes(e.loaded); };
      x.onload = function () {
        let j = {}; try { j = JSON.parse(x.responseText); } catch (e) { /* not JSON */ }
        if (x.status >= 200 && x.status < 300) resolve(j);
        else {
          const err = new Error((j.error && j.error.message) || ('Upload failed (' + x.status + ').'));
          err.retry = x.status >= 500 || x.status === 429; reject(err);
        }
      };
      x.onerror = function () { const e = new Error('Network error'); e.retry = true; reject(e); };
      x.onabort = function () { const e = new Error('Cancelled'); e.cancelled = true; reject(e); };
      item.abort = function () { x.abort(); };
      x.send(form);
    });
  }

  async function withRetry(fn) {
    let wait = 800;
    for (let attempt = 1; ; attempt++) {
      try { return await fn(); }
      catch (e) { if (!e.retry || attempt >= 3) throw e; await new Promise(function (r) { setTimeout(r, wait); }); wait *= 2; }
    }
  }

  /* One request for normal files; for big ones, 20 MB pieces sent in order
     (Cloudinary reassembles them), each retried on its own so a flaky
     connection does not restart a 500 MB upload from zero. */
  async function sendFile(item, sig) {
    const file = item.file, total = file.size;
    const fields = function (blob) {
      const f = new FormData();
      f.append('api_key', sig.api_key); f.append('timestamp', sig.timestamp); f.append('signature', sig.signature);
      f.append('folder', sig.folder); f.append('allowed_formats', sig.allowed_formats);
      f.append('file', blob, file.name);
      return f;
    };

    if (total <= CHUNK_AT) {
      return withRetry(function () {
        return post(item, sig.upload_url, fields(file), {}, function (b) { item.progress = b / total; drawProgress(item); });
      });
    }

    const uid = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2);
    let last = null;
    for (let start = 0; start < total; start += CHUNK) {
      const end = Math.min(start + CHUNK, total);
      const blob = file.slice(start, end);
      last = await withRetry(function () {
        return post(item, sig.upload_url, fields(blob),
          { 'X-Unique-Upload-Id': uid, 'Content-Range': 'bytes ' + start + '-' + (end - 1) + '/' + total },
          function (b) { item.progress = Math.min(1, (start + b) / total); drawProgress(item); });
      });
    }
    return last;
  }

  /* ---- upload list ------------------------------------------------------- */

  const STATE_TEXT = { queued: 'Waiting…', signing: 'Preparing…', uploading: 'Uploading', saving: 'Saving…', done: 'Done', error: 'Failed', cancelled: 'Cancelled' };

  function drawProgress(item) {
    const fill = document.querySelector('[data-q="' + item.id + '"] .bar-fill');
    const label = document.querySelector('[data-q="' + item.id + '"] .qstate');
    if (fill) fill.style.width = Math.round(item.progress * 100) + '%';
    if (label && item.status === 'uploading') label.textContent = 'Uploading ' + Math.round(item.progress * 100) + '%';
  }

  function drawQueue() {
    const ul = ed.els && ed.els.queue;
    if (!ul) return;
    clear(ul);
    ed.queue.forEach(function (q) {
      if (q.status === 'done') return;                     // finished ones move into the grid below
      const bad = q.status === 'error' || q.status === 'cancelled';
      const label = bad ? (q.error || STATE_TEXT[q.status]) : (q.status === 'uploading' ? 'Uploading ' + Math.round(q.progress * 100) + '%' : STATE_TEXT[q.status]);
      ul.appendChild(h('li', { class: 'qitem', 'data-q': String(q.id) },
        h('span', { class: 'qname', title: q.file.name, text: q.file.name + ' · ' + (q.file.size / MB).toFixed(1) + ' MB' }),
        h('span', { class: 'qstate' + (bad ? ' bad' : ''), text: label },
          ' ',
          q.status === 'uploading' || q.status === 'queued' ? h('button', { class: 'btn btn-quiet btn-small', type: 'button', text: 'Cancel', onclick: function () { cancel(q); } }) : null,
          bad ? h('button', { class: 'btn btn-quiet btn-small', type: 'button', text: 'Remove', onclick: function () { ed.queue = ed.queue.filter(function (x) { return x !== q; }); drawQueue(); } }) : null,
          q.status === 'error' && q.kind ? h('button', { class: 'btn btn-quiet btn-small', type: 'button', text: 'Retry', onclick: function () { q.status = 'queued'; q.progress = 0; q.error = ''; drawQueue(); pump(); } }) : null),
        h('div', { class: 'bar-track' }, h('div', { class: 'bar-fill' + (bad ? ' fail' : ''), style: 'width:' + Math.round(q.progress * 100) + '%' }))));
    });
  }

  function cancel(q) {
    if (q.status === 'queued') { q.status = 'cancelled'; q.error = 'Cancelled.'; drawQueue(); }
    else if (q.abort) q.abort();
  }

  /* ---------------------------------------------------------------- go ---- */
  window.__opulaAdmin = { state: state };     // handy when checking by hand in the browser console
  boot();
})();
