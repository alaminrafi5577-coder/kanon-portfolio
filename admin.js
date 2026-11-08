/* Admin tools: Google sign-in, in-page editing, save to Firestore.
   Loaded on demand by cms.js, so normal visitors never download it.
   Real protection is in firestore.rules: only the listed admin emails can write. */
const CMS = window.CMS;
const CFG = window.SITE_CONFIG || {};
const FBC = CFG.firebase || {};
const ADMINS = (CFG.adminEmails || []).map(e => String(e).toLowerCase());
const DEMO = !(FBC.projectId && FBC.apiKey) && CMS.isLocal;
const FB_VER = '10.12.2';

let started = false, backend = null, user = null;
let editing = false, dirty = false;
let overrides = {}, settings = {}, baseline = {}, lastRaw = null;
let selItem = null, propTarget = null;
const ui = {};

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const isAdmin = u => !!(u && u.emailVerified && (DEMO || ADMINS.includes(String(u.email).toLowerCase())));
const setHint = () => { try { localStorage.setItem(CMS.hintKey, '1'); } catch (e) {} };
const clearHint = () => { try { localStorage.removeItem(CMS.hintKey); } catch (e) {} };

/* ================= backends ================= */
async function makeFirebase() {
  const base = 'https://www.gstatic.com/firebasejs/' + FB_VER + '/';
  const [app, auth, fs] = await Promise.all([
    import(base + 'firebase-app.js'), import(base + 'firebase-auth.js'), import(base + 'firebase-firestore.js')
  ]);
  const a = app.initializeApp({ apiKey: FBC.apiKey, authDomain: FBC.authDomain, projectId: FBC.projectId, appId: FBC.appId });
  const au = auth.getAuth(a), db = fs.getFirestore(a);
  return {
    onUser: cb => auth.onAuthStateChanged(au, cb),
    login() { const p = new auth.GoogleAuthProvider(); p.setCustomParameters({ prompt: 'select_account' }); return auth.signInWithPopup(au, p); },
    logout: () => auth.signOut(au),
    async read() { const s = await fs.getDoc(fs.doc(db, 'site', 'content')); return s.exists() ? s.data().json : null; },
    async write(json, email) { await fs.setDoc(fs.doc(db, 'site', 'content'), { json, updatedAt: fs.serverTimestamp(), by: email }); },
    async archive(json, email) {
      await fs.addDoc(fs.collection(db, 'versions'), { json, savedAt: fs.serverTimestamp(), by: email });
      const snap = await fs.getDocs(fs.query(fs.collection(db, 'versions'), fs.orderBy('savedAt', 'desc'), fs.limit(40)));
      for (const d of snap.docs.slice(20)) await fs.deleteDoc(d.ref);
    },
    async versions() {
      const snap = await fs.getDocs(fs.query(fs.collection(db, 'versions'), fs.orderBy('savedAt', 'desc'), fs.limit(20)));
      return snap.docs.map(d => { const x = d.data(); return { id: d.id, at: x.savedAt && x.savedAt.toDate ? x.savedAt.toDate() : null, by: x.by, json: x.json }; });
    }
  };
}

function makeDemo() {
  const mem = {};
  const get = k => { try { return localStorage.getItem(k); } catch (e) { return mem[k] == null ? null : mem[k]; } };
  const set = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { mem[k] = v; } };
  let cb = () => {}, u = get('cms.demo.user') ? { email: 'demo@local', emailVerified: true } : null;
  return {
    demo: true,
    onUser(f) { cb = f; setTimeout(() => cb(u), 0); },
    async login() { u = { email: 'demo@local', emailVerified: true }; set('cms.demo.user', '1'); cb(u); },
    async logout() { u = null; try { localStorage.removeItem('cms.demo.user'); } catch (e) { delete mem['cms.demo.user']; } cb(null); },
    async read() { return get('cms.demo.content'); },
    async write(json) { set('cms.demo.content', json); },
    async archive(json) { const v = JSON.parse(get('cms.demo.versions') || '[]'); v.unshift({ id: String(Date.now()), at: new Date().toISOString(), by: 'demo', json }); set('cms.demo.versions', JSON.stringify(v.slice(0, 20))); },
    async versions() { return JSON.parse(get('cms.demo.versions') || '[]').map(v => Object.assign({}, v, { at: new Date(v.at) })); }
  };
}

/* ================= start / auth ================= */
export async function start(mode) {
  buildUI();
  if (started) { user && isAdmin(user) ? showBar() : showLogin(); return; }
  if (!DEMO && !CMS.HAS) {
    clearHint();
    if (mode === 'login') toast('The admin service is not set up yet. Follow SETUP.md to connect Firebase.', 'warn');
    return;
  }
  try { backend = DEMO ? makeDemo() : await makeFirebase(); }
  catch (e) { console.error(e); toast('Could not load the admin service. Check your internet and try again.', 'warn'); return; }
  started = true;
  backend.onUser(onUser);
  if (mode === 'login') showLogin();
}

async function onUser(u) {
  user = u;
  if (u && isAdmin(u)) {
    setHint(); hideLogin();
    try {
      lastRaw = await backend.read();
      const c = lastRaw ? JSON.parse(lastRaw) : {};
      overrides = Object.assign({}, c.regions || {}); settings = Object.assign({}, c.settings || {});
      if (backend.demo && c && (c.regions || c.settings)) CMS.apply(c);
    } catch (e) { console.error(e); toast('Signed in, but could not read saved content: ' + (e.message || e), 'warn'); }
    showBar();
  } else if (u) {
    toast('That Google account is not allowed to edit this site.', 'warn');
    clearHint(); backend.logout(); showLogin();
  } else {
    clearHint(); hideBar(); if (editing) leaveEdit();
  }
}

/* ================= UI scaffolding ================= */
function injectStyle() {
  if ($('#cms-style')) return;
  const s = document.createElement('style'); s.id = 'cms-style';
  s.textContent = `
  .cms-ui{font-family:Inter,system-ui,sans-serif;font-size:14px;line-height:1.4;color:var(--text);z-index:200}
  #cms-bar{position:fixed;left:50%;bottom:18px;transform:translateX(-50%);width:max-content;display:none;gap:8px;align-items:center;flex-wrap:wrap;justify-content:center;max-width:calc(100vw - 24px);padding:10px 12px;border-radius:18px;background:color-mix(in srgb,var(--bg) 92%,transparent);backdrop-filter:blur(16px);border:1px solid color-mix(in srgb,var(--a2) 45%,var(--card-b));box-shadow:0 18px 50px rgba(0,0,0,.4)}
  #cms-bar.on{display:flex}
  #cms-bar .who{font-size:12px;color:var(--muted);padding:0 6px;max-width:190px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .cms-btn{font:inherit;font-weight:600;cursor:pointer;border:1px solid var(--card-b);background:var(--card);color:var(--text);padding:8px 13px;border-radius:11px;transition:.15s}
  .cms-btn:hover{border-color:var(--a2)}
  .cms-btn.pri{background:var(--grad);color:#fff;border-color:transparent}
  .cms-btn.danger{color:#fb7185}
  .cms-btn:disabled{opacity:.4;cursor:not-allowed}
  .cms-btn.hide{display:none}
  #cms-item{position:fixed;display:none;gap:2px;padding:4px;border-radius:12px;background:var(--bg);border:1px solid var(--a2);box-shadow:0 10px 30px rgba(0,0,0,.45)}
  #cms-item.on{display:flex}
  #cms-item button{font:inherit;cursor:pointer;border:0;background:transparent;color:var(--text);width:30px;height:28px;border-radius:8px;font-size:14px}
  #cms-item button:hover{background:var(--card)}
  #cms-prop{position:fixed;left:50%;bottom:86px;transform:translateX(-50%);width:max-content;display:none;gap:8px;align-items:center;flex-wrap:wrap;padding:10px 12px;border-radius:14px;background:var(--bg);border:1px solid var(--a2);box-shadow:0 14px 40px rgba(0,0,0,.45);max-width:calc(100vw - 24px)}
  #cms-prop.on{display:flex}
  #cms-prop label{font-size:12px;color:var(--muted)}
  #cms-prop input,.cms-modal input,.cms-modal textarea{font:inherit;color:var(--text);background:var(--bg2);border:1px solid var(--card-b);border-radius:9px;padding:7px 10px;min-width:200px}
  .cms-modal textarea{width:100%;min-height:150px;resize:vertical}
  .cms-modal input{width:100%}
  .cms-back{position:fixed;inset:0;background:rgba(5,8,20,.6);display:none;place-items:center;padding:16px}
  .cms-back.on{display:grid}
  .cms-modal{background:var(--bg);border:1px solid var(--card-b);border-radius:20px;padding:22px;width:min(560px,100%);max-height:86vh;overflow:auto;box-shadow:0 30px 80px rgba(0,0,0,.5)}
  .cms-modal h3{font-family:"Space Grotesk",sans-serif;font-size:1.25rem;margin-bottom:6px}
  .cms-modal p{color:var(--muted);margin-bottom:14px}
  .cms-modal .row{display:flex;gap:10px;align-items:center;justify-content:space-between;padding:9px 0;border-top:1px solid var(--card-b)}
  .cms-modal .row small{color:var(--muted)}
  .cms-modal .foot{display:flex;gap:8px;justify-content:flex-end;margin-top:16px;flex-wrap:wrap}
  #cms-toast{position:fixed;left:50%;top:84px;transform:translateX(-50%);display:flex;flex-direction:column;gap:8px;align-items:center;pointer-events:none}
  #cms-toast div{padding:10px 16px;border-radius:12px;background:var(--bg);border:1px solid var(--a1);box-shadow:0 12px 30px rgba(0,0,0,.4);max-width:min(520px,92vw)}
  #cms-toast div.warn{border-color:#fb7185}#cms-toast div.ok{border-color:#34d399}
  body.cms-editing [data-region] [data-cms-ed]{cursor:text;transition:outline-color .15s}
  body.cms-editing [data-region] [data-cms-ed]:hover{outline:1px dashed var(--a1);outline-offset:2px}
  body.cms-editing [data-region] [data-cms-ed]:focus{outline:2px solid var(--a1);outline-offset:2px;border-radius:4px}
  body.cms-editing [data-region] .cms-sel{outline:2px solid var(--a2);outline-offset:3px}
  body.cms-editing [data-region] .glass:hover,body.cms-editing [data-region] .btn:hover,body.cms-editing [data-region] .now-card:hover{transform:none!important}
  body.cms-editing .reveal{opacity:1!important;transform:none!important}
  body.cms-editing{padding-bottom:90px}
  `;
  document.head.appendChild(s);
}

function h(tag, props, ...kids) {
  const e = document.createElement(tag);
  Object.entries(props || {}).forEach(([k, v]) => { if (k === 'class') e.className = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v); });
  kids.flat().forEach(k => e.append(k && k.nodeType ? k : document.createTextNode(k == null ? '' : k)));
  return e;
}

function buildUI() {
  if (ui.bar) return;
  injectStyle();
  ui.who = h('span', { class: 'who' });
  const mk = (label, fn, cls) => h('button', { class: 'cms-btn ' + (cls || ''), type: 'button', onclick: fn }, label);
  ui.edit = mk('✏️ Edit page', enterEdit, 'pri');
  ui.save = mk('💾 Save', save, 'pri hide'); ui.save.disabled = true;
  ui.photo = mk('🖼 Photo', pickPhoto, 'hide');
  ui.settings = mk('⚙ Settings', openSettings);
  ui.history = mk('🕘 History', openHistory);
  ui.done = mk('Done', done, 'hide');
  ui.discard = mk('↩ Discard', discard, 'hide danger');
  ui.logout = mk('Logout', () => backend && backend.logout());
  ui.bar = h('div', { id: 'cms-bar', class: 'cms-ui' }, ui.who, ui.edit, ui.save, ui.photo, ui.settings, ui.history, ui.done, ui.discard, ui.logout);

  ui.item = h('div', { id: 'cms-item', class: 'cms-ui' },
    h('button', { title: 'Move up / earlier', onclick: () => moveItem(-1) }, '↑'),
    h('button', { title: 'Move down / later', onclick: () => moveItem(1) }, '↓'),
    h('button', { title: 'Duplicate', onclick: dupItem }, '⧉'),
    h('button', { title: 'Select the outer block', onclick: parentItem }, '⤴'),
    h('button', { title: 'Delete', onclick: delItem }, '✕'));

  ui.prop = h('div', { id: 'cms-prop', class: 'cms-ui' });
  ui.toast = h('div', { id: 'cms-toast', class: 'cms-ui' });
  ui.file = h('input', { type: 'file', accept: 'image/*', style: 'display:none', onchange: onPhotoFile });

  ui.loginBack = h('div', { class: 'cms-back cms-ui' }, h('div', { class: 'cms-modal', style: 'text-align:center' },
    h('h3', {}, 'Admin login'),
    h('p', { id: 'cms-login-msg' }, 'Sign in with the Google account that owns this site.'),
    h('div', { class: 'foot', style: 'justify-content:center' },
      h('button', { class: 'cms-btn pri', type: 'button', onclick: doLogin }, DEMO ? 'Start demo session' : 'Sign in with Google'),
      h('button', { class: 'cms-btn', type: 'button', onclick: hideLogin }, 'Cancel'))));
  ui.modalBack = h('div', { class: 'cms-back cms-ui', onclick: e => { if (e.target === ui.modalBack) closeModal(); } });

  document.body.append(ui.bar, ui.item, ui.prop, ui.toast, ui.file, ui.loginBack, ui.modalBack);

  // global behaviours (only act while editing)
  document.addEventListener('input', e => { if (editing && e.target.closest && e.target.closest('[data-region]')) setDirty(true); }, true);
  document.addEventListener('keydown', e => {
    if (!editing) return;
    if (e.key === 'Enter' && e.target.closest && e.target.closest('[data-cms-ed]')) { e.preventDefault(); e.target.blur(); }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(); }
  }, true);
  document.addEventListener('click', onEditClick, true);
  document.addEventListener('pointerover', onHover, true);
  addEventListener('scroll', placeItemTools, { passive: true });
  addEventListener('resize', placeItemTools);
  addEventListener('beforeunload', e => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });
}

function showBar() {
  ui.who.textContent = (DEMO ? 'Demo mode' : user.email);
  ui.bar.classList.add('on');
}
function hideBar() { ui.bar.classList.remove('on'); }
function showLogin() {
  if (!ui.loginBack) return;
  ui.loginBack.classList.add('on');
  $('#cms-login-msg').textContent = DEMO ? 'Local demo mode: no real login. Changes stay in this browser only.' : 'Sign in with the Google account that owns this site.';
}
function hideLogin() { ui.loginBack && ui.loginBack.classList.remove('on'); }
async function doLogin() {
  try { await backend.login(); }
  catch (e) { console.error(e); if (e && e.code !== 'auth/popup-closed-by-user') toast('Login failed: ' + (e.code || e.message || e), 'warn'); }
}
function toast(msg, kind) {
  buildUI();
  const t = h('div', { class: kind || '' }, msg); ui.toast.appendChild(t);
  setTimeout(() => t.remove(), kind === 'warn' ? 7000 : 3500);
}
function setDirty(v) { dirty = v; ui.save.disabled = !v; ui.who.textContent = (DEMO ? 'Demo mode' : user.email) + (v ? ' • unsaved' : ''); }

/* ================= edit mode ================= */
const BLOCK = 'div,p,h1,h2,h3,h4,ul,ol,li,section,header,footer,dl,dt,dd,button,img,iframe,svg';
const NO_EDIT = new Set(['BUTTON', 'IMG', 'IFRAME', 'SVG', 'PATH', 'SCRIPT', 'STYLE', 'BR']);
const PLAIN = (() => { const d = document.createElement('div'); try { d.contentEditable = 'plaintext-only'; return d.contentEditable === 'plaintext-only'; } catch (e) { return false; } })();

function makeEditable(root) {
  const marked = [];
  $$('*', root).forEach(el => {
    if (NO_EDIT.has(el.tagName.toUpperCase()) || el.closest('svg')) return;
    if (marked.some(m => m.contains(el))) return;
    if (!el.textContent.trim() || el.querySelector(BLOCK)) return;
    el.setAttribute('contenteditable', PLAIN ? 'plaintext-only' : 'true');
    el.setAttribute('data-cms-ed', '');
    el.spellcheck = false;
    marked.push(el);
  });
}
function clearEditable(root) {
  $$('[data-cms-ed]', root).forEach(e => { e.removeAttribute('contenteditable'); e.removeAttribute('data-cms-ed'); e.removeAttribute('spellcheck'); });
}
function regions() { return Object.entries(CMS.REG).map(([name, r]) => [name, r.el]); }

function enterEdit() {
  editing = true; window.__siteEditing = true;
  document.body.classList.add('cms-editing');
  $$('[data-region] .reveal').forEach(n => n.classList.add('show'));
  $$('[data-region] [data-count]').forEach(n => { n.textContent = (n.dataset.prefix || '') + n.dataset.count; });
  $$('[data-region] .opanel').forEach(p => { p.hidden = false; });
  regions().forEach(([, el]) => makeEditable(el));
  baseline = {}; regions().forEach(([n, el]) => { baseline[n] = serializeRegion(el); });
  ui.edit.classList.add('hide'); ['save', 'photo', 'done', 'discard'].forEach(k => ui[k].classList.remove('hide'));
  setDirty(false);
  toast('Edit mode: click any text to change it. Hover a card or row for move / copy / delete.', 'ok');
}
function leaveEdit() {
  editing = false; window.__siteEditing = false;
  regions().forEach(([, el]) => clearEditable(el));
  $$('.cms-sel').forEach(e => e.classList.remove('cms-sel'));
  const act = $('.otab.active');
  $$('.opanel').forEach(p => { p.hidden = !!act && p.id !== act.dataset.panel; });
  document.body.classList.remove('cms-editing');
  ui.item.classList.remove('on'); ui.prop.classList.remove('on'); selItem = null;
  ui.edit.classList.remove('hide'); ['save', 'photo', 'done', 'discard'].forEach(k => ui[k].classList.add('hide'));
  if (window.SITE) window.SITE.observeReveal();
}
function done() { if (dirty && !confirm('You have unsaved changes. Leave edit mode and lose them?')) return; if (dirty) { location.reload(); return; } leaveEdit(); }
function discard() { if (dirty && !confirm('Discard all unsaved changes?')) return; location.reload(); }

function serializeRegion(el) {
  const c = el.cloneNode(true);
  c.querySelectorAll('[contenteditable]').forEach(e => e.removeAttribute('contenteditable'));
  c.querySelectorAll('[data-cms-ed]').forEach(e => e.removeAttribute('data-cms-ed'));
  c.querySelectorAll('[spellcheck]').forEach(e => e.removeAttribute('spellcheck'));
  c.querySelectorAll('.show').forEach(e => e.classList.remove('show'));
  c.querySelectorAll('.cms-sel').forEach(e => e.classList.remove('cms-sel'));
  c.querySelectorAll('[data-count]').forEach(b => {
    const m = b.textContent.trim().match(/^(\D*)(\d+)$/);
    if (m) { b.dataset.count = m[2]; if (m[1]) b.dataset.prefix = m[1]; else b.removeAttribute('data-prefix'); }
    else { b.removeAttribute('data-count'); b.removeAttribute('data-prefix'); }
  });
  c.querySelectorAll('#type').forEach(t => { t.textContent = ''; });
  c.querySelectorAll('img[data-photo]').forEach(i => i.setAttribute('src', 'photo.jpg'));
  const act = c.querySelector('.otab.active');
  c.querySelectorAll('.opanel').forEach(p => { if (act) p.hidden = p.id !== act.dataset.panel; });
  return c.innerHTML;
}

/* ---------- item tools (move / duplicate / delete) ---------- */
const LIST_PARENTS = '.grid,.timeline,.steps,.stats,.now,.tags,.values,.promise,.contact-grid,.grid4,.vm,.btns,.socials';
function isItem(n, p) {
  if (p.matches('.cbox,.opanel,.office-info')) return n.classList.contains('row');
  if (p.matches('dl')) return n.tagName === 'DIV';
  return p.matches(LIST_PARENTS);
}
function itemAt(start) {
  for (let n = start; n && n !== document.body; n = n.parentElement) {
    if (n.closest && !n.closest('[data-region]')) return null;
    if (n.parentElement && n.parentElement.closest('[data-region]') && isItem(n, n.parentElement)) return n;
  }
  return null;
}
function onHover(e) {
  if (!editing || !e.target.closest) return;
  if (e.target.closest('.cms-ui')) return;
  const it = itemAt(e.target);
  if (it && it !== selItem) selectItem(it);
}
function selectItem(it) {
  if (selItem) selItem.classList.remove('cms-sel');
  selItem = it;
  if (it) it.classList.add('cms-sel');
  placeItemTools();
}
function placeItemTools() {
  if (!selItem || !editing) { ui.item.classList.remove('on'); return; }
  const r = selItem.getBoundingClientRect();
  if (r.bottom < 0 || r.top > innerHeight) { ui.item.classList.remove('on'); return; }
  ui.item.classList.add('on');
  const w = ui.item.offsetWidth || 160;
  const inside = r.height >= 70;
  ui.item.style.left = Math.max(8, Math.min(innerWidth - w - 8, r.right - w - (inside ? 6 : 0))) + 'px';
  ui.item.style.top = Math.max(76, Math.min(innerHeight - 120, inside ? r.top + 6 : r.top - 38)) + 'px';
}
function moveItem(dir) {
  if (!selItem) return;
  if (dir < 0 && selItem.previousElementSibling) selItem.parentNode.insertBefore(selItem, selItem.previousElementSibling);
  else if (dir > 0 && selItem.nextElementSibling) selItem.parentNode.insertBefore(selItem.nextElementSibling, selItem);
  else return;
  setDirty(true); placeItemTools();
}
function dupItem() {
  if (!selItem) return;
  const c = selItem.cloneNode(true);
  [c, ...c.querySelectorAll('[id]')].forEach(n => n.removeAttribute && n.removeAttribute('id'));
  c.classList.remove('cms-sel');
  selItem.after(c); setDirty(true); selectItem(c);
}
function parentItem() {
  if (!selItem || !selItem.parentElement) return;
  const up = itemAt(selItem.parentElement);
  if (up) selectItem(up); else toast('This is the outermost block.');
}
function delItem() {
  if (!selItem) return;
  if (!confirm('Delete this block?')) return;
  const n = selItem; selectItem(null); n.remove(); setDirty(true);
}

/* ---------- links / office tabs ---------- */
function onEditClick(e) {
  if (!editing || !e.target.closest) return;
  if (e.target.closest('.cms-ui')) return;
  const inRegion = e.target.closest('[data-region]');
  if (!inRegion) return;
  const tab = e.target.closest('.otab');
  const a = e.target.closest('a');
  const btn = e.target.closest('button');
  if (tab) { e.preventDefault(); e.stopPropagation(); showProp('tab', tab); return; }
  if (a) { e.preventDefault(); e.stopPropagation(); showProp('link', a); return; }
  if (btn) { e.preventDefault(); e.stopPropagation(); return; }
  hideProp();
}
function showProp(kind, target) {
  propTarget = target; ui.prop.textContent = '';
  const field = (label, val) => { const i = h('input', { value: val }); ui.prop.append(h('label', {}, label), i); return i; };
  if (kind === 'link') {
    const i = field('Link to', target.getAttribute('href') || '');
    ui.prop.append(h('button', { class: 'cms-btn pri', onclick: () => { target.setAttribute('href', i.value.trim()); if (/^https?:/i.test(i.value)) { target.setAttribute('target', '_blank'); target.setAttribute('rel', 'noopener'); } else target.removeAttribute('target'); setDirty(true); hideProp(); } }, 'Apply'));
  } else {
    const l = field('Tab name', target.textContent.trim());
    const m = field('Map search', decodeURIComponent(target.dataset.map || ''));
    ui.prop.append(h('button', { class: 'cms-btn pri', onclick: () => {
      target.textContent = l.value.trim() || target.textContent;
      const q = m.value.trim();
      if (q) { target.dataset.map = encodeURIComponent(q); target.dataset.dir = encodeURIComponent(q).replace(/%20/g, '+'); target.dataset.title = 'Map of ' + q; }
      setDirty(true); hideProp();
      if (q && target.classList.contains('active') && window.SITE) window.SITE.activateOfficeTab(target);
    } }, 'Apply'));
  }
  ui.prop.append(h('button', { class: 'cms-btn', onclick: hideProp }, 'Close'));
  ui.prop.classList.add('on');
}
function hideProp() { ui.prop.classList.remove('on'); propTarget = null; }

/* ---------- photo ---------- */
function pickPhoto() { ui.file.value = ''; ui.file.click(); }
async function onPhotoFile() {
  const f = ui.file.files && ui.file.files[0]; if (!f) return;
  try {
    const bmp = await createImageBitmap(f);
    const scale = Math.min(1, 720 / Math.max(bmp.width, bmp.height));
    const cv = document.createElement('canvas'); cv.width = Math.round(bmp.width * scale); cv.height = Math.round(bmp.height * scale);
    cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height);
    let q = 0.86, url = cv.toDataURL('image/jpeg', q);
    while (url.length > 260000 && q > 0.4) { q -= 0.1; url = cv.toDataURL('image/jpeg', q); }
    settings.photo = url; CMS.setPhoto(url); setDirty(true);
    toast('Photo updated. Press Save to publish it.', 'ok');
  } catch (e) { console.error(e); toast('Could not read that image.', 'warn'); }
}

/* ---------- save ---------- */
async function save() {
  if (!dirty) return;
  ui.save.disabled = true; ui.who.textContent = 'Saving…';
  try {
    const next = Object.assign({}, overrides);
    regions().forEach(([name, el]) => { const now = serializeRegion(el); if (now !== baseline[name]) next[name] = now; });
    const payload = { v: 1, regions: next, settings: Object.assign({}, settings) };
    const json = JSON.stringify(payload);
    if (json.length > 900000) throw new Error('content is too large (' + Math.round(json.length / 1024) + ' KB)');
    if (lastRaw) await backend.archive(lastRaw, user.email);
    await backend.write(json, user.email);
    lastRaw = json; overrides = next; CMS.rawJson = json; CMS.content = payload;
    try { localStorage.setItem(CMS.cacheKey, json); } catch (e) {}
    regions().forEach(([name, el]) => { baseline[name] = serializeRegion(el); CMS.REG[name].applied = typeof next[name] === 'string' ? next[name] : null; });
    setDirty(false);
    toast(backend.demo ? 'Saved in this browser (demo mode).' : 'Saved. Your website is updated.', 'ok');
  } catch (e) {
    console.error(e); setDirty(true);
    toast('Save failed: ' + (e.code || e.message || e) + (String(e.code).includes('permission') ? '. Check firestore.rules and the admin email.' : ''), 'warn');
  }
}

/* ---------- modals: settings / history ---------- */
function openModal(node) { ui.modalBack.textContent = ''; ui.modalBack.append(node); ui.modalBack.classList.add('on'); }
function closeModal() { ui.modalBack.classList.remove('on'); }

function openSettings() {
  const words = h('textarea', {}); words.value = (settings.typing && settings.typing.length ? settings.typing : (window.SITE ? window.SITE.getWords() : [])).join('\n');
  const rows = regions().map(([name, el]) => {
    const edited = typeof overrides[name] === 'string';
    const b = h('button', { class: 'cms-btn danger', onclick: () => resetRegion(name, el) }, 'Reset');
    b.disabled = !edited;
    return h('div', { class: 'row' }, h('div', {}, h('b', {}, name), ' ', h('small', {}, edited ? 'customised' : 'original')), b);
  });
  openModal(h('div', { class: 'cms-modal' },
    h('h3', {}, 'Site settings'),
    h('p', {}, 'Typing animation in the hero, one phrase per line.'),
    words,
    h('div', { class: 'foot' },
      h('button', { class: 'cms-btn', onclick: () => { if (!editing) enterEdit(); settings.photo = ''; CMS.setPhoto(''); setDirty(true); closeModal(); toast('Photo reset. Press Save.'); } }, 'Reset photo'),
      h('button', { class: 'cms-btn pri', onclick: () => {
        const list = words.value.split('\n').map(s => s.trim()).filter(Boolean).slice(0, 12);
        settings.typing = list; if (window.SITE) window.SITE.setWords(list.length ? list : window.SITE.getWords());
        if (!editing) enterEdit(); setDirty(true); closeModal(); toast('Typing text updated. Press Save.');
      } }, 'Apply')),
    h('h3', { style: 'margin-top:20px' }, 'Reset a section'),
    h('p', {}, 'Go back to the original design of one section. Press Save afterwards.'),
    ...rows,
    h('div', { class: 'foot' }, h('button', { class: 'cms-btn', onclick: closeModal }, 'Close'))));
}
function resetRegion(name, el) {
  if (!confirm('Reset the "' + name + '" section to its original content?')) return;
  const r = CMS.REG[name]; el.innerHTML = r.html; delete overrides[name];
  if (editing) { makeEditable(el); $$('.reveal', el).forEach(n => n.classList.add('show')); $$('.opanel', el).forEach(p => { p.hidden = false; }); baseline[name] = serializeRegion(el); }
  r.applied = null;
  if (!editing) enterEdit();
  setDirty(true); closeModal(); toast('Section reset. Press Save to publish.');
}

async function openHistory() {
  const box = h('div', { class: 'cms-modal' }, h('h3', {}, 'Version history'), h('p', {}, 'Loading…'));
  openModal(box);
  try {
    const list = await backend.versions();
    box.textContent = '';
    box.append(h('h3', {}, 'Version history'), h('p', {}, list.length ? 'Each save keeps the version before it. Restoring puts it on the page; press Save to publish it.' : 'No earlier versions yet. They appear after the second save.'));
    list.forEach(v => {
      box.append(h('div', { class: 'row' },
        h('div', {}, h('b', {}, v.at ? v.at.toLocaleString() : 'unknown time'), h('br'), h('small', {}, (v.by || '') + ' · ' + Math.round((v.json || '').length / 1024) + ' KB')),
        h('button', { class: 'cms-btn', onclick: () => restore(v) }, 'Restore')));
    });
    box.append(h('div', { class: 'foot' }, h('button', { class: 'cms-btn', onclick: closeModal }, 'Close')));
  } catch (e) { console.error(e); box.textContent = ''; box.append(h('h3', {}, 'Version history'), h('p', {}, 'Could not load: ' + (e.message || e)), h('div', { class: 'foot' }, h('button', { class: 'cms-btn', onclick: closeModal }, 'Close'))); }
}
function restore(v) {
  if (!confirm('Put this version on the page? Unsaved edits will be replaced.')) return;
  try {
    const c = JSON.parse(v.json);
    if (!editing) enterEdit();
    const over = c.regions || {};
    regions().forEach(([name, el]) => {
      el.innerHTML = CMS.sanitize(typeof over[name] === 'string' ? over[name] : CMS.REG[name].html);
      makeEditable(el); $$('.reveal', el).forEach(n => n.classList.add('show')); $$('.opanel', el).forEach(p => { p.hidden = false; });
    });
    overrides = Object.assign({}, over); settings = Object.assign({}, c.settings || {});
    CMS.setPhoto(settings.photo || ''); if (window.SITE && settings.typing) window.SITE.setWords(settings.typing);
    baseline = {}; regions().forEach(([n, el]) => { baseline[n] = serializeRegion(el); });
    setDirty(true); closeModal(); toast('Version restored on the page. Press Save to publish.', 'ok');
  } catch (e) { console.error(e); toast('That version could not be restored.', 'warn'); }
}
