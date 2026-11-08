/* Public side of the site editor.
   - remembers the original HTML of every [data-region]
   - loads admin-saved content from Supabase (read-only REST call, no SDK) and applies it
   - opens admin.js on demand when an admin signs in */
(function () {
  'use strict';
  var CFG = window.SITE_CONFIG || {}, SB = CFG.supabase || {};
  var HAS = !!(SB.url && SB.anonKey);
  var CACHE = 'cms.content.v1', HINT = 'cms.admin.hint';

  var REG = {};
  document.querySelectorAll('[data-region]').forEach(function (el) {
    REG[el.dataset.region] = { el: el, html: el.innerHTML, applied: null };
  });

  /* ---------- sanitiser: only our own markup survives ---------- */
  var ALLOWED = new Set('header section footer div span p h1 h2 h3 h4 a b strong em i small ul ol li br button img iframe dl dt dd svg path circle text textpath defs g'.split(' '));
  var DROP = new Set(['script', 'style', 'link', 'meta', 'object', 'embed', 'form', 'input', 'textarea', 'select', 'base', 'noscript', 'template', 'frame', 'frameset', 'applet', 'audio', 'video', 'canvas', 'math']);
  var ATTRS = new Set(['class', 'id', 'href', 'target', 'rel', 'src', 'alt', 'title', 'loading', 'referrerpolicy', 'role', 'type', 'hidden', 'style', 'viewbox', 'd', 'fill', 'xmlns', 'tabindex', 'width', 'height', 'lang', 'cx', 'cy', 'r', 'x', 'y', 'font-size', 'letter-spacing', 'stroke', 'stroke-width', 'text-anchor', 'startoffset', 'textlength', 'transform', 'dominant-baseline', 'opacity']);

  function walk(node) {
    Array.prototype.slice.call(node.children).forEach(function (el) {
      var tag = el.tagName.toLowerCase();
      if (DROP.has(tag)) { el.remove(); return; }
      if (!ALLOWED.has(tag)) { walk(el); el.replaceWith.apply(el, Array.prototype.slice.call(el.childNodes)); return; }
      Array.prototype.slice.call(el.attributes).forEach(function (a) {
        var n = a.name.toLowerCase(), v = a.value.trim();
        var ok = !n.startsWith('on') && (ATTRS.has(n) || n.startsWith('data-') || n.startsWith('aria-'));
        if (ok && n === 'href') ok = /^(https?:|mailto:|tel:|#|\/|\.\/|[\w.-]+\.html?$)/i.test(v);
        if (ok && n === 'src') {
          if (tag === 'img') ok = /^(data:image\/(png|jpe?g|webp|gif);base64,|https:\/\/|[\w./-]+$)/i.test(v);
          else if (tag === 'iframe') ok = /^https:\/\/(maps\.google\.com\/maps\?|www\.google\.com\/maps\/embed)/i.test(v);
          else ok = false;
        }
        if (ok && n === 'style') ok = !/url\s*\(|expression|javascript:|@import|behavior|-moz-binding/i.test(v);
        if (ok && n === 'id') ok = /^[\w-]+$/.test(v);
        if (ok && n === 'target') ok = v === '_blank' || v === '_self';
        if (!ok) el.removeAttribute(a.name);
      });
      if (tag === 'a' && el.getAttribute('target') === '_blank') el.setAttribute('rel', 'noopener');
      if (tag === 'iframe' && !el.getAttribute('src')) { el.remove(); return; }
      walk(el);
    });
  }
  function sanitize(html) {
    var doc = new DOMParser().parseFromString('<body>' + String(html) + '</body>', 'text/html');
    walk(doc.body);
    return doc.body.innerHTML;
  }

  /* ---------- apply saved content ---------- */
  function setPhoto(url) {
    if (!url) { document.documentElement.style.removeProperty('--photo'); document.querySelectorAll('img[data-photo]').forEach(function (i) { i.src = 'photo.jpg'; }); return; }
    if (!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(url)) return;
    document.documentElement.style.setProperty('--photo', 'url("' + url + '")');
    document.querySelectorAll('img[data-photo]').forEach(function (i) { i.src = url; });
  }

  function apply(c) {
    if (!c || typeof c !== 'object') return;
    var over = c.regions || {};
    Object.keys(REG).forEach(function (k) {
      var r = REG[k];
      if (typeof over[k] === 'string') {
        if (r.applied !== over[k]) {
          r.el.innerHTML = sanitize(over[k]);
          r.applied = over[k];
          if (window.SITE) window.SITE.observeReveal(r.el);
        }
      } else if (r.applied !== null) {
        r.el.innerHTML = r.html; r.applied = null;
        if (window.SITE) window.SITE.observeReveal(r.el);
      }
    });
    var s = c.settings || {};
    if (window.SITE && Array.isArray(s.typing) && s.typing.length) window.SITE.setWords(s.typing.map(String).slice(0, 12));
    setPhoto(s.photo || '');
  }

  function fetchRemote() {
    var url = String(SB.url).replace(/\/$/, '') + '/rest/v1/site_content?id=eq.content&select=json';
    return fetch(url, { headers: { apikey: SB.anonKey }, cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function (rows) {
      var raw = rows && rows[0] && rows[0].json;
      return raw ? { raw: raw, json: JSON.parse(raw) } : null;
    });
  }

  var CMS = window.CMS = {
    HAS: HAS, REG: REG, sanitize: sanitize, apply: apply, setPhoto: setPhoto,
    content: null, rawJson: null,
    isLocal: /^(localhost|127\.0\.0\.1)$/.test(location.hostname),
    cacheKey: CACHE, hintKey: HINT,
    openAdmin: function (mode) {
      return import('./admin.js').then(function (m) { return m.start(mode); }).catch(function (e) { console.error('admin.js failed', e); alert('Admin tools could not be loaded.'); });
    }
  };

  /* instant paint from the last saved copy, then refresh from the server */
  var cached = null;
  try { cached = localStorage.getItem(CACHE); } catch (e) {}
  if (cached) { try { CMS.rawJson = cached; CMS.content = JSON.parse(cached); apply(CMS.content); } catch (e) {} }

  if (!HAS && CMS.isLocal) {
    try { var demo = localStorage.getItem('cms.demo.content'); if (demo) { CMS.content = JSON.parse(demo); apply(CMS.content); } } catch (e) {}
  }

  if (HAS) {
    fetchRemote().then(function (r) {
      if (r) {
        CMS.rawJson = r.raw; CMS.content = r.json; apply(r.json);
        try { localStorage.setItem(CACHE, r.raw); } catch (e) {}
      } else { try { localStorage.removeItem(CACHE); } catch (e) {} }
    }).catch(function () { /* offline or not configured: keep what we have */ });
  }

  var link = document.getElementById('admin-link');
  if (link) link.addEventListener('click', function (e) { e.preventDefault(); CMS.openAdmin('login'); });
  var hint = null;
  try { hint = localStorage.getItem(HINT); } catch (e) {}
  if (hint || location.hash === '#admin') CMS.openAdmin(hint ? 'resume' : 'login');
})();
