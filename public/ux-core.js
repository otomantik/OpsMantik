/**
 * Back-compat shim for legacy embeds that still load `/ux-core.js`.
 *
 * Canonical tracker: `/assets/core.js` (built from lib/tracker via npm run tracker:build).
 * Do not add tracker logic here — only forward to the canonical bundle.
 */
(function () {
  try {
    var s = document.createElement('script');
    s.async = true;
    s.src = '/assets/core.js';
    var first = document.getElementsByTagName('script')[0];
    if (first && first.parentNode) first.parentNode.insertBefore(s, first);
    else (document.head || document.documentElement).appendChild(s);
  } catch (_) {
    // silent
  }
})();
