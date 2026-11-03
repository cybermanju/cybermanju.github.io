// CyberManju OS — VN dev HUD (scripts/vn-overlay.js).
// Role: injected by scripts/vn-dev.mjs into the Ren'Py Web index.html so a phone
//       on the LAN can measure and A/B the visual novel without devtools: frame
//       pacing, long tasks, transferred bytes, boot marks, and live Ren'Py knobs.
// Exports: window.__vnPerf ({snapshot, report, setTextCps, setTransitions,
//       setPredict, restart, freeMemory}).
// Integrates: renpy-pre.js (window.renpy_exec / renpy_get / presplashEnd),
//       the /__vn/* endpoints of the dev server, and the SSE reload channel.
// Contracts: dev-only; never touches story state; every Ren'Py mutation is a
//       preference/config write the shipped options.rpy already owns; a missing
//       renpy_exec degrades to "controls disabled", never an exception in play.
(function () {
  'use strict'

  var DEV = window.__VN_DEV__ || {}
  var STORE = 'cybermanju.vn.hud.v1'
  var state = {
    autoReload: true,
    open: false,
    assets: DEV.assets || 'fast',
    textCps: null,
    transitions: null,
    predict: null,
    engineCached: null,
    engineBytes: 0,
    lazyImages: 0,
    lazyImageBytes: 0,
    lossless: DEV.lossless === true,
  }
  try {
    Object.assign(state, JSON.parse(localStorage.getItem(STORE) || '{}'))
  } catch (_) { /* private mode: defaults are enough */ }

  function save() {
    try { localStorage.setItem(STORE, JSON.stringify({ autoReload: state.autoReload, open: state.open })) } catch (_) {}
  }

  var frames = []
  var lastFrame = performance.now()
  var longTasks = []
  var resources = []
  var boot = {
    overlayAt: performance.now(),
    navigationStart: 0,
    renpyAt: null,
    firstFrameAt: null,
    loadAt: null,
  }
  try {
    var nav = performance.getEntriesByType('navigation')[0]
    boot.navigationStart = nav ? nav.startTime : 0
  } catch (_) {}

  window.addEventListener('load', function () { boot.loadAt = performance.now() }, { once: true })

  // ── measurement ────────────────────────────────────────────────────────────
  function tick(now) {
    var delta = now - lastFrame
    lastFrame = now
    if (delta > 0 && delta < 5000) {
      frames.push(delta)
      if (frames.length > 240) frames.shift()
    }
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)

  try {
    new PerformanceObserver(function (list) {
      list.getEntries().forEach(function (entry) {
        longTasks.push({ at: entry.startTime, ms: entry.duration })
      })
      if (longTasks.length > 200) longTasks.splice(0, longTasks.length - 200)
    }).observe({ entryTypes: ['longtask'] })
  } catch (_) { /* Safari/Firefox: no longtask entries */ }

  try {
    new PerformanceObserver(function (list) {
      list.getEntries().forEach(function (entry) {
        var name = entry.name || ''
        if (!/\.(wasm|data|zip|js|jpg|jpeg|png|webp)(\?|$)/.test(name)) return
        resources.push({
          at: Math.round(entry.startTime),
          ms: Math.round(entry.duration),
          bytes: entry.transferSize || entry.encodedBodySize || 0,
          name: name.replace(location.origin, '').slice(-64),
        })
        trackLazyImage(entry)
      })
      if (resources.length > 400) resources.splice(0, resources.length - 400)
    }).observe({ type: 'resource', buffered: true })
  } catch (_) { /* resource timing is best-effort */ }

  function trackLazyImage(entry) {
    var name = entry.name || ''
    if (!/\.(jpg|jpeg|png|webp)(\?|$)/.test(name)) return
    var bootTime = boot.firstFrameAt || boot.loadAt || 0
    if (entry.startTime >= bootTime) {
      state.lazyImages += 1
      state.lazyImageBytes += entry.transferSize || entry.encodedBodySize || 0
    }
  }

  function percentile(values, p) {
    if (!values.length) return 0
    var sorted = values.slice().sort(function (a, b) { return a - b })
    var index = Math.min(sorted.length - 1, Math.max(0, Math.round((p / 100) * (sorted.length - 1))))
    return sorted[index]
  }

  function recentLongTasks(windowMs) {
    var since = performance.now() - (windowMs || 10000)
    return longTasks.filter(function (task) { return task.at >= since })
  }

  var cachedEngine = null
  function engineInfo() {
    if (cachedEngine) return cachedEngine
    try {
      cachedEngine = {
        userAgent: navigator.userAgent,
        dpr: window.devicePixelRatio,
        viewport: window.innerWidth + 'x' + window.innerHeight,
        canvas: (function () {
          var canvas = document.getElementById('canvas')
          return canvas ? canvas.width + 'x' + canvas.height : 'none'
        })(),
        hardwareConcurrency: navigator.hardwareConcurrency || 0,
        deviceMemory: navigator.deviceMemory || 0,
        gl: (function () {
          try {
            var canvas = document.createElement('canvas')
            var gl = canvas.getContext('webgl2') || canvas.getContext('webgl')
            if (!gl) return 'none'
            var debug = gl.getExtension('WEBGL_debug_renderer_info')
            return debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)
          } catch (_) { return 'unknown' }
        })(),
      }
      return cachedEngine
    } catch (_) {
      cachedEngine = {}
      return cachedEngine
    }
  }

  function snapshot() {
    var window = frames.slice(-120)
    var long = recentLongTasks(10000)
    var images = resources.filter(function (item) { return /\.(jpg|jpeg|png|webp)$/.test(item.name) })
    var engine = resources.filter(function (item) { return /\.(wasm|data|zip)$/.test(item.name) })
    function total(list) { return list.reduce(function (sum, item) { return sum + item.bytes }, 0) }
    return {
      at: new Date().toISOString(),
      build: DEV.build || 'unknown',
      root: DEV.root || '',
      assets: state.assets,
      fps: window.length ? Math.round(1000 / (window.reduce(function (s, v) { return s + v }, 0) / window.length)) : 0,
      frameMs: {
        p50: +percentile(window, 50).toFixed(2),
        p95: +percentile(window, 95).toFixed(2),
        worst: +Math.max.apply(null, window.concat([0])).toFixed(2),
      },
      jank: {
        over32ms: window.filter(function (v) { return v > 32 }).length,
        over50ms: window.filter(function (v) { return v > 50 }).length,
      },
      longTasks: {
        count: long.length,
        worstMs: long.length ? +Math.max.apply(null, long.map(function (t) { return t.ms })).toFixed(1) : 0,
      },
      heapMb: performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : null,
      transferredMb: +(total(resources) / 1048576).toFixed(2),
      imageMb: +(total(images) / 1048576).toFixed(2),
      imageCount: images.length,
      engineMb: +(total(engine) / 1048576).toFixed(2),
      slowest: resources.slice().sort(function (a, b) { return b.ms - a.ms }).slice(0, 5),
      boot: {
        renpyMs: boot.renpyAt === null ? null : Math.round(boot.renpyAt),
        firstFrameMs: boot.firstFrameAt === null ? null : Math.round(boot.firstFrameAt),
        loadMs: boot.loadAt === null ? null : Math.round(boot.loadAt),
      },
      knobs: { textCps: state.textCps, transitions: state.transitions, predict: state.predict },
      engine: engineInfo(),
      cache: {
        engineCached: state.engineCached,
        engineBytes: state.engineBytes,
        lazyImages: state.lazyImages,
        lazyImageBytes: state.lazyImageBytes,
      },
    }
  }

  // ── Ren'Py bridge ──────────────────────────────────────────────────────────
  function py(script) {
    if (typeof window.renpy_exec !== 'function') return Promise.reject(new Error('renpy not ready'))
    return window.renpy_exec(script)
  }

  function setTextCps(value) {
    state.textCps = value
    return py(
      'renpy.game.preferences.text_cps = ' + Number(value) + '; ' +
      'renpy.config.default_text_cps = ' + Number(value) + '; ' +
      'renpy.restart_interaction(); result = renpy.game.preferences.text_cps',
    )
  }

  function setTransitions(enabled) {
    state.transitions = enabled ? 2 : 0
    return py(
      'renpy.game.preferences.transitions = ' + state.transitions + '; ' +
      'renpy.restart_interaction(); result = renpy.game.preferences.transitions',
    )
  }

  function setPredict(depth) {
    state.predict = Number(depth)
    return py('renpy.config.predict_statements = ' + state.predict + '; result = renpy.config.predict_statements')
  }

  function restart() { return py('renpy.utter_restart(); result = True') }
  function freeMemory() { return py('renpy.free_memory(); result = True') }

  function probe() {
    return py(
      'result = {"version": renpy.version(), "developer": bool(renpy.config.developer), ' +
      '"textCps": renpy.game.preferences.text_cps, "transitions": renpy.game.preferences.transitions, ' +
      '"predict": renpy.config.predict_statements, "renderer": renpy.get_renderer_info().get("renderer", "")}',
    )
  }

  // ── engine reuse / cache status ────────────────────────────────────────────
  function fetchState() {
    return fetch('/__vn/state', { cache: 'no-store' })
      .then(function (r) { return r.json() })
      .then(function (s) {
        if (s.engine) {
          var bytes = 0
          var cached = true
          for (var k in s.engine) {
            if (s.engine[k]) bytes += s.engine[k].bytes
          }
          state.engineBytes = bytes
          state.engineCached = s.stableCache === true
        }
      }).catch(function () { /* state endpoint unavailable — keep defaults */ })
  }

  function checkEngineCache() {
    if (!window.caches || !caches.has) return
    var names = []
    caches.keys().then(function (list) {
      list.forEach(function (name) { if (name.indexOf('stem-array-vn-') === 0) names.push(name) })
      var hit = false
      var promise = Promise.all(names.map(function (n) {
        return caches.open(n).then(function (cache) {
          return Promise.all(['renpy.wasm', 'renpy.data', 'game.zip'].map(function (f) {
            return cache.match(f).then(function (r) { if (r) hit = true })
          }))
        })
      }))
      promise.then(function () { if (hit) state.engineCached = true })
    }).catch(function () {})
  }

  function report() {
    var data = snapshot()
    data.probe = null
    var done = function () {
      fetch('/__vn/report', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) })
        .then(function () { toast('report sent to the pnpm vn terminal') })
        .catch(function () { toast('report failed') })
    }
    probe().then(function (info) { data.probe = info; done() }, done)
  }

  // ── UI ─────────────────────────────────────────────────────────────────────
  var host, shadow, pill, panel, statusEl, metricEls = {}, actionEls = {}

  function el(tag, attrs, children) {
    var node = document.createElement(tag)
    Object.keys(attrs || {}).forEach(function (key) {
      if (key === 'text') node.textContent = attrs[key]
      else if (key === 'class') node.className = attrs[key]
      else if (key.slice(0, 2) === 'on') node.addEventListener(key.slice(2), attrs[key])
      else node.setAttribute(key, attrs[key])
    })
    ;(children || []).forEach(function (child) { if (child) node.appendChild(child) })
    return node
  }

  function button(label, handler, title) {
    return el('button', {
      class: 'btn',
      type: 'button',
      text: label,
      title: title || label,
      onclick: function (event) {
        event.stopPropagation()
        event.preventDefault()
        Promise.resolve().then(handler).catch(function (error) { toast(String(error.message || error)) })
      },
    })
  }

  function row(label, children) {
    var node = el('div', { class: 'row' }, [el('span', { class: 'label', text: label })].concat(children))
    node.dataset.label = label
    return node
  }

  function toast(message) {
    if (!shadow) return
    var node = el('div', { class: 'toast', text: message })
    shadow.appendChild(node)
    setTimeout(function () { node.remove() }, 2400)
  }

  function mark(label, value) {
    var buttons = actionEls[label]
    if (!buttons) return
    buttons.forEach(function (node) { node.classList.toggle('on', node.textContent === value) })
  }

  function mount() {
    host = document.createElement('div')
    host.id = '__vn_dev_hud'
    host.style.cssText = 'position:fixed;left:10px;bottom:10px;z-index:2147483002;pointer-events:none;'
    shadow = host.attachShadow({ mode: 'open' })
    shadow.innerHTML = [
      '<style>',
      ':host{all:initial}',
      '*{box-sizing:border-box;font:11px/1.45 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}',
      '.pill{pointer-events:auto;display:flex;gap:8px;align-items:center;padding:6px 10px;border-radius:999px;',
      'background:rgba(4,8,14,.86);color:#9ff;border:1px solid rgba(85,237,255,.45);cursor:pointer;',
      'box-shadow:0 2px 12px rgba(0,0,0,.45);white-space:nowrap}',
      '.pill b{color:#fff;font-weight:600}',
      '.pill .dot{width:7px;height:7px;border-radius:50%;background:#55edff}',
      '.panel{pointer-events:auto;position:absolute;left:0;bottom:36px;width:min(320px,calc(100vw - 24px));max-height:70vh;',
      'overflow:auto;padding:10px 12px;border-radius:12px;background:rgba(4,8,14,.94);color:#cfe9f2;',
      'border:1px solid rgba(85,237,255,.35);box-shadow:0 8px 28px rgba(0,0,0,.5);display:none}',
      '.panel h2{margin:0 0 6px;font-size:11px;letter-spacing:.14em;color:#55edff;text-transform:uppercase}',
      '.grid{display:grid;grid-template-columns:1fr 1fr;gap:2px 10px;margin:6px 0 10px}',
      '.grid span:nth-child(odd){color:#7fa6b3}',
      '.grid span:nth-child(even){text-align:right;color:#fff}',
      '.row{display:flex;flex-wrap:wrap;gap:4px;align-items:center;margin:3px 0}',
      '.label{color:#7fa6b3;min-width:74px;text-transform:uppercase;letter-spacing:.08em;font-size:10px}',
      '.btn{pointer-events:auto;padding:3px 7px;border-radius:6px;background:#0c1a24;color:#bfe9f5;',
      'border:1px solid rgba(85,237,255,.28);cursor:pointer}',
      '.btn:hover{background:#12303f;color:#fff}',
      '.btn.on{background:#55edff;color:#02141c;border-color:#55edff;font-weight:700}',
      '.toast{position:absolute;left:0;bottom:36px;padding:6px 10px;border-radius:8px;background:#0b2530;',
      'color:#9ff;border:1px solid rgba(85,237,255,.4);white-space:nowrap}',
      '.muted{color:#5f7b86;word-break:break-all}',
      '</style>',
    ].join('')

    pill = el('div', {
      class: 'pill',
      onclick: function () { state.open = !state.open; save(); syncOpen() },
    })
    panel = el('div', { class: 'panel' })

    panel.appendChild(el('h2', { text: 'The Stem Array · dev perf' }))
    var grid = el('div', { class: 'grid' })
    ;['fps', 'frame p50', 'frame p95', 'worst', '>32ms', 'long tasks', 'heap', 'transfer', 'images', 'engine', 'boot', 'canvas', 'cache', 'lazy', 'lossless'].forEach(function (label) {
      grid.appendChild(el('span', { text: label }))
      var value = el('span', { text: '…' })
      metricEls[label] = value
      grid.appendChild(value)
    })
    panel.appendChild(grid)

    function actions(label, buttons) {
      actionEls[label] = buttons
      panel.appendChild(row(label, buttons))
    }

    actions('assets', [
      button('fast', function () { setAssets('fast') }, 'Re-encoded streamed images'),
      button('raw', function () { setAssets('raw') }, 'Original CI images'),
    ])
    actions('text cps', [
      button('instant', function () { setTextCps(0) }),
      button('45', function () { setTextCps(45) }),
      button('90', function () { setTextCps(90) }),
    ])
    actions('transitions', [
      button('on', function () { setTransitions(true) }),
      button('off', function () { setTransitions(false) }),
    ])
    actions('predict', [
      button('10', function () { setPredict(10) }),
      button('50', function () { setPredict(50) }),
    ])
    actions('engine', [
      button('restart', restart, 'renpy.utter_restart()'),
      button('free mem', freeMemory, 'Drop decoded image caches'),
    ])
    actions('session', [
      button('reload', function () { location.reload() }),
      button('hard reload', hardReload, 'Unregister SW + clear caches'),
      button('report', report),
    ])
    var autoReloadButton = button(state.autoReload ? 'on' : 'off', function () {
      state.autoReload = !state.autoReload
      save()
      autoReloadButton.textContent = state.autoReload ? 'on' : 'off'
    }, 'Reload when the runtime or the game source changes')
    actions('auto reload', [autoReloadButton])
    statusEl = el('div', { class: 'muted', text: 'engine: booting…' })
    panel.appendChild(el('div', { class: 'muted', text: (DEV.root || '') + ' · ' + (DEV.build || '') }))
    panel.appendChild(statusEl)

    shadow.appendChild(pill)
    shadow.appendChild(panel)
    document.body.appendChild(host)
    syncOpen()
    mark('assets', state.assets)
    refreshMetrics()
    setInterval(refreshMetrics, 500)
  }

  function syncOpen() {
    if (!panel) return
    panel.style.display = state.open ? 'block' : 'none'
    if (state.open) refreshMetrics()
  }

  function refreshMetrics() {
    if (!shadow) return
    var data = snapshot()
    pill.innerHTML = ''
    pill.appendChild(el('span', { class: 'dot' }))
    pill.appendChild(el('span', { text: (state.open ? '▾ ' : '▸ ') + (data.fps || '–') + ' fps' }))
    pill.appendChild(el('b', { text: data.frameMs.p95 + ' ms p95' }))
    pill.appendChild(el('span', { class: 'muted', text: data.longTasks.count + ' jank · ' + data.imageMb.toFixed(1) + ' MB img' }))
    if (!state.open) return
    var values = {
      fps: data.fps,
      'frame p50': data.frameMs.p50 + ' ms',
      'frame p95': data.frameMs.p95 + ' ms',
      worst: data.frameMs.worst + ' ms',
      '>32ms': data.jank.over32ms,
      'long tasks': data.longTasks.count + ' / ' + data.longTasks.worstMs + ' ms',
      heap: data.heapMb === null ? 'n/a' : data.heapMb + ' MB',
      transfer: data.transferredMb + ' MB',
      images: data.imageCount + ' / ' + data.imageMb + ' MB',
      engine: data.engineMb + ' MB',
      boot: data.boot.firstFrameMs === null ? '…' : data.boot.firstFrameMs + ' ms',
      canvas: data.engine.canvas || '…',
      cache: data.cache.engineCached ? 'engine reused' : 'engine: ' + (data.cache.engineBytes ? Math.round(data.cache.engineBytes / 1048576) + 'MB' : '–'),
      lazy: data.cache.lazyImages + ' img · ' + Math.round(data.cache.lazyImageBytes / 1048576) + 'MB',
      lossless: state.lossless ? 'on' : 'off',
    }
    Object.keys(values).forEach(function (label) {
      if (metricEls[label]) metricEls[label].textContent = String(values[label])
    })
    mark('assets', state.assets === 'fast' ? 'fast' : 'raw')
    mark('lossless', state.lossless ? 'on' : 'off')
    if (state.textCps !== null) mark('text cps', state.textCps === 0 ? 'instant' : String(state.textCps))
    if (state.transitions !== null) mark('transitions', state.transitions ? 'on' : 'off')
    if (state.predict !== null) mark('predict', String(state.predict))
    if (statusEl) {
      var info = DEV.probe
      statusEl.textContent = info
        ? 'engine ' + (info.version || '?') + ' · ' + (info.renderer || '?') + (info.developer ? ' · developer' : '')
        : 'engine: booting…'
    }
  }

  function setAssets(mode) {
    state.assets = mode
    mark('assets', mode)
    fetch('/__vn/state', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ assets: mode }),
    }).then(function () { location.reload() }).catch(function () { toast('could not switch assets') })
  }

  function hardReload() {
    var done = function () { location.reload() }
    var tasks = []
    if (window.caches && caches.keys) {
      tasks.push(caches.keys().then(function (names) {
        return Promise.all(names.map(function (name) { return caches.delete(name) }))
      }))
    }
    if (navigator.serviceWorker && navigator.serviceWorker.getRegistrations) {
      tasks.push(navigator.serviceWorker.getRegistrations().then(function (list) {
        return Promise.all(list.map(function (registration) { return registration.unregister() }))
      }))
    }
    Promise.all(tasks).then(done, done)
  }

  // ── boot probing + reload channel ─────────────────────────────────────────
  var probeTimer = setInterval(function () {
    if (typeof window.renpy_exec !== 'function') return
    clearInterval(probeTimer)
    boot.renpyAt = performance.now()
    probe().then(function (info) {
      DEV.probe = info
      refreshMetrics()
    }).catch(function () {})
  }, 150)

  function watchPresplash() {
    var start = function () {
      var presplash = document.getElementById('presplash')
      if (!presplash) return
      var observer = new MutationObserver(function () {
        if (!document.getElementById('presplash')) {
          boot.firstFrameAt = performance.now()
          observer.disconnect()
          refreshMetrics()
        }
      })
      observer.observe(presplash.parentNode, { childList: true })
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true })
    else start()
  }

  function subscribe() {
    if (!window.EventSource) return
    var source = new EventSource('/__vn/events')
    source.addEventListener('reload', function (event) {
      var payload = {}
      try { payload = JSON.parse(event.data) } catch (_) {}
      var reason = payload.reason || 'runtime changed'
      if (!state.autoReload) { toast(reason + ' (auto reload off)'); return }
      toast(reason + ' → reloading')
      setTimeout(function () { location.reload() }, 260)
    })
    source.addEventListener('error', function () {
      // The server restarted; EventSource reconnects on its own.
    })
  }

  window.__vnPerf = {
    snapshot: snapshot,
    report: report,
    setTextCps: setTextCps,
    setTransitions: setTransitions,
    setPredict: setPredict,
    restart: restart,
    freeMemory: freeMemory,
    state: state,
  }

  var start = function () {
    mount()
    watchPresplash()
    subscribe()
    fetchState()
    checkEngineCache()
    if (typeof window.renpy_exec === 'function') boot.renpyAt = performance.now()
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true })
  else start()
})()
