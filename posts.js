/* Public "Blogs" feed (like a page timeline): posts with photos, Like, Comment, Share.
   Posts live in Supabase (site_posts, photos in the public bucket post-images).
   Likes and comments go through SQL functions only; comments are shown after admin approval.
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
  var onAction = null, onAdminComment = null;

  function lsGet(k, d) { try { var v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  var VID = lsGet('cms.visitor', null);
  if (!VID) { VID = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : (String(Math.random()).slice(2) + String(Date.now()) + 'visitor'); lsSet('cms.visitor', VID); }
  var LIKED = {}; try { LIKED = JSON.parse(lsGet('cms.liked', '{}')) || {}; } catch (e) {}

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
    if (s < 86400 * 7) { var n = Math.floor(s / 86400); return n + ' day' + (n > 1 ? 's' : '') + ' ago'; }
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }
  function full(d) {
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) + ' at ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }
  function plural(n, w) { return n + ' ' + w + (n === 1 ? '' : 's'); }
  function findPost(id) { for (var i = 0; i < S.items.length; i++) if (Number(S.items[i].id) === Number(id)) return S.items[i]; return null; }
  function postUrl(p) { return location.origin + location.pathname + '#post-' + Number(p.id); }

  function statsHtml(p) {
    var l = Number(p.like_count) || 0, c = Number(p.comment_count) || 0;
    return (l ? '<span>👍 ' + l + '</span>' : '') + (c ? '<button type="button" class="plink" data-act="comments">' + plural(c, 'comment') + '</button>' : '');
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
    var social = HAS ?
      '<div class="pstats">' + statsHtml(p) + '</div>' +
      '<div class="pacts"><button type="button" data-act="like" class="' + (LIKED[p.id] ? 'on' : '') + '">' + (LIKED[p.id] ? '👍 Liked' : '👍 Like') + '</button>' +
      '<button type="button" data-act="comments">💬 Comment</button><button type="button" data-act="share">↗ Share</button></div>' +
      '<div class="pshare" hidden></div><div class="pcom" hidden></div>' : '';
    var tools = S.admin ? '<div class="ptools"><button type="button" data-act="pin">' + (p.pinned ? '📌 Unpin' : '📌 Pin') + '</button><button type="button" data-act="edit">✎ Edit</button><button type="button" data-act="del">🗑 Delete</button></div>' : '';
    return '<article class="post glass reveal" id="post-' + Number(p.id) + '" data-id="' + Number(p.id) + '">' +
      '<header class="phead"><span class="pav"></span><div><b>Md. Kanon Ahmed</b><small title="' + esc(full(d)) + '">' + esc(ago(d)) + '</small></div>' +
      (p.pinned ? '<span class="ppin">📌 Pinned</span>' : '') +
      '<span class="pkind k-' + esc(KINDS[p.kind] ? p.kind : 'update') + '">' + k[0] + ' ' + k[1] + '</span></header>' +
      (p.title ? '<h3 class="ptitle">' + esc(p.title) + '</h3>' : '') +
      (p.body ? '<div class="pbody">' + linkify(p.body) + '</div>' : '') + gal + social + tools + '</article>';
  }

  function render() {
    if (S.error && !S.items.length) root.innerHTML = '<p class="posts-empty">Blogs could not be loaded right now. Please try again later.</p>';
    else if (!S.items.length) root.innerHTML = '<p class="posts-empty">' + (S.loading ? 'Loading…' : (S.admin ? 'No posts yet. Write your first blog post above.' : 'New blog posts will appear here soon.')) + '</p>';
    else root.innerHTML = S.items.map(card).join('');
    if (moreBtn) moreBtn.hidden = !S.more;
    if (window.SITE) window.SITE.observeReveal(root);
  }

  var FIELDS = 'id,title,body,images,kind,pinned,posted_at,like_count,comment_count';
  function fetchPage(offset) {
    if (HAS) {
      var url = BASE + '/rest/v1/site_posts?select=' + FIELDS + '&order=pinned.desc,posted_at.desc&limit=' + (PAGE + 1) + '&offset=' + offset;
      return fetch(url, { headers: { apikey: SB.anonKey }, cache: 'no-store' }).then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      });
    }
    if (window.CMS && window.CMS.isLocal) {
      try {
        var all = JSON.parse(lsGet('cms.demo.posts', '[]'));
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
    }).catch(function () { S.error = true; }).then(function () { S.loading = false; render(); focusHash(); });
  }

  /* open a shared link like /#post-12 */
  var hashDone = false;
  function focusHash() {
    var m = /^#post-(\d+)$/.exec(location.hash);
    if (!m || hashDone) return;
    var id = Number(m[1]);
    function go() {
      var el = document.getElementById('post-' + id); if (!el) return;
      hashDone = true; el.classList.add('flash');
      setTimeout(function () { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, 200);
      setTimeout(function () { el.classList.remove('flash'); }, 3500);
    }
    if (document.getElementById('post-' + id)) return go();
    if (!HAS) return;
    fetch(BASE + '/rest/v1/site_posts?id=eq.' + id + '&select=' + FIELDS, { headers: { apikey: SB.anonKey } })
      .then(function (r) { return r.json(); }).then(function (rows) {
        if (rows && rows[0]) { S.items.unshift(rows[0]); render(); go(); } else hashDone = true;
      }).catch(function () { hashDone = true; });
  }

  /* ---------- like ---------- */
  function rpc(name, body) {
    return fetch(BASE + '/rest/v1/rpc/' + name, { method: 'POST', headers: { apikey: SB.anonKey, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) { return r.text().then(function (t) { if (!r.ok) throw new Error(t || ('HTTP ' + r.status)); return t ? JSON.parse(t) : null; }); });
  }
  function paintLike(art, p) {
    var b = art.querySelector('[data-act="like"]'), on = !!LIKED[p.id];
    b.className = on ? 'on' : ''; b.textContent = on ? '👍 Liked' : '👍 Like';
    art.querySelector('.pstats').innerHTML = statsHtml(p);
  }
  function like(art, p) {
    var was = !!LIKED[p.id], before = Number(p.like_count) || 0;
    if (was) delete LIKED[p.id]; else LIKED[p.id] = 1;
    p.like_count = Math.max(0, before + (was ? -1 : 1)); paintLike(art, p); lsSet('cms.liked', JSON.stringify(LIKED));
    rpc('toggle_like', { p_post: Number(p.id), p_visitor: VID }).then(function (rows) {
      var r = rows && rows[0]; if (!r) return;
      if (r.liked) LIKED[p.id] = 1; else delete LIKED[p.id];
      p.like_count = r.total; lsSet('cms.liked', JSON.stringify(LIKED)); paintLike(art, p);
    }).catch(function () {
      if (was) LIKED[p.id] = 1; else delete LIKED[p.id];
      p.like_count = before; lsSet('cms.liked', JSON.stringify(LIKED)); paintLike(art, p);
    });
  }

  /* ---------- share ---------- */
  function share(art, p) {
    var box = art.querySelector('.pshare'), url = postUrl(p), text = (p.title || (p.body || '').slice(0, 80) || 'Blog post by Md. Kanon Ahmed');
    if (!box.hidden) { box.hidden = true; return; }
    box.innerHTML = '<button type="button" data-share="copy">🔗 Copy link</button>' +
      '<a target="_blank" rel="noopener" href="https://wa.me/?text=' + encodeURIComponent(text + ' ' + url) + '">WhatsApp</a>' +
      '<a target="_blank" rel="noopener" href="https://www.facebook.com/sharer/sharer.php?u=' + encodeURIComponent(url) + '">Facebook</a>' +
      '<a target="_blank" rel="noopener" href="https://www.linkedin.com/sharing/share-offsite/?url=' + encodeURIComponent(url) + '">LinkedIn</a>' +
      (navigator.share ? '<button type="button" data-share="native">More…</button>' : '');
    box.hidden = false;
    box.onclick = function (e) {
      var b = e.target.closest('[data-share]'); if (!b) return;
      if (b.dataset.share === 'native') { navigator.share({ title: text, url: url }).catch(function () {}); return; }
      var done = function () { b.textContent = '✓ Link copied'; };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done, function () { window.prompt('Copy this link:', url); });
      else window.prompt('Copy this link:', url);
    };
  }

  /* ---------- comments ---------- */
  function commentsHtml(rows) {
    if (!rows.length) return '<p class="pc-empty">No comments yet. Be the first!</p>';
    return rows.map(function (c) {
      return '<div class="pc"><span class="pc-av">' + esc((c.name || '?').charAt(0).toUpperCase()) + '</span><div class="pc-b"><b>' + esc(c.name) + '</b> <small>' + esc(ago(new Date(c.created_at))) + '</small><div>' + linkify(c.body) + '</div></div></div>';
    }).join('');
  }
  function formHtml() {
    return S.admin
      ? '<form class="pform"><textarea name="body" maxlength="1000" placeholder="Reply as Md. Kanon Ahmed…" required></textarea><button class="btn primary sm" type="submit">Reply</button></form>'
      : '<form class="pform"><input name="name" maxlength="60" placeholder="Your name" required value="' + esc(lsGet('cms.cname', '')) + '"><textarea name="body" maxlength="1000" placeholder="Write a comment…" required></textarea><input name="website" class="hp" tabindex="-1" autocomplete="off" aria-hidden="true"><div class="pf-row"><button class="btn primary sm" type="submit">Send</button><small>Comments appear after approval.</small></div><p class="pf-msg" role="status"></p></form>';
  }
  function loadComments(box, p) {
    return fetch(BASE + '/rest/v1/post_comments?post_id=eq.' + Number(p.id) + '&select=id,name,body,created_at&order=created_at.asc&limit=100', { headers: { apikey: SB.anonKey }, cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error(); return r.json(); })
      .then(function (rows) { box.querySelector('.pc-list').innerHTML = commentsHtml(rows); })
      .catch(function () { box.querySelector('.pc-list').innerHTML = '<p class="pc-empty">Comments could not be loaded.</p>'; });
  }
  function comments(art, p) {
    var box = art.querySelector('.pcom');
    if (!box.hidden) { box.hidden = true; return; }
    box.hidden = false;
    box.innerHTML = '<div class="pc-list"><p class="pc-empty">Loading…</p></div>' + formHtml();
    loadComments(box, p);
    var form = box.querySelector('form'), msg = box.querySelector('.pf-msg');
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var body = form.body.value.trim(); if (!body) return;
      var btn = form.querySelector('button[type=submit]'); btn.disabled = true;
      if (S.admin && onAdminComment) {
        onAdminComment(p, body).then(function () { form.body.value = ''; p.comment_count = (Number(p.comment_count) || 0) + 1; art.querySelector('.pstats').innerHTML = statsHtml(p); return loadComments(box, p); })
          .catch(function () { }).then(function () { btn.disabled = false; });
        return;
      }
      if (form.website.value) { msg.textContent = 'Thanks! Your comment will appear after approval.'; form.body.value = ''; btn.disabled = false; return; }
      var last = Number(lsGet('cms.lastc', '0')) || 0;
      if (Date.now() - last < 30000) { msg.className = 'pf-msg err'; msg.textContent = 'Please wait a moment before commenting again.'; btn.disabled = false; return; }
      var name = form.name.value.trim(); if (!name) { btn.disabled = false; return; }
      rpc('add_comment', { p_post: Number(p.id), p_name: name, p_body: body }).then(function () {
        lsSet('cms.lastc', String(Date.now())); lsSet('cms.cname', name);
        form.body.value = ''; msg.className = 'pf-msg ok'; msg.textContent = 'Thanks! Your comment will appear after approval.';
      }).catch(function () { msg.className = 'pf-msg err'; msg.textContent = 'Sorry, your comment could not be sent. Please try again later.'; })
        .then(function () { btn.disabled = false; });
    });
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
    var p = findPost(art.dataset.id); if (!p) return;
    var act = e.target.closest('[data-act]');
    if (act) {
      var a = act.dataset.act;
      if (a === 'like') like(art, p);
      else if (a === 'comments') comments(art, p);
      else if (a === 'share') share(art, p);
      else if (S.admin && onAction) onAction(a, p);
      return;
    }
    var im = e.target.closest('.pimg');
    if (im) { var list = (p.images || []).filter(okImg); lightbox(list, Math.min(Number(im.dataset.i) || 0, list.length - 1)); }
  });
  if (moreBtn) moreBtn.addEventListener('click', function () { load(false); });

  window.POSTS = {
    reload: function () { S.loading = false; load(true); },
    setAdmin: function (v) { S.admin = !!v; render(); },
    onAction: function (fn) { onAction = fn; },
    onAdminComment: function (fn) { onAdminComment = fn; },
    kinds: KINDS
  };
  load(true);
})();
