/* Public "Latest updates" feed (like a page timeline).
   Posts live in Supabase (table site_posts, photos in the public bucket post-images).
   Anyone can read; only the admin can add, edit or delete (admin.js adds those tools). */
(function () {
  'use strict';
  var CFG = window.SITE_CONFIG || {}, SB = CFG.supabase || {};
  var HAS = !!(SB.url && SB.anonKey), PAGE = 6;
  var root = document.getElementById('posts');
  if (!root) return;
  var moreBtn = document.getElementById('posts-more');
  var BASE = HAS ? String(SB.url).replace(/\/$/, '') : '';
  var KINDS = { update: ['📣', 'Update'], meeting: ['📅', 'Meeting'], event: ['🎉', 'Event'], news: ['📰', 'News'] };
  var S = { items: [], offset: 0, more: false, loading: false, admin: false, error: false };
  var onAction = null;

  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function linkify(t) {
    return esc(t).replace(/(https?:\/\/[^\s<]+[^\s<.,;:!?)\]])/g, '<a href="$1" target="_blank" rel="noopener">$1</a>').replace(/\r?\n/g, '<br>');
  }
  function okImg(u) {
    u = String(u || '');
    if (HAS) return u.indexOf(BASE + '/storage/v1/object/public/post-images/') === 0;
    return /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(u);
  }
  function ago(d) {
    var s = (Date.now() - d.getTime()) / 1000;
    if (s < 60) return 'Just now';
    if (s < 3600) return Math.floor(s / 60) + ' min ago';
    if (s < 86400) return Math.floor(s / 3600) + ' hr ago';
    if (s < 86400 * 7) return Math.floor(s / 86400) + ' day' + (Math.floor(s / 86400) > 1 ? 's' : '') + ' ago';
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }
  function full(d) {
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) + ' at ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }

  function card(p) {
    var k = KINDS[p.kind] || KINDS.update, d = new Date(p.posted_at);
    var imgs = (p.images || []).filter(okImg).slice(0, 10), n = imgs.length, gal = '';
    if (n) {
      gal = '<div class="pg pg' + Math.min(n, 4) + '">' + imgs.slice(0, 4).map(function (u, i) {
        var more = (i === 3 && n > 4) ? '<span class="pmore">+' + (n - 4) + '</span>' : '';
        return '<button type="button" class="pimg" data-i="' + i + '" aria-label="Open photo ' + (i + 1) + '"><img loading="lazy" decoding="async" alt="" src="' + esc(u) + '">' + more + '</button>';
      }).join('') + '</div>';
    }
    var tools = S.admin ? '<div class="ptools"><button type="button" data-act="pin">' + (p.pinned ? '📌 Unpin' : '📌 Pin') + '</button><button type="button" data-act="edit">✎ Edit</button><button type="button" data-act="del">🗑 Delete</button></div>' : '';
    return '<article class="post glass reveal" data-id="' + Number(p.id) + '">' +
      '<header class="phead"><span class="pav"></span><div><b>Md. Kanon Ahmed</b><small title="' + esc(full(d)) + '">' + esc(ago(d)) + '</small></div>' +
      (p.pinned ? '<span class="ppin">📌 Pinned</span>' : '') +
      '<span class="pkind k-' + esc(KINDS[p.kind] ? p.kind : 'update') + '">' + k[0] + ' ' + k[1] + '</span></header>' +
      (p.body ? '<div class="pbody">' + linkify(p.body) + '</div>' : '') + gal + tools + '</article>';
  }

  function render() {
    if (S.error && !S.items.length) root.innerHTML = '<p class="posts-empty">Updates could not be loaded right now. Please try again later.</p>';
    else if (!S.items.length) root.innerHTML = '<p class="posts-empty">' + (S.loading ? 'Loading updates…' : (S.admin ? 'No posts yet. Write your first update above.' : 'Updates will appear here soon.')) + '</p>';
    else root.innerHTML = S.items.map(card).join('');
    if (moreBtn) moreBtn.hidden = !S.more;
    if (window.SITE) window.SITE.observeReveal(root);
  }

  function fetchPage(offset) {
    if (HAS) {
      var url = BASE + '/rest/v1/site_posts?select=id,body,images,kind,pinned,posted_at&order=pinned.desc,posted_at.desc&limit=' + (PAGE + 1) + '&offset=' + offset;
      return fetch(url, { headers: { apikey: SB.anonKey }, cache: 'no-store' }).then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      });
    }
    if (window.CMS && window.CMS.isLocal) {
      try {
        var all = JSON.parse(localStorage.getItem('cms.demo.posts') || '[]');
        all.sort(function (a, b) { return (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || new Date(b.posted_at) - new Date(a.posted_at); });
        return Promise.resolve(all.slice(offset, offset + PAGE + 1));
      } catch (e) {}
    }
    return Promise.resolve([]);
  }

  function load(reset) {
    if (S.loading) return;
    S.loading = true;
    if (reset) { S.offset = 0; S.items = []; }
    render();
    fetchPage(S.offset).then(function (rows) {
      S.more = rows.length > PAGE;
      var page = rows.slice(0, PAGE);
      S.items = S.items.concat(page); S.offset += page.length; S.error = false;
    }).catch(function () { S.error = true; }).then(function () { S.loading = false; render(); });
  }

  /* ---------- lightbox ---------- */
  function lightbox(list, i) {
    var lb = document.createElement('div'); lb.className = 'lb';
    var img = document.createElement('img');
    function show() { img.src = list[i]; }
    function close() { document.removeEventListener('keydown', key); lb.remove(); }
    function step(d) { i = (i + d + list.length) % list.length; show(); }
    function key(e) { if (e.key === 'Escape') close(); else if (e.key === 'ArrowRight') step(1); else if (e.key === 'ArrowLeft') step(-1); }
    function btn(t, cls, fn, label) { var b = document.createElement('button'); b.type = 'button'; b.className = cls; b.textContent = t; b.setAttribute('aria-label', label); b.addEventListener('click', function (e) { e.stopPropagation(); fn(); }); return b; }
    lb.append(img, btn('✕', 'lb-x', close, 'Close'));
    if (list.length > 1) lb.append(btn('‹', 'lb-p', function () { step(-1); }, 'Previous'), btn('›', 'lb-n', function () { step(1); }, 'Next'));
    lb.addEventListener('click', function (e) { if (e.target === lb) close(); });
    document.addEventListener('keydown', key); show(); document.body.appendChild(lb);
  }

  root.addEventListener('click', function (e) {
    var art = e.target.closest('.post'); if (!art) return;
    var p = S.items.filter(function (x) { return Number(x.id) === Number(art.dataset.id); })[0]; if (!p) return;
    var act = e.target.closest('[data-act]');
    if (act) { if (S.admin && onAction) onAction(act.dataset.act, p); return; }
    var im = e.target.closest('.pimg');
    if (im) { var list = (p.images || []).filter(okImg); lightbox(list, Math.min(Number(im.dataset.i) || 0, list.length - 1)); }
  });
  if (moreBtn) moreBtn.addEventListener('click', function () { load(false); });

  window.POSTS = {
    reload: function () { S.loading = false; load(true); },
    setAdmin: function (v) { S.admin = !!v; render(); },
    onAction: function (fn) { onAction = fn; },
    kinds: KINDS
  };
  load(true);
})();
