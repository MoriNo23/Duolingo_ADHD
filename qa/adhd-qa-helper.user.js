// ==UserScript==
// @name         Duolingo ADHD — QA helper (diagnóstico de campo)
// @namespace    https://github.com/MoriNo23/duolingo-adhd
// @version      0.1.0
// @description  Herramienta LOCAL del mantenedor para el QA de campo del script principal: captura errores de la página y copia un bloque de diagnóstico para pegar como evidencia en el guion de QA. No se publica en GreasyFork. No adivina la versión ni la config exacta del script principal: eso se confirma en el guion.
// @author       Mori
// @license      MIT
// @match        https://*.duolingo.com/*
// @grant        none
// @run-at       document-start
// ==/UserScript==
//
// add-field-qa-loop (openspec: field-qa). Este archivo NO es una copia del
// userscript publicado: es un observador de página, como test/ es arnés.
// Contrato de acoplamiento: solo lee ids/classes adhd-* del script principal
// (el mismo contrato que usa el fixture del e2e). Si esos ids cambian, este
// archivo y el fixture se actualizan en el mismo change.
(function () {
  'use strict';

  // ---- ring buffer de errores de la página (global: incluye al script) ----
  var QA_RING_LIMIT = 20;
  var qaRing = [];

  function qaRingPush(e) {
    qaRing.push({
      ts: Number.isFinite(e && e.ts) ? e.ts : Date.now(),
      msg: (e && e.msg) || '(sin mensaje)',
      src: (e && e.src) || '',
      line: Number.isFinite(e && e.line) ? e.line : 0,
    });
    if (qaRing.length > QA_RING_LIMIT) qaRing.splice(0, qaRing.length - QA_RING_LIMIT);
  }

  // document-start: los listeners viven antes que el DOM, para no perder
  // errores tempranos. La UI se arma cuando el DOM está listo.
  window.addEventListener('error', function (e) {
    qaRingPush({ ts: Date.now(), msg: (e && e.message) || 'error',
                 src: (e && e.filename) || '', line: (e && e.lineno) || 0 });
  });
  window.addEventListener('unhandledrejection', function (e) {
    var r = e && e.reason;
    qaRingPush({ ts: Date.now(), msg: 'promesa rechazada: ' + ((r && (r.message || r)) || '?'),
                 src: '', line: 0 });
  });

  // ---- el bloque de diagnóstico: SOLO lo observable desde la página ----
  function qaHay(sel) { return !!document.querySelector(sel); }

  function qaConfigVisible() {
    // Config del script principal, leída de su panel ABIERTO (mismo contrato
    // que el fixture). Con el panel cerrado no se lee nada: no se adivina.
    var panel = document.querySelector('#adhd-panel, .adhd-panel');
    if (!panel) return 'panel del script cerrado — abrilo para leer su config';
    var partes = [];
    var cues = panel.querySelector('#adhd-sound-cues');
    if (cues) partes.push('sonidos=' + (cues.checked ? 'on' : 'off'));
    var rem = panel.querySelector('#adhd-reminder');
    if (rem) partes.push('recordatorio=' + (rem.checked ? 'on' : 'off'));
    var rng = panel.querySelector('#adhd-reminder-secs');
    if (rng) partes.push('intervalo=' + rng.value + 's');
    var jr = panel.querySelector('#adhd-journal');
    if (jr) partes.push('journal=' + (jr.checked ? 'on' : 'off'));
    return partes.length ? partes.join(' ') : 'panel abierto sin controles conocidos';
  }

  function qaBloque() {
    var calma = document.body && document.body.classList.contains('adhd-motion-off');
    var segs = document.querySelectorAll('.adhd-seg').length;
    var out = '';
    out += 'duolingo-adhd QA — diagnóstico de campo (companion)\n';
    out += 'hora: ' + new Date().toISOString() + '\n';
    out += 'path: ' + location.pathname + '\n';
    out += 'motion: ' + (calma ? 'calma' : 'animado') + '\n';
    out += 'artefactos:\n';
    out += '  overlay: ' + (qaHay('.adhd-overlay') ? 'presente' : 'ausente') + '\n';
    out += '  segmentos: ' + segs + '\n';
    out += '  riel: ' + (qaHay('.adhd-decay-timeline') ? 'presente' : 'ausente') + '\n';
    out += '  tab de ajustes: ' + (qaHay('.adhd-btn') ? 'presente' : 'ausente') + '\n';
    out += 'config visible: ' + qaConfigVisible() + '\n';
    out += 'errores (' + qaRing.length + '):\n';
    if (!qaRing.length) out += '  (ninguno capturado)\n';
    qaRing.forEach(function (e) {
      var hora = Number.isFinite(e.ts) ? new Date(e.ts).toISOString().slice(11, 19) : '?';
      out += '  [' + hora + '] ' + e.msg + ' (' + (e.src || '?') + ':' + (e.line || '?') + ')\n';
    });
    out += '\n(versión y config exacta del script principal: confirmalas en el guion)\n';
    return out;
  }

  // ---- UI propia: botón flotante adhd-qa-* ----
  function qaBoot() {
    if (document.getElementById('adhd-qa-btn')) return;

    var style = document.createElement('style');
    style.textContent = [
      '#adhd-qa-btn { position: fixed; right: 14px; bottom: 14px; z-index: 2147483000;',
      '  background: #1c2b3a; color: #fff; border: 2px solid #58cc02; border-radius: 10px;',
      '  font: 700 13px/1 system-ui, sans-serif; padding: 8px 12px; cursor: pointer; }',
      '#adhd-qa-panel { position: fixed; right: 14px; bottom: 58px; z-index: 2147483000;',
      '  background: #1c2b3a; color: #fff; border: 2px solid #58cc02; border-radius: 10px;',
      '  padding: 12px; max-width: 280px; font: 13px/1.4 system-ui, sans-serif; }',
      '#adhd-qa-panel button { background: #58cc02; color: #04330a; border: 0; border-radius: 8px;',
      '  font: 700 13px/1 system-ui, sans-serif; padding: 8px 10px; cursor: pointer; margin-right: 6px; }',
      '#adhd-qa-panel textarea { box-sizing: border-box; display: none; margin-top: 8px; width: 100%; height: 110px; }',
      '#adhd-qa-status { margin-left: 6px; font-weight: 700; }',
    ].join('\n');
    document.head.appendChild(style);

    var btn = document.createElement('button');
    btn.id = 'adhd-qa-btn';
    btn.type = 'button';
    btn.textContent = 'QA';
    document.body.appendChild(btn);

    var panel = document.createElement('div');
    panel.id = 'adhd-qa-panel';
    panel.style.display = 'none';
    panel.innerHTML =
      '<strong>Diagnóstico de campo</strong><br>' +
      'Captura errores de la página y el estado del script. ' +
      'Pegalo como evidencia en el guion de QA.<br>' +
      '<button type="button" id="adhd-qa-copy">Copiar diagnóstico</button>' +
      '<span id="adhd-qa-status"></span>' +
      '<textarea readonly></textarea>';
    document.body.appendChild(panel);

    btn.addEventListener('click', function () {
      panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
    });

    panel.querySelector('#adhd-qa-copy').addEventListener('click', function () {
      var texto = qaBloque();
      var marca = panel.querySelector('#adhd-qa-status');
      var listo = function () { marca.textContent = '✓ copiado (' + texto.length + ')'; };
      var manual = function () {
        var t = panel.querySelector('textarea');
        t.value = texto; t.style.display = 'block'; t.focus(); t.select();
        marca.textContent = '⚠ portapapeles bloqueado: copiá a mano';
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(texto).then(listo, manual);
      } else {
        var t = panel.querySelector('textarea');
        t.value = texto; t.style.display = 'block'; t.focus(); t.select();
        try {
          if (document.execCommand('copy')) listo();
          else manual();
        } catch (e) { manual(); }
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', qaBoot);
  } else {
    qaBoot();
  }
})();
