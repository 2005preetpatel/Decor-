/* ============================================================ perf probe ==

   A small diagnostic that exists only to find out why scrolling feels
   stuttery on one particular computer. It does NOTHING unless the address
   contains ?perf=1 (see the loader at the end of index.html), and it changes
   nothing about the page: it only watches and reports.

   How to use: open  http://localhost:5176/?perf=1  scroll from the top to the
   gallery the way you normally do, then press "Copy report" and paste the text
   to whoever is looking into it. The report holds frame times, where the
   slow frames happened, which pictures were loading at that moment, and
   basic facts about the computer (browser, screen, graphics chip name).
   It contains no personal data and nothing is sent anywhere.
   ========================================================================= */

(function () {
  'use strict';

  const frames = [];            // [dt ms, scrollY, time since start ms]
  const longTasks = [];         // [duration ms, time since start ms]
  const shifts = [];            // layout shifts
  const t0 = performance.now();
  let last = t0, running = true;

  (function tick(now) {
    frames.push([Math.round(now - last), Math.round(window.scrollY), Math.round(now - t0)]);
    last = now;
    if (running) requestAnimationFrame(tick);
  })(t0);

  try {
    new PerformanceObserver(function (l) {
      l.getEntries().forEach(function (e) { longTasks.push([Math.round(e.duration), Math.round(e.startTime - t0)]); });
    }).observe({ entryTypes: ['longtask'] });
  } catch (e) { /* not supported */ }
  try {
    new PerformanceObserver(function (l) {
      l.getEntries().forEach(function (e) { if (!e.hadRecentInput && e.value > 0.002) shifts.push([+e.value.toFixed(3), Math.round(e.startTime - t0)]); });
    }).observe({ type: 'layout-shift', buffered: true });
  } catch (e) { /* not supported */ }

  function gpu() {
    try {
      const gl = document.createElement('canvas').getContext('webgl');
      const ext = gl && gl.getExtension('WEBGL_debug_renderer_info');
      return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : (gl ? 'webgl (name hidden)' : 'no webgl');
    } catch (e) { return 'unknown'; }
  }

  function pct(sorted, p) { return sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] : 0; }

  function report() {
    const f = frames.slice(1);
    const dts = f.map(function (x) { return x[0]; }).sort(function (a, b) { return a - b; });
    const slow = f.filter(function (x) { return x[0] > 50; });
    const worst = f.slice().sort(function (a, b) { return b[0] - a[0]; }).slice(0, 15)
      .map(function (x) { return 'scrollY ' + x[1] + ' -> ' + x[0] + ' ms (at ' + (x[2] / 1000).toFixed(1) + ' s)'; });

    // pictures that finished loading, and how long they took, to see whether
    // the stutter lines up with downloads / decoding.
    const imgs = performance.getEntriesByType('resource')
      .filter(function (r) { return r.initiatorType === 'img' || /\.(jpe?g|png|webp|avif|mp4)(\?|$)/i.test(r.name); })
      .map(function (r) { return { s: Math.round(r.responseEnd - t0), d: Math.round(r.duration), kb: Math.round((r.transferSize || r.encodedBodySize || 0) / 1024), n: r.name.split('?')[0].split('/').slice(-2).join('/') }; })
      .filter(function (r) { return r.s > 0; })
      .sort(function (a, b) { return a.s - b.s; });

    const lines = [
      'PERF REPORT',
      'browser      : ' + navigator.userAgent,
      'window       : ' + innerWidth + 'x' + innerHeight + ' css px, pixel ratio ' + window.devicePixelRatio + ', screen ' + screen.width + 'x' + screen.height,
      'cpu cores    : ' + (navigator.hardwareConcurrency || '?') + ', memory ' + (navigator.deviceMemory || '?') + ' GB',
      'graphics     : ' + gpu(),
      'page         : ' + location.pathname + ', page height ' + document.documentElement.scrollHeight + ', scrolled to ' + Math.round(window.scrollY),
      'frames       : ' + f.length + ', median ' + pct(dts, 0.5) + ' ms, p95 ' + pct(dts, 0.95) + ' ms, worst ' + (dts[dts.length - 1] || 0) + ' ms',
      'slow frames  : >33 ms: ' + f.filter(function (x) { return x[0] > 33; }).length + ', >50 ms: ' + slow.length + ', >100 ms: ' + f.filter(function (x) { return x[0] > 100; }).length,
      'worst frames :',
    ].concat(worst.map(function (w) { return '   ' + w; }));
    lines.push('long tasks (>50 ms of script): ' + (longTasks.length ? longTasks.slice(0, 15).map(function (t) { return t[0] + ' ms at ' + (t[1] / 1000).toFixed(1) + ' s'; }).join('; ') : 'none'));
    lines.push('layout shifts: ' + (shifts.length ? shifts.slice(0, 10).map(function (s) { return s[0] + ' at ' + (s[1] / 1000).toFixed(1) + ' s'; }).join('; ') : 'none'));
    lines.push('pictures loaded (seconds after the page opened, ms, KB, file):');
    imgs.slice(0, 40).forEach(function (r) { lines.push('   ' + (r.s / 1000).toFixed(1) + ' s  ' + r.d + ' ms  ' + r.kb + ' KB  ' + r.n); });
    return lines.join('\n');
  }
  window.__perfReport = report;

  // ---- the small panel ----------------------------------------------------
  const box = document.createElement('div');
  box.setAttribute('style', 'position:fixed;left:12px;bottom:12px;z-index:2147483647;background:rgba(20,16,12,.92);color:#fff;'
    + 'font:12px/1.4 system-ui,sans-serif;padding:10px 12px;border-radius:10px;max-width:260px;box-shadow:0 6px 24px rgba(0,0,0,.35)');
  const title = document.createElement('div');
  title.textContent = 'Perf probe: scroll now';
  title.setAttribute('style', 'font-weight:600;margin-bottom:4px');
  const stat = document.createElement('div');
  const btn = document.createElement('button');
  btn.textContent = 'Copy report';
  btn.setAttribute('style', 'margin-top:8px;padding:6px 10px;border:0;border-radius:6px;background:#c9a961;color:#1d1914;cursor:pointer;font:inherit;font-weight:600');
  const note = document.createElement('div');
  note.setAttribute('style', 'margin-top:6px;color:#cdbf9f');
  btn.addEventListener('click', function () {
    const text = report();
    const done = function (ok) { note.textContent = ok ? 'Copied. Paste it in the chat.' : 'Could not copy: select the text in the box below and copy it.'; if (!ok) { show.value = text; show.style.display = 'block'; show.select(); } };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(function () { done(true); }, function () { done(false); });
    else done(false);
  });
  const show = document.createElement('textarea');
  show.setAttribute('style', 'display:none;width:240px;height:120px;margin-top:6px;font:11px monospace');
  box.appendChild(title); box.appendChild(stat); box.appendChild(btn); box.appendChild(note); box.appendChild(show);
  document.body.appendChild(box);

  setInterval(function () {
    const f = frames.slice(-60);
    const slow = frames.filter(function (x) { return x[0] > 50; }).length;
    const avg = f.length ? f.reduce(function (a, b) { return a + b[0]; }, 0) / f.length : 0;
    stat.textContent = 'about ' + (avg ? Math.round(1000 / avg) : 0) + ' fps now, ' + slow + ' slow frames so far';
  }, 500);
})();
