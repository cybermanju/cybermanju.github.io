// CyberManju OS — The Stem Array loading screen behaviour (web/loading/loading.js).
// Role: rotates in-story loading lines, mirrors Ren'Py's own download status into
//       the card, and fades the overlay out once the engine has painted a frame
//       so the same art hands over to the game's pixel-art main menu.
// Integrates: index.html (markup injected by tools/inject_loading_overlay.py),
//             renpy-pre.js / renpy.js (#statusDiv, #statusTextDiv, #statusProgress).
// Contracts: no network calls and no storage writes of its own; the overlay is
//       removed from the DOM after the fade so it can never swallow a click; a
//       script error surfaces as a retry hint instead of a blank screen.

(function () {
  'use strict';

  var root = document.getElementById('stem-loader');
  if (!root) {
    return;
  }

  var phraseEl = root.querySelector('[data-stem-phrase]');
  var detailEl = root.querySelector('[data-stem-detail]');
  var barEl = root.querySelector('.stem-loader__bar');
  var fillEl = root.querySelector('.stem-loader__fill');
  var artEl = root.querySelector('.stem-loader__art');

  var PHRASES = [
    'Os Bodhisattvas estão se reunindo…',
    'Os budas já chegaram. Faltam só os Śrāvakas…',
    'Sudhana está amarrando as sandálias…',
    'Mañjuśrī confere a lista de bons amigos espirituais…',
    'Contando os átomos dos campos búdicos… (aviso: não acaba nunca)',
    'O Bhagavat entrou no samādhi do Leão de Boca Aberta…',
    'Os nāgas vieram do oceano e pediram para esperar mais um pouco…',
    'Jetavana está sendo adornada com estandartes de vajra…',
    'Meghaśrī subiu o monte Sugrīva, já volta…',
    'Carregando 56 capítulos, 246 cenas e nenhuma pressa…'
  ];

  var PHRASE_INTERVAL = 2800;
  var MINIMUM_DISPLAY = 1500;
  var MAXIMUM_WAIT = 12000;
  var POLL_INTERVAL = 250;

  var index = 0;
  var started = performance.now();
  var finished = false;

  function showPhrase() {
    if (!phraseEl) {
      return;
    }
    phraseEl.textContent = PHRASES[index % PHRASES.length];
    phraseEl.classList.remove('is-visible');
    // Force a reflow so the animation restarts on every phrase.
    void phraseEl.offsetWidth;
    phraseEl.classList.add('is-visible');
    index += 1;
  }

  function engineStatus() {
    var div = document.getElementById('statusDiv');
    var progress = document.getElementById('statusProgress');
    var text = document.getElementById('statusTextDiv');
    var hidden = true;
    if (div) {
      var style = window.getComputedStyle(div);
      hidden = div.classList.contains('hidden') || style.visibility === 'hidden' || style.display === 'none';
    }
    var max = progress && Number(progress.max) > 0 ? Number(progress.max) : 0;
    return {
      hidden: hidden,
      value: progress ? Number(progress.value) || 0 : 0,
      max: max,
      text: text ? String(text.textContent || '').replace(/\s+/g, ' ').trim() : ''
    };
  }

  function finish() {
    if (finished) {
      return;
    }
    finished = true;
    window.clearInterval(phraseTimer);
    root.classList.add('is-done');
    root.setAttribute('aria-busy', 'false');
    document.documentElement.classList.add('stem-loaded');
    window.setTimeout(function () {
      if (root.parentNode) {
        root.parentNode.removeChild(root);
      }
    }, 1000);
  }

  function fail(message) {
    if (finished || root.classList.contains('is-failed')) {
      return;
    }
    root.classList.add('is-failed');
    if (detailEl) {
      detailEl.textContent = message;
    }
  }

  function poll() {
    if (finished) {
      return;
    }
    var status = engineStatus();
    if (status.max > 0 && barEl && fillEl) {
      barEl.classList.add('is-determinate');
      fillEl.style.transform = 'scaleX(' + Math.min(1, status.value / status.max).toFixed(3) + ')';
    }
    if (detailEl && status.text) {
      detailEl.textContent = status.text.slice(0, 110);
    }
    var canvas = document.getElementById('canvas');
    var painted = !!canvas && canvas.width >= 320 && canvas.height >= 180;
    var elapsed = performance.now() - started;
    if (painted && status.hidden && index > 1 && elapsed > MINIMUM_DISPLAY) {
      finish();
      return;
    }
    // The engine may keep its own status bar up while it streams the archive, so
    // a painted canvas plus this cap hands the screen over instead of leaving an
    // overlay that can never be dismissed.
    if (painted && elapsed > MAXIMUM_WAIT) {
      finish();
      return;
    }
    window.setTimeout(poll, POLL_INTERVAL);
  }

  var phraseTimer = window.setInterval(showPhrase, PHRASE_INTERVAL);
  showPhrase();

  if (artEl) {
    if (artEl.complete && artEl.naturalWidth > 0) {
      artEl.classList.add('is-loaded');
    } else {
      artEl.addEventListener('load', function () {
        artEl.classList.add('is-loaded');
      });
    }
  }

  // A missing engine file is the one failure worth naming, instead of showing a
  // spinner forever on a blank canvas.
  window.addEventListener('error', function (event) {
    var target = event && event.target;
    if (target && target.tagName === 'SCRIPT') {
      fail('Falha ao carregar o motor do jogo. Verifique a conexão e recarregue.');
    }
  }, true);

  window.stemLoader = {
    finish: finish,
    phraseCount: function () { return index; },
    isFinished: function () { return finished; }
  };

  poll();
})();
