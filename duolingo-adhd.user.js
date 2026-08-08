// ==UserScript==
// @name           Duolingo ADHD — Progress bar milestones (for the easily distracted / bored)
// @name:es        Duolingo ADHD — Hitos de barra de progreso (para los que se aburren / se distraen)
// @namespace      https://github.com/MoriNo23/duolingo-adhd
// @version        1.5.3
// @description    Divides the lesson progress bar into milestones with progressive rarities (wood→bronze→silver→gold→platinum→legendary) + particle burst on milestone + EN/ES settings panel. Keeps Duolingo's native design.
// @description:en Divides the lesson progress bar into milestones with progressive rarities (wood→bronze→silver→gold→platinum→legendary) + particle burst on milestone + EN/ES settings panel. Keeps Duolingo's native design.
// @description:es Divide la barra de progreso en hitos con rarezas progresivas (madera→bronce→plata→oro→platino→legendario) + particle burst al cruzar hito + panel de ajustes EN/ES. Mantiene el diseño nativo Duolingo.
// @author         Mori
// @license        MIT
// @match        https://*.duolingo.com/lesson*
// @match        https://*.duolingo.com/practice*
// @match        https://*.duolingo.com/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addStyle
// @run-at       document-idle
// ==/UserScript==

'use strict';

/* =====================================================================
   PURE CORE  (testeable en Node via module.exports; uso compartido navegador)
   ===================================================================== */
const RARITY = [
  { name: 'madera',  color: '#8d6e63' },  // Nivel 0 = feo, hace valorar el resto
  { name: 'bronce',  color: '#b87333' },
  { name: 'plata',   color: '#c9d1d9' },
  { name: 'oro',     color: '#ffd700' },
  { name: 'platino', color: '#7ff4f0' },
];
const LEGENDARY = null; // el último tramo es legendario (gradiente CSS)

const DEFAULTS = {
  separators: 4,          // cantidad de hitos (dividen la barra en separators+1 tramos)
  showNumbers: true,
  thickness: 3,
  lang: 'es',             // idioma del panel: 'es' | 'en'
};

// ---------- i18n (panel de ajustes) ----------
const I18N = {
  es: {
    panelTitle:      '⚙ Hitos de barra (ADHD)',
    langLabel:       'Idioma',
    labelMilestones: 'Hitos:',
    ariaMilestones:  'Cantidad de hitos',
    labelShowNumbers:'Mostrar números',
    btnReset:        'Restablecer valores',
    btnSettingsTitle:'Configurar hitos de distracción',
  },
  en: {
    panelTitle:      '⚙ Progress bar milestones (ADHD)',
    langLabel:       'Language',
    labelMilestones: 'Milestones:',
    ariaMilestones:  'Number of milestones',
    labelShowNumbers:'Show numbers',
    btnReset:        'Reset values',
    btnSettingsTitle:'Configure distraction milestones',
  },
};
function tr(lang, key) { return (I18N[lang] && I18N[lang][key]) || I18N.es[key]; }
function detectLang(locale) { return typeof locale === 'string' && /^en/i.test(locale) ? 'en' : 'es'; }

function hexToRgb(h) {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function lerp(a, b, t) { return Math.round(a + (b - a) * t); }
function lerpColor(c1, c2, t) {
  const a = hexToRgb(c1), b = hexToRgb(c2);
  return 'rgb(' + lerp(a[0], b[0], t) + ',' + lerp(a[1], b[1], t) + ',' + lerp(a[2], b[2], t) + ')';
}

// color del tramo i de T tramos (0-index). Último tramo (i === T-1) → null (legendario).
// Mapeo DISCRETO: cada tramo es un nivel de rareza claro. Solo interpola cuando
// hay más tramos no-legendarios que colores base (T-1 > RARITY.length).
function levelColor(i, T) {
  if (i === T - 1) return null;            // último = legendario
  const nNonLegend = T - 1;
  if (nNonLegend <= RARITY.length) return RARITY[i].color; // nivel directo
  // más tramos que rarezas → interpolar entre niveles adyacentes
  const baseLen = RARITY.length;
  const pos = Math.min(baseLen - 1.0001, (i * baseLen) / nNonLegend);
  const idx = Math.floor(pos);
  const t = pos - idx;
  return lerpColor(RARITY[idx].color, RARITY[Math.min(idx + 1, baseLen - 1)].color, t);
}
function levelName(i, T) {
  if (i === T - 1) return 'legendario';
  const nNonLegend = T - 1;
  if (nNonLegend <= RARITY.length) return RARITY[i].name;
  const baseLen = RARITY.length;
  const pos = Math.min(baseLen - 1.0001, (i * baseLen) / nNonLegend);
  return RARITY[Math.round(pos)].name;
}

// ---------- Geometría de la barra ----------
function segmentCount(separators) { return separators + 1; }
function segLeft(i, T) { return (i * 100) / T; }          // % izquierdo del tramo i
function segLength(T) { return 100 / T; }                  // ancho de cada tramo en %
function sepPos(i, separators) { return (i * 100) / (separators + 1); } // % del hito = límite EXACTO del tramo i (mismo origen que segLeft)
// progreso del tramo i dado el pct global (ancho en %)
function segProgress(pct, i, T) {
  const start = segLeft(i, T);
  const len = segLength(T);
  return Math.max(0, Math.min(len, pct - start));
}
// índice del tramo "actual" (el que se está llenando)
function currentSeg(pct, T) {
  return Math.max(0, Math.min(T, Math.floor((pct / 100) * T)));
}
// cuántos separadores están alcanzados, dado pct global
function reachedSeparators(pct, separators) {
  let n = 0;
  for (let i = 1; i <= separators; i++) if (pct + 1e-9 >= sepPos(i, separators)) n++; // épsilon caza floats 20.0000000004
  return n;
}
// color final de un tramo (legendario conserva su propio background CSS)
function tramoColor(i, T, reached) {
  const c = levelColor(i, T);
  if (c === null) return null;
  return c;
}

const CORE = {
  RARITY, LEGENDARY, DEFAULTS, I18N, tr, detectLang,
  hexToRgb, lerp, lerpColor,
  levelColor, levelName,
  segmentCount, segLeft, segLength, sepPos, segProgress, currentSeg, reachedSeparators,
};

/* =====================================================================
   BROWSER-ONLY  (solo en navegador; en Node esto se omite)
   ===================================================================== */
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  (function () {
    const stored = GM_getValue('adhd_config', {});
    const cfg = Object.assign({}, DEFAULTS, stored, { lang: stored.lang || detectLang(navigator.language) });
    function save() { GM_setValue('adhd_config', cfg); }

    // ---------- Adaptación de tema claro/oscuro (Duolingo dark mode) ----------
    // Detecta por la luminancia del fondo del body: dark si < 128.
    GM_addStyle(`
      body.adhd-dark .adhd-btn { background:#1f2b33; color:#1cb0f6; box-shadow:0 4px 0 #0c1419; }
      body.adhd-dark .adhd-btn:active { box-shadow:0 0 0 #0c1419; }
      body.adhd-dark .adhd-panel { background:#1e2a31; box-shadow:0 4px 16px rgba(0,0,0,.55); }
      body.adhd-dark .adhd-panel label { color:#c9d1d9; }
      body.adhd-dark .adhd-panel input[type=range], body.adhd-dark .adhd-panel select { background:#142026; border-color:#3a4a52; color:#e5e5e5; }
      body.adhd-dark .adhd-panel h4 { color:#fff; }
      body.adhd-dark .adhd-divider { border-top-color:#3a4a52; }
      body.adhd-dark .adhd-panel button { background:#142026; border-color:#3a4a52; color:#e5e5e5; box-shadow:0 4px 0 #0b1216; }
      body.adhd-dark .adhd-panel button:active { box-shadow:0 0 0 #0b1216; }
      body.adhd-dark .adhd-sep-num { background:#1f2b30; }
    `);
    function isDarkTheme() {
      const bg = getComputedStyle(document.body).backgroundColor || '';
      const m = bg.match(/\d+/g);
      if (!m || m.length < 3) return false;
      return (0.299 * +m[0] + 0.587 * +m[1] + 0.114 * +m[2]) < 128;
    }
    function applyTheme() {
      document.body.classList.toggle('adhd-dark', isDarkTheme());
    }
    applyTheme();
    new MutationObserver(applyTheme)
      .observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style'] });

    let bar = null;
    // Versión dinámica: desde GM_info en Tampermonkey; fallback hardcodeado (harness).
    const VER = (typeof GM_info !== 'undefined' && GM_info.script && GM_info.script.version) ? GM_info.script.version : '1.4.6';
    let overlay = null;
    let settingsBtn = null;
    let lastWidth = 0;
    let lastValue = -1;
    let lastHitCount = 0;
    let finalBurstDone = false;

    function barHeight() {
      if (!bar) return 16;
      const v = parseFloat(getComputedStyle(bar).getPropertyValue('--__internal__progress-bar-height'));
      return isNaN(v) ? 16 : v;
    }

    GM_addStyle(`
      /* ===== overlay = píldora de Duolingo ===== */
      .adhd-overlay { position:absolute; inset:0; overflow:hidden; pointer-events:none; z-index:3; border-radius:calc(var(--__internal__progress-bar-height, 16px) / 2); }

      /* tramo base: píldora + shine (réplica de ._27NV6 / ._1EFTr nativos) */
      .adhd-seg { position:absolute; top:0; bottom:0; overflow:hidden; transition:width .4s ease; will-change:width; }
      .adhd-seg:first-child { border-radius:calc(var(--__internal__progress-bar-height, 16px) / 2) 0 0 calc(var(--__internal__progress-bar-height, 16px) / 2); }
      .adhd-seg:last-child  { border-radius:0 calc(var(--__internal__progress-bar-height, 16px) / 2) calc(var(--__internal__progress-bar-height, 16px) / 2) 0; }
      .adhd-seg:only-child  { border-radius:calc(var(--__internal__progress-bar-height, 16px) / 2); }
      .adhd-seg::after { content:''; position:absolute; left:4%; right:4%; top:25%; height:30%; background:#fff; opacity:.2; border-radius:9999px; pointer-events:none; }

      /* ===== TRAMO LEGENDARIO (el final): gradiente épico animado + glow + sparkles ===== */
      .adhd-seg.adhd-legendary {
        background: linear-gradient(135deg,#4c1d95,#7c3aed,#d946ef,#f59e0b,#fbbf24,#d946ef,#4c1d95);
        background-size: 400% 400%;
        animation: adhd-legend-bg 2.5s ease infinite, adhd-legend-glow 1.2s ease-in-out infinite;
        box-shadow: 0 0 14px rgba(168,85,247,.55), inset 0 0 8px rgba(255,255,255,.35);
      }
      @keyframes adhd-legend-bg { 0%,100%{background-position:0% 50%} 50%{background-position:100% 50%} }
      @keyframes adhd-legend-glow { 0%,100%{box-shadow:0 0 8px rgba(168,85,247,.4), inset 0 0 6px rgba(255,255,255,.3)} 50%{box-shadow:0 0 20px rgba(216,180,254,.9), inset 0 0 10px rgba(255,255,255,.5)} }
      /* ===== shines animadas (lenguaje nativo: franjas redondeadas como ._1EFTr) ===== */
      .adhd-seg.adhd-legendary::before, .adhd-seg.adhd-legendary::after {
        content:''; position:absolute; border-radius:9999px; background:#fff;
        animation: adhd-shine-pulse var(--dur,3.2s) ease-in-out infinite;
      }
      .adhd-seg.adhd-legendary::before { left:8%;  top:18%; width:32%; height:24%; opacity:.18; animation-delay:0s; }
      .adhd-seg.adhd-legendary::after  { left:42%; top:56%; width:24%; height:12%; opacity:.14; animation-delay:1.6s; }
      /* sweep: franja de luz que barre el tramo de izquierda a derecha */
      .adhd-seg.adhd-legendary .adhd-sweep {
        position:absolute; left:0; top:32%; width:46%; height:16%; border-radius:9999px;
        background:linear-gradient(90deg, rgba(255,255,255,0), rgba(255,255,255,.85), rgba(255,255,255,0));
        animation: adhd-sweep var(--sweep-dur,3.8s) ease-in-out infinite;
        animation-delay:var(--sweep-delay,0s);
      }
      /* flash: destello puntual que aparece y se desvanece */
      .adhd-seg.adhd-legendary .adhd-flash {
        position:absolute; left:30%; top:20%; width:7%; height:42%; border-radius:9999px; background:#fff;
        opacity:0; animation: adhd-flash var(--flash-dur,5.2s) ease-in-out infinite;
        animation-delay:var(--flash-delay,1.2s);
      }
      @keyframes adhd-shine-pulse { 0%,100%{opacity:.12} 50%{opacity:.3} }
      @keyframes adhd-sweep {
        0% { transform:translateX(-130%); opacity:0; }
        10% { opacity:.4; }
        40% { opacity:.4; }
        55%,100% { transform:translateX(240%); opacity:0; }
      }
      @keyframes adhd-flash { 0%,100%{opacity:0} 12%{opacity:.55} 30%,55%{opacity:.12} 75%{opacity:.35} }

      /* ===== separador/hito: píldora vertical con badge ===== */
      .adhd-sep { position:absolute; top:0; bottom:0; transform:translateX(-50%); z-index:4; border-radius:2px; transition:background .3s ease; }
      .adhd-sep-num { position:absolute; top:50%; left:50%; transform:translate(-50%,-50%); min-width:16px; height:16px; line-height:16px; padding:0 2px; text-align:center; background:#fff; border-radius:9999px; font:700 10px/16px duolingo-sans,"Duolingo Sans",sans-serif; color:#1cb0f6; box-shadow:0 1px 2px rgba(0,0,0,.25); white-space:nowrap; z-index:5; }

      /* ===== partículas del burst (celebración de hito): 2s, grandes ===== */
      .adhd-part { position:fixed; width:14px; height:14px; border-radius:50%; pointer-events:none; z-index:4000; animation:adhd-burst 2s ease-out forwards; box-shadow:0 0 8px rgba(255,255,255,.6); }
      @keyframes adhd-burst { 0%{transform:translate(0,0) scale(1); opacity:1} 100%{transform:translate(var(--dx),var(--dy)) scale(.3); opacity:0} }

      /* ===== botón ⚙ (sombra dura Duolingo: 0 4px 0 mismo tono, sin blur) ===== */
      .adhd-btn { position:fixed; z-index:2000; right:18px; top:70px; background:#fff; border:none; border-radius:12px; width:36px; height:36px; display:flex; align-items:center; justify-content:center; cursor:pointer; font-size:16px; line-height:1; color:#1cb0f6; font-weight:700; box-shadow:0 4px 0 #e5e5e5; transition:transform .1s ease, box-shadow .1s ease; }
      .adhd-btn:hover { border-color:#1cb0f6; }
      .adhd-btn:active { transform:translateY(4px); box-shadow:0 0 0 #e5e5e5; }

      /* ===== panel config ===== */
      .adhd-panel { position:fixed; z-index:1000; background:#fff; border-radius:16px; box-shadow:0 4px 12px rgba(0,0,0,.15); padding:16px; font-family:duolingo-sans,"Duolingo Sans",sans-serif; min-width:260px; }
      .adhd-panel h4 { margin:0 0 12px; font-size:15px; color:#0a7ec2; } /* #1cb0f6 fallaba WCAG AA (2.9:1); #0a7ec2 = 5.6:1 */
      .adhd-panel label { display:block; font-size:13px; color:#4b4b4b; margin:10px 0 4px; }
      .adhd-panel input[type=range] { width:100%; }
      .adhd-panel .adhd-val { font-weight:700; color:#0a7ec2; }
      /* botones del panel: sombra dura 4px estilo Feather (mismo lenguaje que .adhd-btn) */
      .adhd-panel button { display:block; width:100%; margin-top:10px; padding:7px; background:#fff; border:2px solid #e5e5e5; border-radius:12px; font:700 13px duolingo-sans,"Duolingo Sans",sans-serif; color:#4b4b4b; cursor:pointer; box-shadow:0 4px 0 #d3d3d3; transition:transform .1s ease, box-shadow .1s ease; }
      .adhd-panel button:active { transform:translateY(4px); box-shadow:0 0 0 #d3d3d3; }
      .adhd-divider { margin-top:12px; border-top:1px solid #e5e5e5; padding-top:10px; }
    `);

    function findBar() {
      // Sólo la barra de la LECCIÓN (con track ._3yKMC o fill ._27NV6).
      // Evita afectar la barra de desafío de /learn (era un efecto secundario).
      return [...document.querySelectorAll('[role="progressbar"]')]
        .find(b => b.querySelector('._3yKMC') || b.classList.contains('oCRF1') || b.querySelector('._27NV6')) || null;
    }

    function ensureRoots() {
      bar = findBar();
      if (!bar) return false;
      bar.querySelectorAll('._27NV6, ._1qzJe, ._345XU').forEach(el => el.style.opacity = '0');
      overlay = bar.querySelector('.adhd-overlay');
      if (!overlay) {
        bar.dataset.adhdRooted = '1';
        overlay = document.createElement('div');
        overlay.className = 'adhd-overlay';
        overlay.setAttribute('aria-hidden', 'true'); // decoración pura: no ensuciar el árbol accesible
        bar.appendChild(overlay);
        buildOverlayContent();
      }
      return true;
    }

    function buildOverlayContent() {
      if (!overlay) return;
      overlay.innerHTML = '';
      const T = segmentCount(cfg.separators);
      for (let i = 0; i < T; i++) {
        const div = document.createElement('div');
        div.className = 'adhd-seg';
        div.dataset.seg = i;
        div.style.left = segLeft(i, T) + '%';
        div.style.width = segLength(T) + '%';
        const c = levelColor(i, T);
        if (c === null) {
          div.classList.add('adhd-legendary');
          div.style.background = '';
          // shines animadas: sweep (barrido) + flash (destello), los shines fijos son ::before/::after
          const sweep = document.createElement('i');
          sweep.className = 'adhd-sweep';
          sweep.style.setProperty('--sweep-dur', '3.8s');
          sweep.style.setProperty('--sweep-delay', '0.4s');
          sweep.setAttribute('aria-hidden', 'true');
          div.appendChild(sweep);
          const flash = document.createElement('i');
          flash.className = 'adhd-flash';
          flash.style.setProperty('--flash-dur', '5.2s');
          flash.style.setProperty('--flash-delay', '1.2s');
          flash.setAttribute('aria-hidden', 'true');
          div.appendChild(flash);
        } else {
          div.style.background = c;
        }
        overlay.appendChild(div);
      }
      for (let i = 1; i <= cfg.separators; i++) {
        const sep = document.createElement('div');
        sep.className = 'adhd-sep';
        sep.dataset.sep = i;
        sep.style.left = sepPos(i, cfg.separators) + '%';
        sep.style.width = cfg.thickness + 'px';
        sep.style.background = 'rgba(0,0,0,.25)';
        if (cfg.showNumbers) {
          const n = document.createElement('span');
          n.className = 'adhd-sep-num';
          n.textContent = i;
          sep.appendChild(n);
        }
        overlay.appendChild(sep);
      }
    }

    function getProgress() {
      if (!bar) return { value: 0, max: 100 };
      const now = bar.getAttribute('aria-valuenow');
      const max = bar.getAttribute('aria-valuemax');
      let v = now != null ? parseFloat(now) : NaN;
      let m = max != null ? parseFloat(max) : 100;
      if (isNaN(v)) {
        const pct = getComputedStyle(bar).getPropertyValue('--__internal__progress-bar-value');
        v = parseFloat(pct) || 0; m = 100;
      }
      return { value: isNaN(v) ? 0 : v, max: isNaN(m) ? 100 : m };
    }

    function burst(xPct, color) {
      if (!bar) return;
      const r = bar.getBoundingClientRect();
      const x = r.left + r.width * (xPct / 100);
      const y = r.top + r.height / 2;
      const n = 14;
      for (let i = 0; i < n; i++) {
        const p = document.createElement('div');
        p.className = 'adhd-part';
        p.style.background = color;
        p.style.left = x + 'px';
        p.style.top = y + 'px';
        const ang = (i / n) * Math.PI * 2 + Math.random() * .3;
        const dist = 60 + Math.random() * 110;
        p.style.setProperty('--dx', Math.cos(ang) * dist + 'px');
        p.style.setProperty('--dy', Math.sin(ang) * dist + 'px');
        document.body.appendChild(p);
        setTimeout(() => p.remove(), 2100);
      }
    }

    function bigBurst(xPct) {
      if (!bar) return;
      const r = bar.getBoundingClientRect();
      const x = r.left + r.width * (xPct / 100);
      const y = r.top + r.height / 2;
      const colors = ['#ffd700', '#fbbf24', '#d946ef', '#7c3aed', '#ffffff'];
      const n = 40;
      for (let i = 0; i < n; i++) {
        const p = document.createElement('div');
        p.className = 'adhd-part';
        p.style.background = colors[i % colors.length];
        p.style.left = x + 'px';
        p.style.top = y + 'px';
        const ang = (i / n) * Math.PI * 2 + Math.random() * .4;
        const dist = 80 + Math.random() * 180;
        p.style.setProperty('--dx', Math.cos(ang) * dist + 'px');
        p.style.setProperty('--dy', Math.sin(ang) * dist + 'px');
        document.body.appendChild(p);
        setTimeout(() => p.remove(), 2100);
      }
    }

    function render() {
      if (!bar || !overlay) return;
      const w = bar.getBoundingClientRect().width;
      if (w <= 0) return;
      const { value, max } = getProgress();
      const pct = Math.max(0, Math.min(100, (value / max) * 100));
      lastWidth = w; lastValue = value;

      const T = segmentCount(cfg.separators);
      const curIdx = currentSeg(pct, T);
      const segLen = segLength(T);

      overlay.querySelectorAll('.adhd-seg').forEach(seg => {
        const i = parseInt(seg.dataset.seg, 10);
        const segDone = segProgress(pct, i, T);
        seg.style.width = segDone + '%';
        if (!seg.classList.contains('adhd-legendary')) {
          const c = levelColor(i, T);
          seg.style.background = c;
          seg.style.boxShadow = i < curIdx ? '0 0 6px rgba(255,255,255,.35)' : 'none';
          if (i === curIdx) {
            // hito en progreso: desaturado/transparente al empezar, satura al completarlo
            const done = Math.min(1, segDone / segLen);
            seg.style.opacity = String(0.25 + 0.75 * done);
          } else {
            seg.style.opacity = '1';
          }
        }
      });

      let hits = 0;
      overlay.querySelectorAll('.adhd-sep').forEach(sep => {
        const i = parseFloat(sep.dataset.sep);
        const hitAt = sepPos(i, cfg.separators);
        if (pct + 1e-9 >= hitAt) {
          hits++;
          const tramoIdx = i - 1;
          const c = levelColor(tramoIdx, T);
          sep.style.background = c === null ? '#fbbf24' : c;
          sep.style.boxShadow = '0 0 6px rgba(255,255,255,.5)';
          const badge = sep.querySelector('.adhd-sep-num');
          if (badge) {
            badge.style.background = c === null ? '#fbbf24' : c;
            badge.style.color = '#1f2b30'; // texto oscuro sobre el color del tramo
          }
        } else {
          sep.style.background = 'rgba(0,0,0,.25)';
          sep.style.boxShadow = 'none';
          const badge = sep.querySelector('.adhd-sep-num');
          if (badge) { badge.style.background = ''; badge.style.color = ''; } // CSS default
        }
      });

      if (hits > lastHitCount) {
        for (let h = lastHitCount; h < hits; h++) {
          const tramoIdx = h;
          const color = levelColor(tramoIdx, T) || '#fbbf24';
          const xAt = sepPos(h + 1, cfg.separators);
          setTimeout(() => burst(xAt, color), (h - lastHitCount) * 250);
        }
      }
      lastHitCount = hits;

      if (pct >= 99.5 && hits >= cfg.separators && !finalBurstDone) {
        finalBurstDone = true;
        const cx = ((cfg.separators + 0.5) / (cfg.separators + 1)) * 100;
        bigBurst(cx);
      }
      if (pct < 2 && hits === 0) {
        finalBurstDone = false;
        lastHitCount = 0;
      }
    }

    function injectSettingsBtn() {
      if (settingsBtn) settingsBtn.remove();
      settingsBtn = document.createElement('div');
      settingsBtn.className = 'adhd-btn';
      settingsBtn.textContent = '⚙';
      settingsBtn.title = tr(cfg.lang, 'btnSettingsTitle');
      settingsBtn.addEventListener('click', (e) => { e.stopPropagation(); togglePanel(); });
      document.body.appendChild(settingsBtn);
    }

    let panel = null;
    function togglePanel() {
      if (panel) { panel.remove(); panel = null; return; }
      panel = document.createElement('div');
      panel.className = 'adhd-panel';
      panel.innerHTML = `
        <h4>${tr(cfg.lang, 'panelTitle')}</h4>
        <label for="adhd-lang">${tr(cfg.lang, 'langLabel')}</label>
        <select id="adhd-lang">
          <option value="es" ${cfg.lang === 'es' ? 'selected' : ''}>Español</option>
          <option value="en" ${cfg.lang === 'en' ? 'selected' : ''}>English</option>
        </select>
        <label for="adhd-range">${tr(cfg.lang, 'labelMilestones')} <span class="adhd-val" id="adhd-pn">${cfg.separators}</span></label>
        <input type="range" id="adhd-range" min="1" max="12" value="${cfg.separators}" aria-label="${tr(cfg.lang, 'ariaMilestones')}">
        <label><input type="checkbox" id="adhd-num" ${cfg.showNumbers ? 'checked' : ''}> ${tr(cfg.lang, 'labelShowNumbers')}</label>
        <button id="adhd-reset">${tr(cfg.lang, 'btnReset')}</button>
      `;
      document.body.appendChild(panel);
      panel.style.right = '20px';
      panel.style.top = '80px';

      panel.querySelector('#adhd-lang').addEventListener('change', (e) => {
        cfg.lang = e.target.value;
        save();
        panel.remove(); panel = null;
        togglePanel(); // reconstruye con el nuevo idioma
      });
      const range = panel.querySelector('#adhd-range');
      range.addEventListener('input', () => { panel.querySelector('#adhd-pn').textContent = range.value; });
      const done = () => {
        cfg.separators = parseInt(range.value, 10);
        cfg.showNumbers = panel.querySelector('#adhd-num').checked;
        save();
        buildOverlayContent(); render();
      };
      range.addEventListener('change', done);
      panel.querySelector('#adhd-num').addEventListener('change', done);
      panel.querySelector('#adhd-reset').addEventListener('click', () => {
        const keepLang = cfg.lang;
        Object.assign(cfg, DEFAULTS, { lang: keepLang });
        save();
        range.value = cfg.separators; panel.querySelector('#adhd-pn').textContent = cfg.separators;
        panel.querySelector('#adhd-num').checked = cfg.showNumbers;
        buildOverlayContent(); render();
      });
      setTimeout(() => {
        document.addEventListener('click', function outside(e) {
          if (!panel || panel.contains(e.target)) return;
          panel.remove(); panel = null;
          document.removeEventListener('click', outside);
        });
      }, 0);
    }

    function attachObserver() {
      const mo = new MutationObserver(() => {
        ensureRoots();
        const w = bar ? bar.getBoundingClientRect().width : 0;
        const { value } = getProgress();
        if (bar && (w !== lastWidth || value !== lastValue)) render();
        if (!bar) { overlay = null; }
      });
      mo.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['aria-valuenow', 'style', 'aria-valuemax'] });
    }

    function init() {
      const tryIt = setInterval(() => {
        if (ensureRoots()) { clearInterval(tryIt); render(); injectSettingsBtn(); }
      }, 500);
      setTimeout(() => clearInterval(tryIt), 30000);
      attachObserver();
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', init);
    } else {
      init();
    }
  })();
}

/* =====================================================================
   NODE EXPORT (solo para tests; en navegador module es undefined)
   ===================================================================== */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = CORE;
}