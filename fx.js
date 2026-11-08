/* Visual effects: cursor ring + card spotlight.
   Only for mouse users; skipped on touch, reduced motion and while editing.
   Effect values are set as temporary CSS variables and never saved with the page. */
(function () {
  'use strict';
  if (!matchMedia('(hover: hover) and (pointer: fine)').matches) return;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  var ring = document.createElement('div');
  ring.className = 'fx-ring'; ring.setAttribute('aria-hidden', 'true');
  document.body.appendChild(ring);

  var x = 0, y = 0, rx = 0, ry = 0, running = false, last = null;

  function tick() {
    rx += (x - rx) * 0.22; ry += (y - ry) * 0.22;
    ring.style.transform = 'translate(' + rx.toFixed(1) + 'px,' + ry.toFixed(1) + 'px)';
    requestAnimationFrame(tick);
  }
  function clear(el) {
    if (!el) return;
    el.style.removeProperty('--mx'); el.style.removeProperty('--my');
    if (!el.getAttribute('style')) el.removeAttribute('style');
  }

  addEventListener('pointermove', function (e) {
    if (window.__siteEditing) { ring.classList.remove('on'); clear(last); last = null; return; }
    x = e.clientX; y = e.clientY;
    if (!running) { running = true; rx = x; ry = y; tick(); }
    ring.classList.add('on');
    var t = e.target, big = false, g = null;
    if (t && t.closest) {
      big = !!t.closest('a,button,.pimg,.glass');
      g = t.closest('.glass');
    }
    ring.classList.toggle('big', big);
    if (g !== last) { clear(last); last = g; }
    if (g) {
      var r = g.getBoundingClientRect();
      g.style.setProperty('--mx', (e.clientX - r.left).toFixed(0) + 'px');
      g.style.setProperty('--my', (e.clientY - r.top).toFixed(0) + 'px');
    }
  }, { passive: true });

  document.documentElement.addEventListener('mouseleave', function () { ring.classList.remove('on'); clear(last); last = null; });
})();
