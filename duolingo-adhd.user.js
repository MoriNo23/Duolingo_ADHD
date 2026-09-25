// ==UserScript==
// @name           Duolingo ADHD — Progress bar milestones (for the easily distracted / bored)
// @name:es        Duolingo ADHD — Hitos de barra de progreso (para los que se aburren / se distraen)
// @namespace      https://github.com/MoriNo23/duolingo-adhd
// @version        2.8.0
// @description    Splits the lesson progress bar into segments. Timer mode: each segment starts at Super tier and decays down the tier ladder (Wood→Super) as the budget burns — close fast to freeze a better tier. Particles, combat text, Baloo 2 clock, local journal + EN/ES settings. Keeps Duolingo's native design.
// @description:en Splits the lesson progress bar into segments. Timer mode: each segment starts at Super tier and decays down the tier ladder (Wood→Super) as the budget burns — close fast to freeze a better tier. Particles, combat text, Baloo 2 clock, local journal + EN/ES settings. Keeps Duolingo's native design.
// @description:es Divide la barra de progreso de la lección en tramos. Modo tiempo: cada tramo arranca en el nivel Super y va bajando de peldaño (Madera→Super) mientras se quema el presupuesto — cerrá rápido para congelar mejor jerarquía. Partículas, combat text, cronómetro Baloo 2, diario local + panel EN/ES. Mantiene el diseño nativo de Duolingo.
// @author         Mori
// @license        MIT
// @downloadURL    https://update.greasyfork.org/scripts/590127/duolingo-adhd-progress-bar-milestones-for-the-easily-distracted-bored.user.js
// @updateURL      https://update.greasyfork.org/scripts/590127/duolingo-adhd-progress-bar-milestones-for-the-easily-distracted-bored.user.js
// @match        https://*.duolingo.com/lesson*
// @match        https://*.duolingo.com/practice*
// @match        https://*.duolingo.com/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addStyle
// @grant        GM_xmlhttpRequest
// @connect      fonts.googleapis.com
// @connect      fonts.gstatic.com
// @run-at       document-idle
// ==/UserScript==

// NOTA settings-panel-visuals (2026-09-25, v2.7.0): botón de ajustes como
// pestaña soldada al borde derecho (ícono SVG, sin emoji); panel con jerarquía
// header/secciones/footer; glyphs del decay timeline → marcas geométricas CSS
// (el emoji vive solo en el tooltip); sección Lab y helpers tramoColor/barHeight
// retirados (sin llamadas ni tests dependientes).

// NOTA decay-timeline-visibility (2026-09-25, v2.7.1): el visualizador de
// jerarquía (.adhd-decay-timeline) se DESVANECÍA/desancaba al cambiar de tramo.
// Causas y Lifecycle (leer antes de tocar esta zona):
//   1) El cruce de tramo hacía stopMiniCrono() → startMiniCrono(), y
//      stopMiniCrono() BORRABA el timeline. Ahora el cruce llama restartRace():
//      el visualizador PERSISTE durante toda la carrera.
//   2) Geometría: constantes ADHD_TIMELINE_GAP (8px de aire) y ADHD_TIMELINE_H
//      (28px = 20px de riel + 2px padding*2 + 2px borde*2). Son el espejo de
//      --adhd-rail-h y de las reglas CSS de .adhd-decay-timeline; si cambiás el
//      alto o el borde en CSS, actualizá ADHD_TIMELINE_H o el flip queda mal medido.
//   2b) redesign-decay-timeline (v2.8.0): el widget pasó de 6 bandas + formas de
//      8px a un RIEL CONTINUO. Estructura: .adhd-rail-track > .adhd-rail-earned
//      (presupuesto quemado, gris) + .adhd-rail-fill (restante, material del
//      peldaño PROYECTADO) + .adhd-rail-notches (escalera de referencia) +
//      .adhd-rail-head (frontera ganada/restante, filo duro + sweep) +
//      .adhd-rail-label (nombre del peldaño proyectado, texto legible).
//      NO volver a dibujar formas geométricas por peldaño: eran un canal
//      categórico ilegible a 8px (Jerarquía Cleveland-McGill: longitud > color)
//   3) Posicionamiento: positionDecayTimeline() hace FLIP — arriba si hay
//      espacio (top >= 0), debajo si la barra está contra el borde superior.
//      Se re-ancla por scroll/resize/visualViewport, ResizeObserver sobre la
//      barra, y por chequeo de rect en render()/tick() (red de seguridad para
//      layout shifts que no emiten eventos, p.ej. transform del header).
//   4) Fin de vida REAL (único lugar que borra el visualizador):
//      teardownTimerFx() → removeDecayTimeline() + detachTimelineSync().
//      Se llama al completar la lección, al cambiar de pantalla SPA, al perder
//      la barra y en el reset de lección nueva. NO volver a colgar el borrado
//      de stopMiniCrono(): esa es la regresión que arregla este change.

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
// Verde NO está en RARITY: es un estado temporal (tramos en progreso con timer),
// no una rareza posicional. Se aplica vía CSS class .adhd-rarity-verde directamente.
const LEGENDARY = null; // el último tramo es legendario (gradiente CSS)

const DEFAULTS = {
  separators: 4,          // fronteras de tramo (la barra queda en separators+1 tramos)
  lang: 'es',             // idioma del panel: 'es' | 'en'
  // Feature 1: cronómetro por separador (arena-timer-overhaul: ON por defecto)
  timerMode: true,        // ON = decaimiento por bandas (nuevo) | OFF = solo separadores
  timerMinutes: 10,       // minutos por tramo (1–30)
  timerSeconds: 0,        // segundos adicionales (0–59)
  timerShowLabel: true,   // mostrar "⚡ RÁPIDO" al cruzar separador
  timerHardness: 35,      // dureza de bandas 0–100 (0=generosa, 100=exigente)
  // Feature 3: diario local (persiste via GM_setValue, nunca push)
  journalEnabled: false,  // contadores diarios simples
};

// ---------- timer-mode-ux constantes + preview (pure core) ----------
// arena-timer-overhaul: BLINK_THRESHOLD, PREVIEW_CLASSES y previewClass fueron
// reemplazados por la mecánica de bandas (bandsFor/rungAt/bandEdges/rungClass,
// ver la sección arena-timer-overhaul en el Feature 1) y la urgencia frac > 0.8.

// ---------- i18n (panel de ajustes) ----------
const I18N = {
  es: {
    panelTitle:      'Tramos de barra (ADHD)',
    langLabel:       'Idioma',
    labelMilestones: 'Tramos por lección:',
    ariaMilestones:  'Cantidad de tramos',
    btnReset:        'Restablecer valores',
    btnSettingsTitle:'Configurar tramos',
    // timer-mode-ux: secciones del panel
    secCrono:        'Cronómetro',
    hintBar:         'Corta la barra en tramos (sin hitos marcados). Al cerrar cada tramo: partículas + jerarquía congelada.',
    hintTimer:       'Los tramos arrancan en el techo (nivel Super) y bajan un peldaño por cada franja de presupuesto quemada. Cerrá rápido para congelar mejor jerarquía.',
    hintTimerGoal:   'Cada franja de la línea de decaimiento es un peldaño: el color que haya bajo el playhead al cerrar el tramo queda grabado. Dureza alta = franjas del techo más angostas. Pasá el cursor por una franja para ver su peldaño y rango.',
    hintJournal:     'Cuenta lecciones, tramos y tiempos. Se guarda solo en tu navegador.',
    // Feature 1: cronómetro
    secDiario:       'Diario local',
    // redesign-decay-timeline: rótulos del riel (mayúsculas, sin emoji)
    railMadera:      'MADERA',
    railBronce:      'BRONCE',
    railPlata:       'PLATA',
    railRacha:       'RACHA',
    railDiamante:    'DIAMANTE',
    railSuper:       'SUPER',
    railPerdido:     'PERDIDO',
    lblTimerMode:    'Modo tiempo',
    lblTimerFixed:   'Objetivo (seg)',
    lblTimerHardness: 'Dureza de bandas (0 generosa–100 exigente)',
    lblTimerLabel:   'Mostrar ⚡ RÁPIDO',
    btnTestFx:       'Probar efectos',
    // Feature 3: diario
    lblJournal:      'Activar diario',
    jrLessons:       'Lecciones hoy',
    jrSeps:          'Tramos hoy',
    jrAvgTime:       'Tiempo medio/sep',
    jrStreak:        'Racha (días)',
    jrTotal:         'Lecciones totales',
    jrNoData:        'Sin datos — activa el diario',
  },
  en: {
    panelTitle:      'Progress bar segments (ADHD)',
    langLabel:       'Language',
    labelMilestones: 'Segments per lesson:',
    ariaMilestones:  'Number of segments',
    btnReset:        'Reset values',
    btnSettingsTitle:'Configure distraction segments',
    // timer-mode-ux: panel sections
    secCrono:        'Timer',
    hintBar:         'Splits the bar into segments (no milestone markers). Closing each segment: particles + frozen tier.',
    hintTimer:       'Segments start at the ceiling (Super tier) and drop a tier per band of budget burned. Close fast to freeze a better tier.',
    hintTimerGoal:   'Each band of the decay line is a tier: whatever color sits under the playhead when you close the segment gets frozen. Higher hardness = narrower ceiling bands. Hover a band for its tier and time range.',
    hintJournal:     'Tracks lessons, segments and times. Stored only in your browser.',
    // Feature 1: timer
    secDiario:       'Local journal',
    // redesign-decay-timeline: riel labels (uppercase, no emoji)
    railMadera:      'WOOD',
    railBronce:      'BRONZE',
    railPlata:       'SILVER',
    railRacha:       'STREAK',
    railDiamante:    'DIAMOND',
    railSuper:       'SUPER',
    railPerdido:     'LOST',
    lblTimerMode:    'Timer mode',
    lblTimerFixed:   'Goal (sec)',
    lblTimerHardness: 'Band hardness (0 generous–100 strict)',
    lblTimerLabel:   'Show ⚡ FAST',
    btnTestFx:       'Test effects',
    // Feature 3: journal
    lblJournal:      'Enable journal',
    jrLessons:       'Lessons today',
    jrSeps:          'Segments today',
    jrAvgTime:       'Avg time/sep',
    jrStreak:        'Streak (days)',
    jrTotal:         'Total lessons',
    jrNoData:        'No data — enable journal',
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
// (tramoColor retirado: wrapper sin uso sobre levelColor)

// =====================================================================
// Feature 1: CarreraTimer — mide el tiempo por separador (carrera)
// =====================================================================
// Una "carrera" es el tiempo desde el inicio de la lección (o el último
// separador cruzado) hasta cruzar el siguiente. El timer se pausa cuando
// la lección se reinicia (pct < 2).
//
// El timer NO corre contra el usuario: el objetivo lo pone VOS (minutos+segundos).
// Al completar un tramo, el ratio (tiempo empleado / objetivo) determina el rarity
// final del tramo — independientemente de su posición.

// ---------- arena-timer-overhaul: escala de rungs + bandas de presupuesto ----------
// El tramo NO tiene jerarquía por posición: la GANA el usuario según cuánto tarda.
// Arranca proyectado en el techo (Super) y decae un peldaño por cada banda quemada.
// El rung en el instante del cierre queda grabado; presupuesto agotado = Perdido.

// Tabla de peldaños (piso → techo). from/to definen el gradiente del skin; ink, el texto.
const RUNGS = [
  { id: 'madera',   label: 'Madera',   glyph: '🪵',     from: '#8d6e63', to: '#b39184', ink: '#3e2b26', skin: 'matte' },
  { id: 'bronce',   label: 'Bronce',   glyph: '🥉', from: '#8a4f2a', to: '#d29a6b', ink: '#3a1d0c', skin: 'bevel' },
  { id: 'plata',    label: 'Plata',    glyph: '🥈',     from: '#93a3ae', to: '#eaf1f6', ink: '#2c3a45', skin: 'metal' },
  { id: 'racha',    label: 'Racha',    glyph: '🔥',  from: '#ff9600', to: '#ffe066', ink: '#4a2500', skin: 'flame' },
  { id: 'diamante', label: 'Diamante', glyph: '💎',    from: '#3fd0cc', to: '#e7ffff', ink: '#04403d', skin: 'prism' },
  { id: 'super',    label: 'Super',    glyph: '👑',    from: '#8b5cf6', to: '#e9d5ff', ink: '#2a0a52', skin: 'super' },
];

// Ausencia de jerarquía: no es un peldaño, es exceder el presupuesto.
const LOST = { id: 'perdido', label: 'Perdido', glyph: '⌛', from: '#afafaf', to: '#d4d4d4', ink: '#4b4b4b', skin: 'matte' };

// Anchos de banda del presupuesto (techo → piso). bands[0] = franja del techo (Super).
const BAND_TABLES = {
  generosa: [0.50, 0.18, 0.12, 0.09, 0.07, 0.04],
  exigente: [0.10, 0.12, 0.14, 0.17, 0.21, 0.26],
};

// hardness 0 = generosa, 1 = exigente. Interpola y renormaliza a 1.
function bandsFor(hardness) {
  const h = Math.max(0, Math.min(1, hardness));
  const g = BAND_TABLES.generosa;
  const e = BAND_TABLES.exigente;
  const raw = g.map((v, i) => v + (e[i] - v) * h);
  const sum = raw.reduce((a, c) => a + c, 0);
  return raw.map((v) => v / sum);
}

// Rung proyectado habiendo quemado `frac` del presupuesto. -1 = Perdido.
// Ascendente: índice alto = jerarquía alta (RUNGS[5] = Super).
function rungAt(bands, frac) {
  if (frac >= 1) return -1;
  let acc = 0;
  for (let i = 0; i < bands.length; i++) {
    acc += bands[i];
    if (frac < acc) return RUNGS.length - 1 - i;
  }
  return 0;
}

// Frontera izquierda de cada rung (ascendente), en fracción del presupuesto.
function bandEdges(bands) {
  const n = RUNGS.length;
  const edges = new Array(n).fill(0);
  let acc = 0;
  for (let i = 0; i < bands.length && i < n; i++) {
    const rung = n - 1 - i;
    edges[rung] = acc;
    acc += bands[i];
  }
  return edges;
}

// Pure mapping: rung index → clase CSS del skin. -1 = perdido. Null-safe.
function rungClass(rungIdx) {
  if (rungIdx === -1) return 'adhd-rung-perdido';
  if (typeof rungIdx !== 'number' || rungIdx < 0 || rungIdx >= RUNGS.length) return null;
  return 'adhd-rung-' + RUNGS[rungIdx].id;
}

// Color del texto del mini cronómetro según el rung proyectado.
function rungTextColor(rungIdx) {
  if (rungIdx === -1) return '#afafaf';
  const r = RUNGS[rungIdx];
  return r ? r.ink : '#ffffff';
}

const STORAGE_KEY_TIMES = 'adhd_timer_times'; // array de tiempos por carrera (ms)

function getTimerGoalMs(cfg) {
  return (cfg.timerMinutes * 60 + cfg.timerSeconds) * 1000;
}

// Evalúa el tiempo de una carrera contra el presupuesto con bandas de dureza.
// Devuelve { frac, rung, isFast, lost } donde rung es índice a RUNGS (-1 = perdido)
// e isFast = rung >= 4 (diamante o super).
function evaluateRace(ms, goalMs, hardness) {
  if (!goalMs || goalMs <= 0) return null;
  const frac = ms / goalMs;
  const rung = rungAt(bandsFor(hardness), frac);
  const isFast = rung >= 4;
  return { frac, rung, isFast, lost: rung === -1 };
}

function loadTimes() {
  // En navegador usa GM_getValue; en Node/Tests usa global.__adhd_test_store
  if (typeof GM_getValue === 'function') {
    return GM_getValue(STORAGE_KEY_TIMES, []);
  }
  return [];
}

function saveTimes(times) {
  if (typeof GM_setValue === 'function') {
    GM_setValue(STORAGE_KEY_TIMES, times);
  }
}

function getAverage(times) {
  if (!times || times.length === 0) return null;
  const sum = times.reduce((a, b) => a + b, 0);
  return sum / times.length;
}

function resetTimes() {
  saveTimes([]);
}

// Cuenta cuántas carreras nuevas se completaron entre lastHitCount y hits
// Devuelve array de {raceIndex} para las carreras completadas
function newRaces(lastHitCount, hits) {
  const races = [];
  for (let h = lastHitCount; h < hits; h++) {
    races.push({ raceIndex: h });
  }
  return races;
}

// Evalúa el tiempo de una carrera contra el objetivo fijo (arena-timer-overhaul lo reemplazó
// por evaluateRace con bandas — ver arriba).

// =====================================================================
// Feature 3: Diario local (contadores simples, nunca push)
// =====================================================================

const STORAGE_KEY_JOURNAL = 'adhd_journal';

function loadJournal() {
  if (typeof GM_getValue === 'function') {
    return GM_getValue(STORAGE_KEY_JOURNAL, null);
  }
  return null;
}

function saveJournal(journal) {
  if (typeof GM_setValue === 'function') {
    GM_setValue(STORAGE_KEY_JOURNAL, journal);
  }
}

function todayKey() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function initJournal() {
  return {
    date: todayKey(),
    lessons: 0,
    separators: 0,
    raceTimes: [],      // tiempos de carrera del día (ms)
    totalLessons: 0,
    streak: 0,
    lastDate: null,
  };
}

function getJournal() {
  let j = loadJournal();
  if (!j || j.date !== todayKey()) {
    // Día nuevo: calcular racha
    if (j && j.date) {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yKey = yesterday.getFullYear() + '-' + String(yesterday.getMonth() + 1).padStart(2, '0') + '-' + String(yesterday.getDate()).padStart(2, '0');
      const wasYesterday = (j.date === yKey);
      j = initJournal();
      j.streak = wasYesterday ? (j.streak || 0) : 0;
      j.totalLessons = (j.totalLessons || 0);
    } else {
      j = initJournal();
    }
    saveJournal(j);
  }
  return j;
}

function recordLesson() {
  const j = getJournal();
  j.lessons++;
  j.totalLessons++;
  saveJournal(j);
  return j;
}

function recordSeparators(count) {
  const j = getJournal();
  j.separators += count;
  saveJournal(j);
  return j;
}

function recordRaceTime(ms) {
  const j = getJournal();
  j.raceTimes.push(ms);
  saveJournal(j);
  return j;
}

function resetJournal() {
  saveJournal(initJournal());
}

const CORE = {
  RARITY, LEGENDARY, DEFAULTS, I18N, tr, detectLang,
  hexToRgb, lerp, lerpColor,
  levelColor, levelName,
  segmentCount, segLeft, segLength, sepPos, segProgress, currentSeg, reachedSeparators,
  // arena-timer-overhaul: escala + bandas + evaluación
  RUNGS, LOST, BAND_TABLES, bandsFor, rungAt, bandEdges, rungClass, rungTextColor,
  loadTimes, saveTimes, getAverage, resetTimes, newRaces, evaluateRace,
  getTimerGoalMs,
  // Feature 3: journal
  loadJournal, saveJournal, todayKey, initJournal, getJournal,
  recordLesson, recordSeparators, recordRaceTime, resetJournal,
  // lesson-only-overlay + lesson-bar-container-anchor: detection
  isLessonScreen, isLessonBar, findLessonBarByAnchor, findBarBySignature,
};

// ---------- Lesson bar detection signature (lesson-only-overlay) ----------
// Validated against real DOM captures (pb-spy-2026-09-16 (1).json, 136 events):
//   lesson bars:    aria-valuemax="1" (fraction 0-1), width 801-958px, top-anchored (y<100), never _2nasW
//   challenge bars: integer aria-valuemax (3/20/30/35), narrow (208-360px), always _2nasW
// See openspec/changes/lesson-only-overlay/design.md. Re-validate with progressbar-spy
// when Duolingo changes its DOM. Hashed class names are never detection gates.

// Screen filter: lesson-like screens. True for /lesson, any /lesson/* prefix
// (e.g. /lesson/unit/102/level/2), /practice (legacy practice screen), any
// /practice/* prefix, and /practice-hub/* practice entries
// (e.g. /practice-hub/listen-up). NOT /practice-hub root (challenge bars only).
function isLessonScreen(pathname) {
  const p = typeof pathname === 'string' ? pathname : window.location.pathname;
  return p === '/lesson' || p.startsWith('/lesson/') ||
         p === '/practice' || p.startsWith('/practice/') ||
         p.startsWith('/practice-hub/');
}

// Bar signature detector (FALLBACK since lesson-bar-container-anchor; the primary
// gate is the quit-button anchor). `rect` is injectable for testing.
// NOTE: the width ≥ 50%-viewport gate was REMOVED — it caused false negatives on
// virtual/wide displays (real 880px lesson bar rejected against a 2166px viewport).
function isLessonBar(el, opts) {
  const o = opts || {};
  const rect = o.rect || (el && el.getBoundingClientRect ? el.getBoundingClientRect() : null);
  if (!el || el.getAttribute('role') !== 'progressbar') return false;
  if (el.getAttribute('aria-valuemax') !== '1') return false;   // hard gate: fractional progress
  if (el.classList.contains('_2nasW')) return false;            // hard exclusion: challenge bar class
  if (!rect) return false;
  if (rect.y > 120) return false;                               // geometry: top-anchored
  return true;
}

// ---------- Lesson bar anchor (lesson-bar-container-anchor, PRIMARY gate) ----------
// Structural detection from the live DOM capture (user-provided):
//   div.I-Avc._1zcW8                          ← lesson header row (hashed classes, unstable)
//   ├─ button[data-test="quit-button"]         ← SEMANTIC ANCHOR (Duolingo E2E hook, stable)
//   ├─ div[role="progressbar"]                 ← the lesson bar (sibling of the anchor)
//   └─ div._3ww7z (hearts)                     ← confirming sibling
// The lesson bar is the progressbar sharing the header row with the quit button.
// No geometry, no viewport math, no hashed classes. `data-test` (not data-testid)
// is what Duolingo's own E2E depends on — the lowest-churn attribute on the page.
function findLessonBarByAnchor(root) {
  const doc = root || (typeof document !== 'undefined' ? document : null);
  if (!doc || !doc.querySelector) return null;
  const btn = doc.querySelector('button[data-test="quit-button"]');
  if (!btn) return null;
  // Walk up from the quit button to the row that contains the progressbar.
  // Capture shows the bar is a sibling of the button (same row, 1-2 hops up).
  let cur = btn;
  for (let hop = 0; hop < 4 && cur; hop++) {
    const bar = cur.querySelector('[role="progressbar"]');
    if (bar) return bar;
    cur = cur.parentElement;
  }
  return null;
}

// Fallback path: first progressbar on screen matching the v2.1 signature
// (valuemax="1", no _2nasW, top-anchored). Used only when the anchor is absent.
function findBarBySignature(root) {
  const doc = root || (typeof document !== 'undefined' ? document : null);
  if (!doc || !doc.querySelectorAll) return null;
  const bars = doc.querySelectorAll('[role="progressbar"]');
  for (const b of bars) {
    if (isLessonBar(b)) return b;
  }
  return null;
}

/* =====================================================================
   BROWSER-ONLY  (solo en navegador; en Node esto se omite)
   ===================================================================== */
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  (function () {
    const stored = GM_getValue('adhd_config', {});
    const cfg = Object.assign({}, DEFAULTS, stored, { lang: stored.lang || detectLang(navigator.language) });
    function save() { GM_setValue('adhd_config', cfg); }
    // decay-timeline-visibility (D5): punto único de escritura de cfg. Antes
    // había 8 pares `cfg.x = ...; save();` dispersos (panel) y era fácil
    // olvidar persistir o guardar de más.
    function setCfg(key, value) { cfg[key] = value; save(); }

    // ---------- Adaptación de tema claro/oscuro (Duolingo dark mode) ----------
    // Detecta por la luminancia del fondo del body: dark si < 128.
    GM_addStyle(`
      body.adhd-dark .adhd-btn { background:#1f2b33; color:#1cb0f6; box-shadow:none; }
      body.adhd-dark .adhd-btn:hover { background:#27363f; }
      body.adhd-dark .adhd-panel { background:#1e2a31; border-radius:16px 0 0 16px; box-shadow:-2px 0 0 #0c1419; }
      body.adhd-dark .adhd-panel label { color:#c9d1d9; }
      body.adhd-dark .adhd-panel input[type=range], body.adhd-dark .adhd-panel select { background:#142026; border-color:#3a4a52; color:#e5e5e5; }
      body.adhd-dark .adhd-panel h4 { color:#fff; }
      body.adhd-dark .adhd-eyebrow { color:#1cb0f6; }
      body.adhd-dark .adhd-sec-body { color:#c9d1d9; }
      body.adhd-dark .adhd-foot { border-top-color:#3a4a52; }
      body.adhd-dark .adhd-divider { border-top-color:#3a4a52; }
      body.adhd-dark .adhd-panel button { background:#142026; border-color:#3a4a52; color:#e5e5e5; box-shadow:0 4px 0 #0b1216; }
      body.adhd-dark .adhd-panel button:active { box-shadow:0 0 0 #0b1216; }
      /* timer-mode-ux: dark theme para secciones */
      body.adhd-dark .adhd-panel summary { color:#84d8ff; background:rgba(132,216,255,.08); }
      body.adhd-dark .adhd-panel .adhd-hint { color:#8fa3ad; }
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
    let lastPct = 0;            // porcentaje 0-100 (para mini cronómetro)
    let lastHitCount = 0;
    let finalBurstDone = false;
    // Feature 1: estado del timer
    let raceStartTime = 0;        // timestamp ms cuando empezó la carrera actual
    let raceTimes = [];           // tiempos por carrera (ms) persistentes
    let completedRarities = [];   // rarity final de cada tramo completado (por índice)
    let miniCronoEl = null;       // elemento DOM del mini cronómetro
    let miniCronoInterval = null; // intervalo de actualización del mini cronómetro
    let currentRaceMs = 0;        // tiempo transcurrido en carrera actual
    // Feature 3: diario
    let journal = null;           // diario local (cargado bajo demanda)
    let lessonStartTs = 0;        // timestamp de inicio de lección
    let fastLabelEls = [];        // elementos DOM del rótulo "⚡ RÁPIDO"
    // arena-timer-overhaul: estado del rediseño del timer
    let decayEl = null;           // timeline de decaimiento (6 bandas + playhead)
    let lastProjectedRung = null; // rung proyectado del tramo activo (para detectar caída)
    let activeParts = 0;          // nodos de partículas vivos (cap 44)
    const REDUCED_MOTION = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

    // (barHeight retirado: helper sin invocaciones; la altura usa la custom property inline)

    // @import debe ser la primera regla del stylesheet: bloque propio (arena-timer-overhaul).
    // tramo-fx-round2 (Mori en vivo): este @import está sujeto al CSP de la PÁGINA y
    // falla silencioso en lecciones → el cronómetro caía a fuente del sistema.
    // Lo mantenemos como vía secundaria, pero la vía primaria es el loader de abajo.
    GM_addStyle(`@import url('https://fonts.googleapis.com/css2?family=Baloo+2:wght@700&display=swap');`);

    // Vía primaria: GM_xmlhttpRequest corre en el sandbox del manager (sin CSP de
    // página, sin CORS) → baja el woff2 latin de Google Fonts y lo inyecta como
    // data: URI. ~15KB, una vez por carga de página, sin requests externos después.
    (function loadBaloo2Data() {
      if (typeof GM_xmlhttpRequest !== 'function' || typeof btoa !== 'function') return;
      const MODERN_UA = 'Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0';
      GM_xmlhttpRequest({
        method: 'GET',
        url: 'https://fonts.googleapis.com/css2?family=Baloo+2:wght@700&display=swap',
        headers: { 'User-Agent': MODERN_UA }, // UA moderno → Google sirve woff2 por subset
        timeout: 8000,
        onload: (cssRes) => {
          if (cssRes.status !== 200 || !cssRes.responseText) return;
          // Solo el bloque latin (firma U+0000-00FF): dígitos, ':' y '.' viven ahí
          const latin = cssRes.responseText.split('@font-face').find(b => b.includes('U+0000-00FF'));
          const m = latin && latin.match(/https:\/\/fonts\.gstatic\.com[^)]+/);
          if (!m) return;
          GM_xmlhttpRequest({
            method: 'GET',
            url: m[0],
            headers: { 'User-Agent': MODERN_UA },
            responseType: 'arraybuffer',
            timeout: 10000,
            onload: (fontRes) => {
              const buf = fontRes.response;
              if (fontRes.status !== 200 || !buf || !buf.byteLength) return;
              const bytes = new Uint8Array(buf);
              let bin = '';
              for (let i = 0; i < bytes.length; i += 0x8000) { // chunks: btoa no traga 15KB de golpe
                bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
              }
              GM_addStyle(
                '@font-face{font-family:"Baloo 2";font-style:normal;font-weight:700;' +
                'font-display:swap;src:url(data:font/woff2;base64,' + btoa(bin) + ') format("woff2");}'
              );
            },
          });
        },
      });
    })();

    GM_addStyle(`
      /* ===== overlay = píldora de Duolingo ===== */
      .adhd-overlay { position:absolute; inset:0; overflow:hidden; pointer-events:none; z-index:3; border-radius:calc(var(--__internal__progress-bar-height, 16px) / 2); }

      /* tramo base: píldora + shine (réplica de ._27NV6 / ._1EFTr nativos) */
      .adhd-seg { position:absolute; top:0; bottom:0; overflow:hidden; transition:width .4s ease, box-shadow .32s ease-out; will-change:width; }
      .adhd-seg.adhd-no-anim { transition:none !important; } /* timer-mode-ux: base sin transición al construir */
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

      /* ===== TEXTURAS DE RAREZA (Feature 2) ===== */
      /* Verde: barras en progreso con timer — uniforme, sin jerarquía */
      .adhd-rarity-verde {
        background: linear-gradient(180deg, #a8e6a1 0%, #56ab2f 50%, #3d8b1f 100%);
      }
      /* Blink cuando el tramo está casi completo (80%+) */
      @keyframes adhd-green-blink {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.7; }
      }
      .adhd-seg.adhd-blink { animation: adhd-green-blink 0.5s ease-in-out infinite; }

      /* ===== timer-mode-ux: live rarity preview (glow "becoming", no color final) ===== */
      /* Mientras el tramo activo parpadea (60%+), su glow/tinte indica en tiempo
         real qué rareza proyecta el ritmo actual. Tinte ≤30% + outer glow suave:
         la transformación final (burst + fill sólido) sigue siendo sorpresa. */
      .adhd-seg.adhd-preview-legendario { box-shadow:0 0 16px rgba(251,191,36,.75), inset 0 0 10px rgba(251,191,36,.3) !important; transition:box-shadow .6s ease, filter .6s ease; filter:saturate(1.2); }
      .adhd-seg.adhd-preview-platino    { box-shadow:0 0 14px rgba(127,244,240,.7), inset 0 0 9px rgba(127,244,240,.28) !important; transition:box-shadow .6s ease, filter .6s ease; filter:saturate(1.15); }
      .adhd-seg.adhd-preview-oro        { box-shadow:0 0 14px rgba(255,215,0,.7), inset 0 0 9px rgba(255,215,0,.28) !important; transition:box-shadow .6s ease, filter .6s ease; filter:saturate(1.15); }
      .adhd-seg.adhd-preview-plata      { box-shadow:0 0 12px rgba(201,209,217,.6), inset 0 0 8px rgba(201,209,217,.25) !important; transition:box-shadow .6s ease, filter .6s ease; filter:saturate(1.05); }
      .adhd-seg.adhd-preview-bronce     { box-shadow:0 0 12px rgba(184,115,51,.6), inset 0 0 8px rgba(184,115,51,.25) !important; transition:box-shadow .6s ease, filter .6s ease; filter:saturate(1.05); }
      /* Madera: vetas irregulares verticales — "feo pero honesto" */
      .adhd-rarity-madera {
        background: repeating-linear-gradient(
          90deg,
          #6d4c41 0px,
          #8d6e63 3px,
          #5d4037 6px,
          #7d5a50 9px,
          #8d6e63 12px
        );
      }
      /* Bronce: metálico cálido con banda de brillo */
      .adhd-rarity-bronce {
        background: linear-gradient(180deg,
          #d4956a 0%, #b87333 25%, #8c5a2b 55%, #b87333 80%, #d4956a 100%);
      }
      /* Plata: metálico frío, reflejo nítido */
      .adhd-rarity-plata {
        background: linear-gradient(180deg,
          #f0f4f8 0%, #c9d1d9 30%, #a8b4c0 65%, #c9d1d9 85%, #f0f4f8 100%);
      }
      /* Oro: cálido con micro-brillo */
      .adhd-rarity-oro {
        background: linear-gradient(180deg,
          #fff8b0 0%, #ffd700 30%, #cc9900 65%, #ffd700 88%, #fff8b0 100%);
      }
      /* Platino: tono hielo, casi blanco, destello puntual */
      .adhd-rarity-platino {
        background: linear-gradient(180deg,
          #e8fffc 0%, #7ff4f0 30%, #4dd0c8 65%, #7ff4f0 88%, #e8fffc 100%);
      }
      /* ===== Feature 1: mini cronómetro ===== */
      .adhd-mini-crono {
        position: fixed; bottom: 12px; left: 12px; z-index: 2000;
        font: 700 14px/1.2 duolingo-sans, "Duolingo Sans", monospace;
        padding: 4px 8px; border-radius: 6px; pointer-events: none;
        background: rgba(0,0,0,.6); color: #fff; white-space: nowrap;
        transition: color .4s ease;
      }

      /* ===== Feature 1: label "⚡ RÁPIDO" al cruzar separador ===== */
      .adhd-fast-label {
        position:absolute; top:-30px; left:50%; transform:translateX(-50%);
        font:700 10px/1 duolingo-sans,"Duolingo Sans",sans-serif;
        color:#fbbf24; white-space:nowrap; z-index:6;
        animation: adhd-fast-in .35s ease-out;
      }
      @keyframes adhd-fast-in { from {opacity:0; transform:translate(-50%, 6px)} to {opacity:1; transform:translate(-50%, 0)} }

      /* ===== 6.4: hitos visuales eliminados — solo tramos (regla .adhd-sep retirada) ===== */

      /* ===== partículas del burst (celebración de hito): 2s, grandes ===== */
      .adhd-part { position:fixed; width:14px; height:14px; border-radius:50%; pointer-events:none; z-index:4000; animation:adhd-burst 2s ease-out forwards; box-shadow:0 0 8px rgba(255,255,255,.6); }
      @keyframes adhd-burst { 0%{transform:translate(0,0) scale(1); opacity:1} 100%{transform:translate(var(--dx),var(--dy)) scale(.3); opacity:0} }

      /* ===== pestaña de ajustes (soldada al borde derecho, sin sombra flotante) ===== */
      .adhd-btn { position:fixed; z-index:2000; right:0; top:96px; background:#fff; border:none; border-radius:12px 0 0 12px; width:44px; height:44px; display:flex; align-items:center; justify-content:center; cursor:pointer; color:#1cb0f6; box-shadow:-2px 0 0 #e5e5e5; transition:width .12s ease, background .12s ease; }
      .adhd-btn:hover { width:50px; background:#ddf4ff; }
      .adhd-btn:active { filter:brightness(.94); }
      .adhd-btn svg { width:22px; height:22px; }

      /* ===== panel config (anclado al borde, jerarquía header/secciones/footer) ===== */
      .adhd-panel { position:fixed; z-index:1000; right:0; top:152px; width:280px; box-sizing:border-box; max-width:calc(100vw - 16px); max-height:calc(100vh - 170px); overflow-y:auto; background:#fff; border-radius:16px 0 0 16px; box-shadow:-2px 0 0 #e5e5e5; padding:16px; font-family:duolingo-sans,"Duolingo Sans",sans-serif; }
      .adhd-head { margin:0 0 10px; }
      .adhd-eyebrow { font-size:10px; font-weight:800; letter-spacing:.12em; color:#1cb0f6; }
      .adhd-panel h4 { margin:2px 0 0; font-size:15px; color:#0a7ec2; } /* #1cb0f6 fallaba WCAG AA (2.9:1); #0a7ec2 = 5.6:1 */
      .adhd-panel label { display:block; font-size:13px; color:#4b4b4b; margin:10px 0 4px; }
      .adhd-panel input[type=range] { width:100%; }
      .adhd-panel .adhd-val { font-weight:700; color:#0a7ec2; }
      /* timer-mode-ux: secciones colapsables + hints */
      .adhd-panel details { margin:10px 0 4px; }
      .adhd-panel summary { cursor:pointer; font-weight:700; font-size:14px; color:#0a7ec2; padding:6px 8px; border-radius:10px; background:rgba(28,176,246,.08); list-style:none; display:flex; align-items:center; gap:6px; user-select:none; }
      .adhd-panel summary::before { content:'▸'; font-size:11px; transition:transform .15s ease; }
      .adhd-panel details[open] summary::before { transform:rotate(90deg); }
      .adhd-panel summary::-webkit-details-marker { display:none; }
      .adhd-sec-ico { width:15px; height:15px; flex:none; }
      .adhd-sec-body { padding:2px 2px 2px 8px; font-size:12px; color:#4b4b4b; }
      .adhd-foot { margin-top:12px; border-top:1px solid #e5e5e5; padding-top:10px; }
      .adhd-panel .adhd-hint { font-size:11px; color:#777; margin:6px 0 2px; line-height:1.35; }
      /* botones del panel: sombra dura 4px estilo Feather (mismo lenguaje que .adhd-btn) */
      .adhd-panel button { display:block; width:100%; margin-top:10px; padding:7px; background:#fff; border:2px solid #e5e5e5; border-radius:12px; font:700 13px duolingo-sans,"Duolingo Sans",sans-serif; color:#4b4b4b; cursor:pointer; box-shadow:0 4px 0 #d3d3d3; transition:transform .1s ease, box-shadow .1s ease; }
      .adhd-panel button:active { transform:translateY(4px); box-shadow:0 0 0 #d3d3d3; }
      .adhd-divider { margin-top:12px; border-top:1px solid #e5e5e5; padding-top:10px; }

      /* =====================================================================
         arena-timer-overhaul: skins por rung (namespace propio, no toca el
         modo posicional .adhd-rarity-*). Valores exactos de UI-PROPOSAL.md.
         ===================================================================== */
      .adhd-rung-madera {
        background: linear-gradient(180deg, #b39184 0%, #8d6e63 55%, #b39184 100%);
      }
      .adhd-rung-bronce {
        background: linear-gradient(180deg, #d29a6b 0%, #8a4f2a 52%, #d29a6b 100%);
        box-shadow: inset 0 2px 0 rgba(255,255,255,.35), inset 0 -3px 0 rgba(0,0,0,.25);
      }
      .adhd-rung-plata {
        background: linear-gradient(180deg, #eaf1f6 0%, #93a3ae 52%, #eaf1f6 100%);
        box-shadow: inset 0 2px 0 rgba(255,255,255,.55), inset 0 -3px 0 rgba(0,0,0,.18);
      }
      .adhd-rung-racha {
        background: linear-gradient(180deg, #ffe066 0%, #ff9600 55%, #e04e00 100%);
        box-shadow: inset 0 2px 0 rgba(255,255,255,.45), inset 0 -3px 0 rgba(0,0,0,.22), 0 0 10px rgba(255,150,0,.55);
        animation: adhd-flicker 900ms ease-in-out infinite;
      }
      .adhd-rung-racha .adhd-ember {
        position:absolute; width:5px; height:5px; border-radius:9999px; background:#fff3c4; opacity:0;
        animation: adhd-ember 900ms ease-out infinite;
      }
      .adhd-rung-diamante {
        background: linear-gradient(135deg, #3fd0cc, #e7ffff, #ffd1f0, #3fd0cc);
        background-size: 300% 100%;
        box-shadow: inset 0 2px 0 rgba(255,255,255,.5), inset 0 -3px 0 rgba(0,0,0,.15), 0 0 8px rgba(63,208,204,.5);
        animation: adhd-legend-bg 4.5s linear infinite; /* tramo-fx-round2: 6s→4.5s, visible a 1m */
      }
      .adhd-rung-diamante .adhd-sparkle {
        position:absolute; width:10px; height:10px; background:#fff; opacity:0;
        clip-path: polygon(50% 0,62% 38%,100% 50%,62% 62%,50% 100%,38% 62%,0 50%,38% 38%);
        animation: adhd-sparkle 2200ms ease-in-out infinite;
      }
      .adhd-rung-super {
        background: linear-gradient(135deg, #8b5cf6, #c084fc, #f0abfc, #8b5cf6);
        background-size: 300% 100%;
        box-shadow: inset 0 2px 0 rgba(255,255,255,.5), inset 0 -3px 0 rgba(0,0,0,.2), 0 0 12px rgba(167,139,250,.8);
        animation: adhd-legend-bg 3s linear infinite;
      }
      .adhd-rung-super .adhd-sparkle {
        position:absolute; width:10px; height:10px; background:#fff; opacity:0;
        clip-path: polygon(50% 0,62% 38%,100% 50%,62% 62%,50% 100%,38% 62%,0 50%,38% 38%);
        animation: adhd-sparkle 2200ms ease-in-out infinite;
      }
      .adhd-rung-perdido {
        background: repeating-linear-gradient(45deg, #afafaf 0 4px, #9a9a9a 4px 8px);
      }

      /* tramo-fx-round2 (D1): loops de vida en peldaños bajos — SOLO tramo activo
         (el registro congelado no parpadea). Reutilizan adhd-sweep2, sin keyframes
         ni nodos nuevos. Opacidades calibradas +50% sobre el design (Mori no veía
         la animación): punto de partida para ajustar con "Probar efectos". */
      .adhd-seg.adhd-active.adhd-rung-madera::before,
      .adhd-seg.adhd-active.adhd-rung-bronce::before,
      .adhd-seg.adhd-active.adhd-rung-plata::before {
        content:''; position:absolute; top:0; bottom:0; width:34%; pointer-events:none;
        background: linear-gradient(105deg, transparent, rgba(255,255,255,.8), transparent);
        animation: adhd-sweep2 var(--sweep-dur,2.6s) cubic-bezier(.4,0,.2,1) infinite;
      }
      .adhd-seg.adhd-active.adhd-rung-madera::before { --sweep-dur:3.8s; opacity:.2; }
      .adhd-seg.adhd-active.adhd-rung-bronce::before { --sweep-dur:2.6s; opacity:.3; }
      .adhd-seg.adhd-active.adhd-rung-plata::before { --sweep-dur:2s; opacity:.45; }

      /* keyframes de la arena (solo transform/opacity/background-position) */
      @keyframes adhd-flicker {
        0%, 100% { filter: brightness(1) saturate(1); transform: scaleY(1); }
        30% { filter: brightness(1.3) saturate(1.25); transform: scaleY(1.05); }
        55% { filter: brightness(.88) saturate(1); transform: scaleY(.97); }
        75% { filter: brightness(1.18) saturate(1.15); transform: scaleY(1.03); }
      }
      @keyframes adhd-ember {
        0% { transform: translate(0, 0) scale(.4); opacity: 0; }
        25% { opacity: 1; }
        100% { transform: translate(var(--dx, 0px), -160%) scale(.9); opacity: 0; }
      }
      @keyframes adhd-sparkle {
        0% { transform: scale(0) rotate(0deg); opacity: 0; }
        35% { transform: scale(1) rotate(45deg); opacity: 1; }
        100% { transform: scale(0) rotate(120deg); opacity: 0; }
      }
      @keyframes adhd-playhead-urgent { 0%,100% { transform: translate(-50%,0) scale(1); } 50% { transform: translate(-50%,0) scale(1.35); } }
      @keyframes adhd-loss-flash { 0% { opacity:.85; } 100% { opacity:0; } }
      @keyframes adhd-blink-hard { 0%,49% { opacity:1; } 50%,100% { opacity:.3; } }

      /* flash de pérdida: overlay remonteado por caída (nunca interrumpe width) */
      .adhd-seg.adhd-blink-hard { animation: adhd-blink-hard 420ms steps(1) infinite; }
      .adhd-loss-flash {
        position:absolute; inset:0; border-radius:9999px; pointer-events:none;
        background:#ff4b4b; animation: adhd-loss-flash 180ms linear forwards;
      }
      .adhd-loss-flash.perdido { animation-duration: 240ms; }

      /* tramo-fx-round2 (D2): capa del peldaño anterior que fadea al degradar.
         Lleva la clase del rung previo → hereda su skin (selectores .adhd-rung-*). */
      .adhd-rung-prev {
        position:absolute; inset:0; border-radius:inherit; pointer-events:none;
        animation: adhd-rung-prev .32s ease-out forwards;
      }
      @keyframes adhd-rung-prev { from { opacity:1; } to { opacity:0; } }

      /* leading edge: borde luminoso pegado al frente del llenado (tramo activo) */
      .adhd-edge {
        position:absolute; top:0; right:0; width:3px; height:100%; border-radius:2px;
        background:#fff; box-shadow:0 0 8px 2px rgba(255,255,255,.85);
      }
      /* sliding shine: SOLO tramo activo, con descanso (off en racha/super) */
      .adhd-shine-wrap { position:absolute; inset:0; overflow:hidden; border-radius:9999px; pointer-events:none; }
      .adhd-shine {
        position:absolute; top:0; bottom:0; width:34%;
        background: linear-gradient(105deg, transparent, rgba(255,255,255,.7), transparent);
        animation: adhd-sweep2 2400ms cubic-bezier(.4,0,.2,1) infinite;
      }
      @keyframes adhd-sweep2 { 0% { transform: translateX(-140%); } 100% { transform: translateX(340%); } }

      /* ===== redesign-decay-timeline: riel continuo de depleción =====
         Ya no son 6 bloques con formas: es UN medidor que se consume de
         izquierda a derecha. La jerarquía se codifica con MATERIAL (el gradiente
         del peldaño proyectado en lo que queda) + ETIQUETA de texto legible.
         Las formas geométricas de 8px se retiraron: son un canal categórico
         ilegible a esa escala (Jerarquía Cleveland-McGill: longitud > color;
         la forma no participa del ranking cuantitativo).
         Alto 20px (--adhd-rail-h) para que la etiqueta entre sin clipping.
         Chrome DURO (0 blur) como el resto del script, sin backdrop-filter. */
      .adhd-decay-timeline {
        position:fixed; z-index:1999; pointer-events:none;
        font-family: duolingo-sans, "Duolingo Sans", sans-serif;
        background:#fff;
        border:2px solid #e5e5e5;
        border-radius:9999px; padding:2px;
        box-shadow:0 2px 0 #e5e5e5;
        --adhd-rail-h: 20px;
      }
      body.adhd-dark .adhd-decay-timeline { background:#1e2a31; border-color:#3a4a52; box-shadow:0 2px 0 #0b1216; }

      /* track: fondo del presupuesto completo; las muescas marcan la escalera */
      .adhd-rail-track {
        position:relative; height:var(--adhd-rail-h); border-radius:9999px;
        background:#eceff1; overflow:hidden;
        pointer-events:auto; cursor:default;
      }
      body.adhd-dark .adhd-rail-track { background:#101a1f; }

      /* muescas de los peldaños: la escalera como REFERENCIA, no como color.
         Se pintan con un gradiente de stops duros desde JS (1px por frontera). */
      .adhd-rail-notches {
        position:absolute; inset:0; pointer-events:none;
        background-image:var(--adhd-notches, none);
        background-repeat:no-repeat;
      }

      /* ganado (izquierda, detrás de la cabeza): peldaño realmente logrado */
      .adhd-rail-earned {
        position:absolute; left:0; top:0; bottom:0; width:0;
        border-radius:9999px 0 0 9999px;
        background:var(--adhd-earned, linear-gradient(180deg,#c9d1d9,#8d6e63));
        transition:width 120ms linear;
      }
      /* restante (derecha): material del peldaño PROYECTADO = a dónde caés */
      .adhd-rail-fill {
        position:absolute; right:0; top:0; bottom:0; width:100%;
        border-radius:0 9999px 9999px 0;
        background:var(--adhd-fill, linear-gradient(180deg,#e9d5ff,#8b5cf6));
        transition:width 120ms linear, background 320ms linear;
      }
      /* filo duro en la frontera ganado/restante (canal "dirección") */
      .adhd-rail-head {
        position:absolute; top:0; bottom:0; width:3px; margin-left:-1.5px;
        background:#fff; box-shadow:0 0 0 1.5px rgba(0,0,0,.55);
        transform:translateX(-50%);
      }
      .adhd-rail-head::after {
        content:''; position:absolute; inset:0; border-radius:2px;
        background:linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,255,255,.9) 50%, rgba(255,255,255,0) 100%);
        background-size:200% 100%;
        animation: adhd-rail-sweep 1400ms linear infinite;
      }
      @keyframes adhd-rail-sweep { 0% { background-position:180% 0; } 100% { background-position:-80% 0; } }
      body.adhd-dark .adhd-rail-head { box-shadow:0 0 0 1.5px rgba(0,0,0,.75); }
      .adhd-rail-head.urgent { background:#ff4b4b; box-shadow:0 0 0 1.5px rgba(120,0,0,.8); }

      /* etiqueta de texto del peldaño proyectado: legible sin hover */
      .adhd-rail-label {
        position:absolute; top:50%; transform:translateY(-50%);
        font-size:10px; font-weight:800; letter-spacing:.04em; line-height:1;
        color:#fff; text-shadow:0 1px 2px rgba(0,0,0,.65);
        pointer-events:none; white-space:nowrap;
        padding:0 5px;
      }
      .adhd-rail-label.side-left  { left:0;  text-align:left; }
      .adhd-rail-label.side-right { right:0; text-align:right; }

      /* ===== cronómetro: Baloo 2 con celdas de ancho fijo (anti-jitter) ===== */
      .adhd-mini-crono {
        font-family: "Baloo 2", "Nunito", ui-rounded, system-ui, sans-serif;
        font-size: 22px; font-weight: 700; line-height: 1;
        font-variant-numeric: tabular-nums; font-feature-settings: "tnum" 1;
        padding: 4px 10px; bottom: 14px;
      }
      .adhd-digit { display:inline-block; width:.66em; text-align:center; }
      .adhd-digit-sep { display:inline-block; width:.34em; text-align:center; opacity:.55; }
      .adhd-mini-crono.urgent { background: rgba(180,30,30,.55); }
      .adhd-mini-crono .adhd-hourglass { font-size: 14px; vertical-align: 2px; margin-right: 2px; }

      /* tramo-fx-round2: CSS de combat text eliminado (ver spec tramo-celebrations) */

      /* ===== partículas de la arena: confetti/shock/riser (cap 44 nodos en JS) =====
         tramo-fx-round2: z 4000→4500 (mismo plano que el texto que Mori SÍ veía;
         la lección no tapa el burst) y doble glow en dots. */
      .adhd-part2 { position:fixed; pointer-events:none; z-index:4500; will-change: transform, opacity; animation: adhd-part2 var(--dur,1100ms) cubic-bezier(.2,.7,.3,1) var(--delay,0ms) forwards; }
      .adhd-part2.dot { border-radius:9999px; box-shadow:0 0 6px 1px rgba(255,255,255,.9), 0 0 16px 5px rgba(255,255,255,.45); }
      .adhd-part2.rect { border-radius:2px; }
      .adhd-part2.shard { clip-path: polygon(50% 0,100% 100%,0 100%); }
      @keyframes adhd-part2 {
        0% { transform: translate(0,0) scale(.25) rotate(0deg); opacity:1; }
        55% { opacity:1; }
        100% { transform: translate(var(--tx), calc(var(--ty) + var(--grav,26px))) scale(.85) rotate(var(--rot,180deg)); opacity:0; }
      }
      .adhd-ring {
        position:fixed; pointer-events:none; z-index:4500; border-radius:9999px;
        border:3px solid var(--c,#fff);
        animation: adhd-ring var(--dur,520ms) cubic-bezier(.16,1,.3,1) var(--delay,0ms) forwards;
      }
      @keyframes adhd-ring { 0% { transform: translate(-50%,-50%) scale(.15); opacity:.95; } 100% { transform: translate(-50%,-50%) scale(1); opacity:0; } }

      /* tramo-fx-round2 (D3): halo de Super — 1 nodo sobre la barra, violeta
         expandiéndose 900ms. La corona se CELEBRA, no se lee en texto. */
      .adhd-halo {
        position:absolute; inset:-6px; border-radius:9999px; pointer-events:none;
        animation: adhd-halo .9s ease-out forwards;
      }
      @keyframes adhd-halo {
        0% { box-shadow:0 0 0 0 rgba(167,139,250,.85); }
        100% { box-shadow:0 0 28px 12px rgba(167,139,250,0); }
      }

      /* ===== reduced-motion: kill switch (la info nunca depende de la animación) ===== */
      @media (prefers-reduced-motion: reduce) {
        .adhd-rung-racha, .adhd-rung-diamante, .adhd-rung-super,
        .adhd-rung-racha .adhd-ember, .adhd-rung-diamante .adhd-sparkle,
        .adhd-rung-super .adhd-sparkle, .adhd-shine, .adhd-loss-flash,
        .adhd-rail-head::after, .adhd-rail-head.urgent, .adhd-part2, .adhd-ring, .adhd-seg.adhd-blink,
        .adhd-fast-label, .adhd-seg.adhd-legendary,
        .adhd-rung-prev, .adhd-halo,
        .adhd-seg.adhd-active.adhd-rung-madera::before,
        .adhd-seg.adhd-active.adhd-rung-bronce::before,
        .adhd-seg.adhd-active.adhd-rung-plata::before {
          animation-duration: 1ms !important; animation-iteration-count: 1 !important; animation-delay: 0ms !important;
        }
        .adhd-part2, .adhd-ring { display:none; }
      }
    `);

    function findBar() {
      // Only the ACTIVE lesson bar, on lesson-like screens.
      // PRIMARY: quit-button container anchor (structural, no geometry).
      // FALLBACK: v2.1 signature (valuemax="1", no _2nasW, top-anchored) —
      // only when the anchor is absent (unexpected layout variation).
      if (!isLessonScreen()) return null;
      const anchored = findLessonBarByAnchor(document);
      if (anchored) return anchored;
      return findBarBySignature(document);
    }

    let lastBarNode = null;
    function ensureRoots() {
      bar = findBar();
      if (!bar) return false;
      // decay-timeline-visibility: si el nodo de la barra cambió (re-render SPA),
      // hay que re-observarlo y reconstruir el timeline sobre la barra nueva.
      if (bar !== lastBarNode) {
        lastBarNode = bar;
        if (decayEl) { buildDecayTimeline(); }
      }
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
        div.className = 'adhd-seg adhd-no-anim'; // no-anim: width base committed sin transición (timer-mode-ux 1.2)
        div.dataset.seg = i;
        div.style.left = segLeft(i, T) + '%';
        div.style.width = '0%'; // base 0 — el primer render() anima desde aquí (invariante: width solo en render())
        // Con timerMode ON: sin clase inicial — el skin del activo lo pone
        // applyProjectedRung (arranca proyectado en el techo, arena-timer-overhaul).
        // Con timerMode OFF: textura posicional (madera→legendario)
        if (!cfg.timerMode) {
          const c = levelColor(i, T);
          if (c === null) {
            div.classList.add('adhd-legendary');
            // shines animadas
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
            div.classList.add('adhd-rarity-' + levelName(i, T));
          }
        }
        overlay.appendChild(div);
      }
      // Quitar no-anim en el próximo frame: la base 0 queda committed y toda
      // asignación de width posterior transiciona (fix animación del 1er avance).
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          overlay.querySelectorAll('.adhd-seg.adhd-no-anim').forEach(s => s.classList.remove('adhd-no-anim'));
        });
      });
      // 6.4 feedback: SIN hitos visuales — la barra es solo tramos. Los cruces
      // (frontera de tramo) se detectan por aritmética en render(), no por DOM.
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

    // Feature 1: mostrar rótulo "⚡ RÁPIDO" junto al separador
    function showFastLabel(xPct, lang) {
      if (!bar || !overlay) return;
      const label = document.createElement('span');
      label.className = 'adhd-fast-label';
      label.textContent = lang === 'en' ? '⚡ FAST' : '⚡ RÁPIDO';
      label.style.left = xPct + '%';
      overlay.appendChild(label);
      fastLabelEls.push(label);
      setTimeout(() => { label.remove(); }, 2500);
    }

    // Feature 1: mini cronómetro visible
    function startMiniCrono() {
      if (miniCronoEl) miniCronoEl.remove();
      miniCronoEl = document.createElement('div');
      miniCronoEl.className = 'adhd-mini-crono';
      miniCronoEl.setAttribute('aria-hidden', 'true');
      document.body.appendChild(miniCronoEl);
      ensureDecayTimeline(); // decay-timeline-visibility: no reconstruye si ya está

      const goalMs = getTimerGoalMs(cfg);
      let lastDigits = '';

      // arena-timer-overhaul: dígitos en celdas 0.66em (anti-jitter con cualquier fuente).
      function renderDigits(remaining) {
        const mins = Math.floor(remaining / 60000);
        const secs = Math.floor((remaining % 60000) / 1000);
        const tenth = Math.floor((remaining % 1000) / 100);
        const str = String(Math.min(99, mins)).padStart(2, '0') + ':' + String(secs).padStart(2, '0') + '.' + tenth;
        if (str === lastDigits) return;
        lastDigits = str;
        miniCronoEl.textContent = '';
        str.split('').forEach(ch => {
          const s = document.createElement('span');
          s.className = (ch === ':' || ch === '.') ? 'adhd-digit-sep' : 'adhd-digit';
          s.textContent = ch;
          miniCronoEl.appendChild(s);
        });
      }

      // arena-timer-overhaul: proyección por TIEMPO PURO quemado (no por ritmo).
      function tick() {
        if (!miniCronoEl || !raceStartTime) return;
        const elapsed = Date.now() - raceStartTime;
        const frac = elapsed / goalMs;
        renderDigits(Math.max(0, goalMs - elapsed));

        const projected = rungAt(currentBands(), frac);
        const R = projected === -1 ? LOST : RUNGS[projected];
        miniCronoEl.style.color = R.to;

        // Urgencia >80%: blink hard + ⌛ (nunca sólo color)
        const urgent = frac > 0.8 && frac < 1;
        miniCronoEl.classList.toggle('urgent', urgent);
        if (urgent && !miniCronoEl.querySelector('.adhd-hourglass')) {
          const hg = document.createElement('span');
          hg.className = 'adhd-hourglass';
          hg.textContent = '⌛';
          miniCronoEl.insertBefore(hg, miniCronoEl.firstChild);
        } else if (!urgent) {
          const hg = miniCronoEl.querySelector('.adhd-hourglass');
          if (hg) hg.remove();
        }

        updateDecayTimeline(frac);
        // decay-timeline-visibility: red de seguridad a 100ms para layout shifts
        // que no disparan scroll/resize/mutación (p.ej. transform en el header).
        if (decayEl && timelineNeedsReanchor()) positionDecayTimeline();

        // El color del llenado del tramo activo ES el rung proyectado (spec arena F3·V2).
        if (overlay && lastPct > 0 && lastPct < 100) {
          const T = segmentCount(cfg.separators);
          const curIdx = currentSeg(lastPct, T);
          const segEl = overlay.querySelector('.adhd-seg[data-seg="' + curIdx + '"]');
          if (segEl) {
            applyProjectedRung(segEl, projected, frac);
          }
        }
      }

      tick();
      miniCronoInterval = setInterval(tick, 100); // décimas: el cronómetro "corre" (celdas evitan jitter)
    }

    // decay-timeline-visibility (D4): el cronómetro y el visualizador tienen
    // ciclos de vida separados. stopMiniCrono() SOLO para el cronómetro; el
    // timeline solo muere en teardownTimerFx() (fin de vida real). Antes,
    // reiniciar el cronómetro en cada cruce borraba y recreaba el timeline.
    function stopMiniCrono() {
      if (miniCronoInterval) { clearInterval(miniCronoInterval); miniCronoInterval = null; }
      if (miniCronoEl) { miniCronoEl.remove(); miniCronoEl = null; }
    }

    // Cruce de tramo: nuevo cronómetro, MISMO timeline (ensure re-anccla).
    function restartRace(now) {
      raceStartTime = now;
      lastProjectedRung = null;
      stopMiniCrono();
      startMiniCrono();
    }

    // 6.4 feedback: TODO lo anclado a <body> (crono, timeline, labels) muere con la
    // barra. Si no, queda flotando sobre la pantalla de celebración / próxima vista.
    // decay-timeline-visibility (D4): acá SÍ se borra el timeline (fin de vida real:
    // pantalla perdida, SPA fuera de lección, timer OFF).
    function teardownTimerFx() {
      raceStartTime = 0;
      lastProjectedRung = null;
      stopMiniCrono();
      removeDecayTimeline();
      clearFastLabels();
    }

    function clearFastLabels() {
      fastLabelEls.forEach(el => el.remove());
      fastLabelEls = [];
    }

    // =====================================================================
    // arena-timer-overhaul: timeline de decaimiento + partículas + combat text
    // =====================================================================

    // Geometría del riel. GAP = aire entre barra y riel. H = alto total del
    // chrome (20px riel + 2px padding*2 + 2px borde*2); fallback si el
    // elemento todavía no se midió. Espejo de --adhd-rail-h en el CSS.
    const ADHD_TIMELINE_GAP = 8;
    const ADHD_TIMELINE_H  = 28;

    function currentBands() { return bandsFor((cfg.timerHardness || 0) / 100); }

    // Rótulo localizado del peldaño para la etiqueta del riel. -1 = Perdido.
    const RAIL_LABEL_KEYS = ['railMadera','railBronce','railPlata','railRacha','railDiamante','railSuper'];
    function railLabelFor(rung) {
      return rung === -1 ? tr(cfg.lang, 'railPerdido') : tr(cfg.lang, RAIL_LABEL_KEYS[rung]);
    }

    // redesign-decay-timeline: RIEL CONTINUO. El presupuesto se consume de
    // izquierda a derecha como un medidor; la escalera de peldaños queda como
    // referencia en las muescas, y la jerarquía se lee en el MATERIAL del fill
    // (peldaño proyectado) + la ETIQUETA de texto. Ya no hay formas geometricas.
    //
    // decay-timeline-visibility (D1): el riel es PERSISTENTE. Se construye una
    // vez por carrera (ensureDecayTimeline) y sobrevive a los cambios de tramo.
    function buildDecayTimeline() {
      removeDecayTimeline();
      const bands = currentBands();
      const goalMs = getTimerGoalMs(cfg);
      decayEl = document.createElement('div');
      decayEl.className = 'adhd-decay-timeline';
      decayEl.setAttribute('aria-hidden', 'true');
      // Firma de las bandas con las que se construyo: si cambia la dureza,
      // ensureDecayTimeline() sabe que debe reconstruir.
      decayEl.dataset.bands = bands.map(b => b.toFixed(4)).join(',');
      decayEl.dataset.goal = String(goalMs);

      const track = document.createElement('div');
      track.className = 'adhd-rail-track';

      // El earned (ganado) y el fill (restante) crecen desde extremos opuestos
      // y se encuentran en la cabeza: el borde entre ambos es el "ahora".
      const earned = document.createElement('div');
      earned.className = 'adhd-rail-earned';
      const notches = document.createElement('div');
      notches.className = 'adhd-rail-notches';
      const fill = document.createElement('div');
      fill.className = 'adhd-rail-fill';
      const head = document.createElement('div');
      head.className = 'adhd-rail-head';
      const label = document.createElement('span');
      label.className = 'adhd-rail-label';

      track.appendChild(earned);
      track.appendChild(fill);
      track.appendChild(notches);
      track.appendChild(head);
      track.appendChild(label);
      decayEl.appendChild(track);

      // Tooltip: la escalera completa con segundos (referencia de dureza).
      const edges = bandEdges(bands);
      track.title = edges.map((e, i) => RUNGS[i].glyph + ' ' + RUNGS[i].label + ' ' +
        Math.round(e * goalMs / 1000) + 's').join('  \u00b7  ');

      // Muescas: un stop duro por frontera de peldaño (la escalera como referencia).
      const notchStops = [];
      edges.forEach((e, i) => {
        if (i === 0) return; // el borde izquierdo es el piso de la escalera
        const pct = (e * 100).toFixed(3) + '%';
        // transparente justo antes -> salto duro -> 1px de muesca -> transparente
        notchStops.push('rgba(255,255,255,0) ' + pct);
        notchStops.push('rgba(0,0,0,.30) ' + pct, 'rgba(0,0,0,.30) calc(' + pct + ' + 1px)');
        notchStops.push('rgba(255,255,255,0) calc(' + pct + ' + 1px)');
      });
      decayEl.style.setProperty('--adhd-notches',
        notchStops.length ? 'linear-gradient(90deg,' + notchStops.join(',') + ')' : 'none');

      document.body.appendChild(decayEl);
      attachTimelineSync();
      positionDecayTimeline();
      updateDecayTimeline(0);
    }

    // decay-timeline-visibility (D1): crea el timeline solo si falta, si su firma
    // de bandas quedó vieja (dureza cambió) o si perdió el nodo de la barra.
    // El chequeo `!bar.isConnected` cubre el re-render SPA: el nodo viejo queda
    // desconectado aunque la variable `bar` (cacheada) aún lo apunte.
    function ensureDecayTimeline() {
      const bands = currentBands();
      const sig = bands.map(b => b.toFixed(4)).join(',');
      if (decayEl && decayEl.isConnected && decayEl.dataset.bands === sig && bar && bar.isConnected) {
        positionDecayTimeline();
        return;
      }
      buildDecayTimeline();
    }

    // decay-timeline-visibility (D2): con flip. Arriba si hay espacio; debajo si
    // no (barra cerca del borde superior). Cuando la barra se sale del viewport
    // (scroll largo) el timeline la sigue: se va con ella, no se queda pegado
    // a un borde arbitrario. Nunca escribe top negativo cuando la barra está
    // visible en la parte superior del viewport.
    // decay-timeline-visibility (D2): posición cacheada del timeline. Si el rect
    // de la barra se movió (layout shift, transform del header, scroll interno
    // de un contenedor) y ningún listener nos avisó, el propio re-escaneo en
    // render()/tick() lo detecta y re-ancla.
    let lastTlAnchor = { left: -1, top: -1, width: -1 };

    function positionDecayTimeline() {
      if (!decayEl || !bar) return;
      const r = bar.getBoundingClientRect();
      const h = decayEl.offsetHeight || ADHD_TIMELINE_H; // medido > constante
      const above = r.top - h - ADHD_TIMELINE_GAP;
      const below = r.bottom + ADHD_TIMELINE_GAP;
      const fitsAbove = above >= 0;
      const top = fitsAbove ? above : below;
      decayEl.style.left = r.left + 'px';
      decayEl.style.width = r.width + 'px';
      decayEl.style.top = top + 'px';
      decayEl.classList.toggle('below', !fitsAbove);
      lastTlAnchor = { left: Math.round(r.left), top: Math.round(top), width: Math.round(r.width) };
    }

    // ¿La barra se movió desde el último anclaje? (bar_left/bar_top/width)
    function timelineNeedsReanchor() {
      if (!decayEl || !bar) return false;
      const r = bar.getBoundingClientRect();
      return Math.round(r.left) !== lastTlAnchor.left ||
             Math.round(r.top) !== lastTlAnchor.top ||
             Math.round(r.width) !== lastTlAnchor.width;
    }

    function removeDecayTimeline() {
      if (decayEl) { decayEl.remove(); decayEl = null; }
      lastTlAnchor = { left: -1, top: -1, width: -1 };
      detachTimelineSync();
    }

    // decay-timeline-visibility (D2): re-anclar cuando el layout mueve la barra.
    // El observer global sigue siendo la red de seguridad (por si el nodo de
    // la barra se reemplaza sin cambio de tamaño); estos listeners cubren
    // scroll/resize/visualViewport sin depender de mutaciones del DOM.
    let timelineSyncAttached = false;
    let timelineBarObserver = null;
    function attachTimelineSync() {
      if (timelineSyncAttached) {
        if (bar && timelineBarObserver && timelineBarObserver.target !== bar) {
          timelineBarObserver.disconnect();
          timelineBarObserver.observe(bar);
        }
        return;
      }
      timelineSyncAttached = true;
      window.addEventListener('scroll', positionDecayTimeline, { passive: true, capture: true });
      window.addEventListener('resize', positionDecayTimeline, { passive: true });
      if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', positionDecayTimeline, { passive: true });
        window.visualViewport.addEventListener('scroll', positionDecayTimeline, { passive: true });
      }
      if (bar && typeof ResizeObserver === 'function') {
        timelineBarObserver = new ResizeObserver(positionDecayTimeline);
        timelineBarObserver.observe(bar);
      }
    }

    function detachTimelineSync() {
      if (!timelineSyncAttached) return;
      timelineSyncAttached = false;
      window.removeEventListener('scroll', positionDecayTimeline, { capture: true });
      window.removeEventListener('resize', positionDecayTimeline);
      if (window.visualViewport) {
        window.visualViewport.removeEventListener('resize', positionDecayTimeline);
        window.visualViewport.removeEventListener('scroll', positionDecayTimeline);
      }
      if (timelineBarObserver) { timelineBarObserver.disconnect(); timelineBarObserver = null; }
    }

    // redesign-decay-timeline: riel continuo. frac = presupuesto quemado.
    // - el fill RESTANTE se encoge desde la derecha y lleva el material del
    //   peldaño PROYECTADO (a donde caes si seguis asi);
    // - el earned GANADO crece desde la izquierda con el peldaño LOGRADO;
    // - la cabeza marca la frontera con un filo duro + sweep (direccion);
    // - la etiqueta dice el peldaño proyectado en texto legible (no formas).
    function updateDecayTimeline(frac) {
      if (!decayEl) return;
      const bands = currentBands();
      const projected = rungAt(bands, frac);
      const lost = projected === -1;
      const pct = Math.max(0, Math.min(1, frac));

      const fill = decayEl.querySelector('.adhd-rail-fill');
      const earned = decayEl.querySelector('.adhd-rail-earned');
      const head = decayEl.querySelector('.adhd-rail-head');
      const label = decayEl.querySelector('.adhd-rail-label');

      if (fill) {
        fill.style.width = ((1 - pct) * 100) + '%';
        // Material del peldaño proyectado = el estado, no decoracion.
        const R = lost ? LOST : RUNGS[projected];
        fill.style.setProperty('--adhd-fill',
          'linear-gradient(180deg,' + R.to + ' 0%,' + R.from + ' 100%)');
        fill.style.opacity = lost ? '.55' : '1';
      }

      if (earned) {
        // Lo ganado se dibuja hasta la cabeza. En timer mode el rung ya
        // congelado del tramo en curso solo existe tras cerrarlo, asi que
        // hasta entonces queda neutro (el earned es "presupuesto ya quemado").
        earned.style.width = (pct * 100) + '%';
        const done = currentSegRungEarned();
        const RE = done === null ? null : (done === -1 ? LOST : RUNGS[done]);
        earned.style.setProperty('--adhd-earned', RE
          ? 'linear-gradient(180deg,' + RE.to + ' 0%,' + RE.from + ' 100%)'
          : 'linear-gradient(180deg,#e4e7e9 0%,#b8bfc4 100%)');
      }

      if (head) {
        head.style.left = (pct * 100) + '%';
        head.classList.toggle('urgent', !lost && frac > 0.8);
      }

      if (label) {
        const text = railLabelFor(projected);
        if (label.textContent !== text) label.textContent = text;
        // La etiqueta se ancla al lado del riel que tiene aire: antes de la
        // mitad, el aire esta a la derecha (el fill Full-ish); despues, a la
        // izquierda (sobre el tramo ya quemado). Asi nunca queda encima de la
        // cabeza ni cortada.
        const airRight = (1 - pct) >= pct;
        label.classList.toggle('side-right', airRight);
        label.classList.toggle('side-left', !airRight);
      }

      if (decayEl) {
        const R = lost ? LOST : RUNGS[projected];
        decayEl.dataset.rung = String(projected);
        decayEl.title = R.glyph + ' ' + R.label + ' \u00b7 ' + Math.round(pct * 100) + '% quemado';
      }
    }

    // Rung ya cerrado en ESTE tramo (para pintar el earned con su material).
    // Devuelve null si la carrera sigue abierta (no hay rung ganado todavia).
    function currentSegRungEarned() {
      if (raceStartTime <= 0) return null;
      const pct = lastPct;
      if (pct <= 0 || pct >= 100) return null;
      const T = segmentCount(cfg.separators);
      const idx = currentSeg(pct, T);
      const closed = completedRarities[idx];
      return closed === undefined ? null : closed;
    }

    // Partículas escaladas por rung (cap global 44 nodos).
    // tramo-fx-round2 (D3): dur mínima 1100ms — el burst viejo (5-8px, 600-900ms)
    // disparaba pero estaba por debajo del umbral de percepción a 1m de pantalla.
    function spawnPart(x, y, opts) {
      if (activeParts >= 44) return; // presupuesto duro del brief
      const p = document.createElement('div');
      p.className = 'adhd-part2 ' + (opts.shape || 'dot');
      p.style.background = opts.color;
      p.style.left = x + 'px';
      p.style.top = y + 'px';
      if (opts.size) { p.style.width = opts.size + 'px'; p.style.height = (opts.rect ? opts.size * 1.8 : opts.size) + 'px'; }
      p.style.setProperty('--tx', opts.tx + 'px');
      p.style.setProperty('--ty', opts.ty + 'px');
      p.style.setProperty('--grav', (opts.grav != null ? opts.grav : 26) + 'px');
      p.style.setProperty('--rot', (opts.rot || 0) + 'deg');
      p.style.setProperty('--dur', (opts.dur || 1100) + 'ms');
      p.style.setProperty('--delay', (opts.delay || 0) + 'ms');
      document.body.appendChild(p);
      activeParts++;
      setTimeout(() => { p.remove(); activeParts = Math.max(0, activeParts - 1); }, (opts.delay || 0) + (opts.dur || 1100) + 80);
    }

    function spawnRing(x, y, size, color, delay) {
      if (activeParts >= 42) return; // deja 2 slots de margen
      const ring = document.createElement('div');
      ring.className = 'adhd-ring';
      ring.style.left = x + 'px';
      ring.style.top = y + 'px';
      ring.style.width = size + 'px';
      ring.style.height = size + 'px';
      ring.style.setProperty('--c', color);
      ring.style.setProperty('--dur', '520ms');
      ring.style.setProperty('--delay', (delay || 0) + 'ms');
      document.body.appendChild(ring);
      activeParts++;
      setTimeout(() => { ring.remove(); activeParts = Math.max(0, activeParts - 1); }, (delay || 0) + 600);
    }

    function burstRung(rung, xPct, big) {
      if (!bar || REDUCED_MOTION || rung === -1) return;
      const r = bar.getBoundingClientRect();
      const x = r.left + r.width * (xPct / 100);
      const y = r.top + r.height / 2;
      const R = RUNGS[rung];
      const palette = big ? ['#ffd700', '#ff4b8f', '#ffc800', '#ffffff', '#ce82ff'] : [R.from, R.to, '#ffffff'];
      const rnd = (a, b) => a + Math.random() * (b - a);

      // tramo-fx-round2 (D3, spec tramo-celebrations): la magnitud codifica el
      // logro — 6→44 piezas. Super SIEMPRE doble oleada (big o cierre normal).
      if (big || rung === 5) {
        // Super / final de lección: doble oleada de 44 (arena F4·V1)
        [0, 140].forEach((wave, w) => {
          const n = w === 0 ? 24 : 20;
          for (let i = 0; i < n; i++) {
            const a = (i / n) * Math.PI * 2 + rnd(-.25, .25);
            const dist = rnd(46, 86) * 1.25;
            spawnPart(x, y, {
              shape: i % 5 < 3 ? 'dot' : 'rect',
              size: i % 5 < 3 ? 10 : 7, rect: true,
              color: palette[i % palette.length],
              tx: Math.cos(a) * dist, ty: Math.sin(a) * dist * .75,
              rot: i % 5 < 3 ? 0 : rnd(-540, 540),
              delay: wave + rnd(0, 40), dur: 1400,
            });
          }
        });
        return;
      }

      if (rung === 0) {
        // Madera: 6 dots riser sobrio
        for (let i = 0; i < 6; i++) {
          spawnPart(x + (i - 2.5) * 12, y, {
            shape: 'dot', size: 10, color: palette[i % palette.length],
            tx: 0, ty: -rnd(52, 74), grav: 0, delay: i * 60, dur: 1100,
          });
        }
        return;
      }

      if (rung === 1) {
        // Bronce: 8 riser (6 dots + 2 rects girando)
        for (let i = 0; i < 8; i++) {
          const isRect = i >= 6;
          spawnPart(x + (i - 3.5) * 11, y, {
            shape: isRect ? 'rect' : 'dot', size: isRect ? 7 : 10, rect: isRect,
            color: palette[i % palette.length],
            tx: rnd(-12, 12), ty: -rnd(52, 78), grav: 0, rot: isRect ? rnd(-200, 200) : 0,
            delay: i * 55, dur: 1100,
          });
        }
        return;
      }

      if (rung === 2) {
        // Plata: 14 piezas + shockwave (metal frío)
        spawnRing(x, y, 96, R.to, 0);
        spawnRing(x, y, 66, R.from, 120);
        for (let i = 0; i < 14; i++) {
          const a = (i / 14) * Math.PI * 2 + rnd(-.2, .2);
          const dist = rnd(50, 82);
          spawnPart(x, y, {
            shape: i % 3 === 2 ? 'shard' : 'dot', size: i % 3 === 2 ? 12 : 10, rect: i % 3 === 2,
            color: i % 2 ? R.from : R.to,
            tx: Math.cos(a) * dist, ty: Math.sin(a) * dist * .75,
            rot: i % 3 === 2 ? (a * 180 / Math.PI) + 90 : 0, grav: 0,
            delay: i * 20, dur: 1100,
          });
        }
        return;
      }

      if (rung === 3) {
        // Racha: 18 confetti cálido
        for (let i = 0; i < 18; i++) {
          const a = (i / 18) * Math.PI * 2 + rnd(-.25, .25);
          const dist = rnd(48, 88);
          spawnPart(x, y, {
            shape: i % 5 < 3 ? 'dot' : 'rect',
            size: i % 5 < 3 ? 10 : 7, rect: true,
            color: palette[i % palette.length],
            tx: Math.cos(a) * dist, ty: Math.sin(a) * dist * .75,
            rot: i % 5 < 3 ? 0 : rnd(-540, 540),
            delay: rnd(0, 60), dur: 1200,
          });
        }
        return;
      }

      // Diamante: 26 piezas prisma + doble anillo
      spawnRing(x, y, 96, R.to, 0);
      spawnRing(x, y, 66, R.from, 120);
      for (let i = 0; i < 26; i++) {
        const a = (i / 26) * Math.PI * 2 + rnd(-.15, .15);
        const dist = rnd(52, 92);
        spawnPart(x, y, {
          shape: i % 2 ? 'shard' : 'dot', size: i % 2 ? 12 : 10, rect: i % 2 === 1,
          color: i % 3 === 0 ? '#ffffff' : (i % 2 ? R.from : R.to),
          tx: Math.cos(a) * dist, ty: Math.sin(a) * dist * .75,
          rot: i % 2 ? (a * 180 / Math.PI) + 90 + rnd(-30, 30) : 0, grav: 0,
          delay: i * 16, dur: 1200,
        });
      }
    }

    // tramo-fx-round2: combat text eliminado (feedback 6.4/R2 — quedaba encima
    // del UI de Duolingo). La jerarquía se celebra con partículas + skins.

    // tramo-fx-round2 (D3): halo de Super al cerrar — 1 nodo, cuenta en el
    // presupuesto de partículas (cap 44), auto-remove a 950ms.
    function fireHalo() {
      if (!overlay || REDUCED_MOTION || activeParts >= 44) return;
      const h = document.createElement('span');
      h.className = 'adhd-halo';
      h.setAttribute('aria-hidden', 'true');
      overlay.appendChild(h);
      activeParts++;
      setTimeout(() => { h.remove(); activeParts = Math.max(0, activeParts - 1); }, 950);
    }

    // Skin del tramo activo = rung proyectado. Caída de peldaño → flash de pérdida.
    const RUNG_CLASSES = RUNGS.map(r => 'adhd-rung-' + r.id).concat(['adhd-rung-perdido']);

    // tramo-fx-round2 (D2): CSS no interpola background-image — al cambiar de
    // peldaño, el skin ANTERIOR vive 320ms encima y fadea (degradado real, no
    // swap instantáneo). Máx 1 vivo, mismo patrón idempotente del flash.
    function crossFadeRung(segEl, prevCls) {
      if (segEl.querySelector('.adhd-rung-prev')) return;
      const s = document.createElement('span');
      s.className = 'adhd-rung-prev ' + prevCls;
      s.setAttribute('aria-hidden', 'true');
      segEl.appendChild(s);
      setTimeout(() => s.remove(), 340);
    }

    function applyProjectedRung(segEl, projected, frac) {
      const cls = rungClass(projected);
      if (cls && !segEl.classList.contains(cls)) {
        const prevCls = lastProjectedRung !== null ? rungClass(lastProjectedRung) : null;
        segEl.classList.remove('adhd-rarity-verde', 'adhd-blink', ...RUNG_CLASSES);
        segEl.classList.add(cls);
        if (prevCls && prevCls !== cls) crossFadeRung(segEl, prevCls);
        if (lastProjectedRung !== null && projected < lastProjectedRung) {
          flashLoss(segEl, projected === -1);
        }
        lastProjectedRung = projected;
        // 6.4 feedback: las decoraciones vivas (embers/sparkles) también viven en el
        // tramo ACTIVO, no solo en el congelado — si no, el tramo que más tiempo se
        // ve es el más quieto. Se refrescan por peldaño en cada cambio de clase.
        segEl.querySelectorAll('.adhd-rung-deco').forEach(d => d.remove());
        addRungDecorations(segEl, projected);
      }
      // Urgencia por presupuesto quemado (no por avance visual): frac > 0.8
      segEl.classList.toggle('adhd-blink-hard', frac > 0.8 && frac < 1);
    }

    function flashLoss(segEl, isPerdido) {
      if (segEl.querySelector('.adhd-loss-flash')) return; // máx 1 flash vivo
      const f = document.createElement('span');
      f.className = 'adhd-loss-flash' + (isPerdido ? ' perdido' : '');
      f.setAttribute('aria-hidden', 'true');
      segEl.appendChild(f);
      setTimeout(() => f.remove(), isPerdido ? 300 : 220);
    }

    // Decoraciones vivas del rung congelado: ascuas (racha) y destellos (diamante/super).
    function addRungDecorations(segEl, rung) {
      if (segEl.querySelector('.adhd-rung-deco')) return; // idempotente
      if (rung === 3) {
        [0, 1, 2].forEach(k => {
          const e = document.createElement('i');
          e.className = 'adhd-ember adhd-rung-deco';
          e.style.left = (18 + k * 28) + '%';
          e.style.top = '72%';
          e.style.animationDelay = (k * 300) + 'ms';
          e.style.setProperty('--dx', ((k - 1) * 4) + 'px');
          e.setAttribute('aria-hidden', 'true');
          segEl.appendChild(e);
        });
      } else if (rung === 4 || rung === 5) {
        [0, 0.7, 1.4].forEach((d, k) => {
          const s = document.createElement('i');
          s.className = 'adhd-sparkle adhd-rung-deco';
          s.style.left = (14 + k * 32) + '%';
          s.style.top = '50%';
          s.style.animationDelay = (d * 1000) + 'ms';
          s.setAttribute('aria-hidden', 'true');
          segEl.appendChild(s);
        });
      }
    }

    // Efectos del tramo ACTIVO: leading edge siempre; sliding shine salvo racha/super.
    function ensureActiveFx(segEl, projected) {
      // leading edge: sólo si hay llenado visible y no existe
      if (!segEl.querySelector('.adhd-edge')) {
        const edge = document.createElement('span');
        edge.className = 'adhd-edge';
        edge.setAttribute('aria-hidden', 'true');
        segEl.appendChild(edge);
      }
      const edge = segEl.querySelector('.adhd-edge');
      if (edge) edge.style.opacity = (parseFloat(segEl.style.width) > 1) ? '1' : '0';

      // sliding shine: SOLO tramo activo, off en racha/super (compite con flicker/gradiente)
      const wantShine = projected !== 3 && projected !== 5 && projected !== -1;
      if (wantShine && !segEl.querySelector('.adhd-shine-wrap')) {
        const wrap = document.createElement('span');
        wrap.className = 'adhd-shine-wrap';
        wrap.setAttribute('aria-hidden', 'true');
        const s = document.createElement('i');
        s.className = 'adhd-shine';
        wrap.appendChild(s);
        segEl.appendChild(wrap);
      } else if (!wantShine) {
        const wrap = segEl.querySelector('.adhd-shine-wrap');
        if (wrap) wrap.remove();
      }
    }

    function clearActiveFx(segEl) {
      const edge = segEl.querySelector('.adhd-edge');
      if (edge) edge.remove();
      const wrap = segEl.querySelector('.adhd-shine-wrap');
      if (wrap) wrap.remove();
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

    // decay-timeline-visibility (D5): render() era un bloque de ~215 líneas que
    // mezclaba progreso, estado de lección, segmentos, cruces, timer y final.
    // Se partió en helpers con nombre; el ORDEN de los efectos se conserva
    // literal para no cambiar comportamiento.
    function render() {
      if (!bar || !overlay) return;
      const w = bar.getBoundingClientRect().width;
      if (w <= 0) return;
      const { value, max } = getProgress();
      const pct = Math.max(0, Math.min(100, (value / max) * 100));
      lastWidth = w; lastValue = value; lastPct = pct;

      const T = segmentCount(cfg.separators);
      const curIdx = currentSeg(pct, T);

      // ========== Reset al empezar lección nueva (ANTES del loop) ==========
      // Si hay rarezas de lección anterior y el progreso está al inicio,
      // reconstruir el overlay para resetear las clases a verde/posición.
      if ((completedRarities.length > 0 || finalBurstDone) && pct < 2) {
        finalBurstDone = false;
        lastHitCount = 0;
        teardownTimerFx(); // incluye raceStartTime=0 + último rung + fin de carrera
        completedRarities = [];
        buildOverlayContent(); // ← reconstruye tramos con clases iniciales
      }

      renderSegments(pct, T, curIdx);

      // ========== Detección de cruces (sin DOM de hitos: pura aritmética) ==========
      // Un "cruce" es la frontera entre tramos: pct alcanzó sepPos(i).
      let hits = 0;
      for (let i = 1; i <= cfg.separators; i++) {
        if (pct + 1e-9 >= sepPos(i, cfg.separators)) hits++;
      }

      // ========== Feature 1: timer por separador + evolución ==========
      // Iniciar cronómetro al detectar primer progreso
      if (cfg.timerMode && raceStartTime === 0 && pct > 0 && pct < 100) {
        raceStartTime = Date.now();
        startMiniCrono();
      }

      processCrossings(hits, pct);
      lastHitCount = hits;

      // ========== Mini cronómetro: proyección por tiempo puro (ya no por ritmo) ==========
      // (el color y la urgencia los maneja tick() a 100ms; acá solo reposicionar el timeline)
      // decay-timeline-visibility: re-ancla solo si la barra se movió de rect
      // (si no, evita escribir estilos en cada render).
      if (cfg.timerMode && decayEl && timelineNeedsReanchor()) positionDecayTimeline();

      completeLessonIfDone(pct, hits, T);
    }

    // Anchos/opacidad/clases de cada segmento (posicional OFF / bandas ON).
    function renderSegments(pct, T, curIdx) {
      const segLen = segLength(T);
      overlay.querySelectorAll('.adhd-seg').forEach(seg => {
        const i = parseInt(seg.dataset.seg, 10);
        const segDone = segProgress(pct, i, T);
        seg.style.width = segDone + '%';
        // tramo-fx-round2: el tramo corriente lleva .adhd-active — los loops de
        // vida (D1) y los sweeps viven SOLO acá; el registro congelado no parpadea.
        seg.classList.toggle('adhd-active', i === curIdx);

        // Tramo legendario (último, sin timer) mantiene su animación
        if (seg.classList.contains('adhd-legendary')) {
          // Nada que hacer, el CSS anima solo
          return;
        }

        // Con timerMode OFF: comportamiento posicional original
        if (!cfg.timerMode) {
          seg.style.boxShadow = i < curIdx ? '0 0 6px rgba(255,255,255,.35)' : 'none';
          if (i === curIdx) {
            const done = Math.min(1, segDone / segLen);
            seg.style.opacity = String(0.25 + 0.75 * done);
          } else {
            seg.style.opacity = '1';
          }
          return;
        }

        // Con timerMode ON: decaimiento por bandas (arena-timer-overhaul)
        const rarity = completedRarities[i];

        if (rarity !== undefined) {
          // Tramo cerrado: congela el rung ganado (la barra es un registro).
          // Swap quirúrgico — nunca className full-replace (timer-mode-ux 1.1)
          const frozenCls = rungClass(rarity);
          if (!seg.classList.contains(frozenCls)) {
            seg.classList.remove('adhd-blink', 'adhd-blink-hard', 'adhd-rarity-verde', ...RUNG_CLASSES);
            seg.classList.add(frozenCls);
            addRungDecorations(seg, rarity);
          }
          seg.style.opacity = '1';
          seg.style.boxShadow = '0 0 6px rgba(255,255,255,.35)';
        } else if (i === curIdx) {
          // Tramo activo: el color del llenado ES el rung proyectado (tick lo actualiza
          // a 100ms; acá lo aplicamos también para que el primer frame no quede vacío).
          const done = segDone / segLen;
          if (raceStartTime > 0) {
            const frac = (Date.now() - raceStartTime) / getTimerGoalMs(cfg);
            const projected = rungAt(currentBands(), frac);
            applyProjectedRung(seg, projected, frac);
            ensureActiveFx(seg, projected);
          } else {
            seg.classList.remove('adhd-blink', 'adhd-blink-hard');
            seg.style.opacity = String(0.6 + 0.4 * done);
          }
          seg.style.boxShadow = 'none';
        } else {
          // Tramo futuro (no alcanzado): tenue
          seg.style.opacity = '0.4';
          seg.style.boxShadow = 'none';
          seg.classList.remove('adhd-blink', 'adhd-blink-hard');
        }
      });
    }

    // Cruces de separador: evalúa cada carrera cerrada (rung, burst, diario,
    // label ⚡) y arranca la siguiente carrera. Un cruce = una frontera de tramo.
    function processCrossings(hits, pct) {
      if (hits > lastHitCount && cfg.timerMode) {
        const now = Date.now();
        const goalMs = getTimerGoalMs(cfg);

        for (let h = lastHitCount; h < hits; h++) {
          const tramoIdx = h;
          const xAt = sepPos(h + 1, cfg.separators);

          if (raceStartTime > 0) {
            const raceMs = now - raceStartTime;
            raceTimes.push(raceMs);
            if (raceTimes.length > 500) raceTimes = raceTimes.slice(-500);
            saveTimes(raceTimes);

            // Evaluar velocidad → rung final del tramo (arena-timer-overhaul: bandas + dureza)
            const result = evaluateRace(raceMs, goalMs, (cfg.timerHardness || 0) / 100);
            if (result) {
              // Guardar rung final (número; -1 = perdido; 0 = madera — ¡no es falsy check!)
              completedRarities[tramoIdx] = result.rung;

              // Congelar el tramo con el skin del rung ganado (registro).
              const segEl = overlay.querySelector(`.adhd-seg[data-seg="${tramoIdx}"]`);
              if (segEl) {
                const frozenCls = rungClass(result.rung);
                segEl.classList.remove('adhd-active', 'adhd-blink', 'adhd-blink-hard', 'adhd-rarity-verde', ...RUNG_CLASSES);
                segEl.classList.add(frozenCls);
                segEl.style.opacity = '1';
                clearActiveFx(segEl);
                addRungDecorations(segEl, result.rung);
                if (result.lost) flashLoss(segEl, true);
              }

              // Partículas escaladas (perdido: sin burst — trama + flash hablan solos)
              if (!result.lost) {
                const stagger = (h - lastHitCount) * 250;
                setTimeout(() => burstRung(result.rung, xAt, false), stagger);
                if (result.rung === 5) setTimeout(fireHalo, stagger); // corona con halo
              }

              // Feature 3: registrar en diario
              if (cfg.journalEnabled) {
                recordRaceTime(raceMs);
                recordSeparators(1);
              }

              // "⚡ RÁPIDO" si quedó diamante/super (rung >= 4)
              if (result.isFast && cfg.timerShowLabel) {
                showFastLabel(xAt, cfg.lang);
              }
            }

            // Siguiente carrera: el nuevo tramo arranca proyectado en el TECHO.
            // decay-timeline-visibility: el timeline PERSISTE (antes se
            // destruía/reconstruía en cada cruce y quedaba desanclado).
            restartRace(now);
          }
        }
      }
    }

    // Fin de lección (una sola vez): congela el último tramo, burst final,
    // registro en diario y fin de carrera (el visualizador también se va).
    function completeLessonIfDone(pct, hits, T) {
      if (pct >= 99.5 && hits >= cfg.separators && !finalBurstDone) {
        finalBurstDone = true;
        const cx = ((cfg.separators + 0.5) / (cfg.separators + 1)) * 100;

        // Evaluar último tramo por velocidad (igual que todos los demás)
        const lastSegIdx = T - 1;
        let lastRung = null;
        if (cfg.timerMode && raceStartTime > 0) {
          const raceMs = Date.now() - raceStartTime;
          const goalMs = getTimerGoalMs(cfg);
          const result = evaluateRace(raceMs, goalMs, (cfg.timerHardness || 0) / 100);
          if (result) {
            lastRung = result.rung;
            completedRarities[lastSegIdx] = result.rung;
            const lastSegEl = overlay.querySelector(`.adhd-seg[data-seg="${lastSegIdx}"]`);
            if (lastSegEl) {
              const frozenCls = rungClass(result.rung);
              lastSegEl.classList.remove('adhd-active', 'adhd-blink', 'adhd-blink-hard', 'adhd-rarity-verde', ...RUNG_CLASSES);
              lastSegEl.classList.add(frozenCls);
              lastSegEl.style.opacity = '1';
              clearActiveFx(lastSegEl);
              addRungDecorations(lastSegEl, result.rung);
              if (result.lost) flashLoss(lastSegEl, true);
            }
            if (!result.lost) {
              burstRung(result.rung, cx, result.rung === 5); // Super cierra con doble oleada
              if (result.rung === 5) fireHalo();
            }
          }
        }

        // Burst final: en timer mode lo hace burstRung; posicional conserva bigBurst clásico
        if (!cfg.timerMode) bigBurst(cx);

        // Registrar lección completada
        if (cfg.journalEnabled) {
          recordLesson();
        }
        // Fin de carrera: el visualizador también se va (spec: timeline solo
        // durante la carrera).
        teardownTimerFx();
      }

    }

    // Ícono de engranaje vectorial (independiente del emoji del SO).
    const GEAR_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>';
    function injectSettingsBtn() {
      if (settingsBtn) settingsBtn.remove();
      settingsBtn = document.createElement('div');
      settingsBtn.className = 'adhd-btn';
      settingsBtn.innerHTML = GEAR_SVG;
      settingsBtn.title = tr(cfg.lang, 'btnSettingsTitle');
      settingsBtn.setAttribute('role', 'button');
      settingsBtn.setAttribute('aria-label', tr(cfg.lang, 'btnSettingsTitle'));
      settingsBtn.addEventListener('click', (e) => { e.stopPropagation(); togglePanel(); });
      document.body.appendChild(settingsBtn);
    }

    // Íconos vectoriales de secciones (independientes del emoji del SO).
    const CLOCK_SVG = '<svg class="adhd-sec-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>';
    const BOOK_SVG = '<svg class="adhd-sec-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V4H6.5A2.5 2.5 0 0 0 4 6.5v13z"/><path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5"/></svg>';
    let panel = null;
    function togglePanel() {
      if (panel) { panel.remove(); panel = null; return; }
      panel = document.createElement('div');
      panel.className = 'adhd-panel';

      const isEn = cfg.lang === 'en';
      const timerAvg = getAverage(raceTimes);
      const avgDisplay = timerAvg ? Math.round(timerAvg / 10) / 100 + (isEn ? 's' : 's') : '—';

      let html = `<div class="adhd-head"><div class="adhd-eyebrow">DUOLINGO ADHD</div><h4>${tr(cfg.lang, 'panelTitle')}</h4></div>`;

      // ===== Controles frecuentes (siempre visibles, sin acordeón) =====
      html += `
          <label for="adhd-lang">${tr(cfg.lang, 'langLabel')}</label>
          <select id="adhd-lang">
            <option value="es" ${cfg.lang === 'es' ? 'selected' : ''}>Español</option>
            <option value="en" ${cfg.lang === 'en' ? 'selected' : ''}>English</option>
          </select>
          <label for="adhd-range">${tr(cfg.lang, 'labelMilestones')} <span class="adhd-val" id="adhd-pn">${cfg.separators + 1}</span></label>
          <input type="range" id="adhd-range" min="1" max="12" value="${cfg.separators}" aria-label="${tr(cfg.lang, 'ariaMilestones')}">
          <div class="adhd-hint">${tr(cfg.lang, 'hintBar')}</div>
      `;

      // ===== Sección CRONÓMETRO (cerrada) =====
      html += `
        <details>
          <summary>${CLOCK_SVG}<span>${tr(cfg.lang, 'secCrono')}</span></summary>
          <div class="adhd-sec-body">
          <label><input type="checkbox" id="adhd-timer-mode" ${cfg.timerMode ? 'checked' : ''}> ${tr(cfg.lang, 'lblTimerMode')}</label>
          <div class="adhd-hint">${tr(cfg.lang, 'hintTimer')}</div>
          <div id="adhd-timer-opts" style="${cfg.timerMode ? '' : 'display:none;'}">
            <label for="adhd-timer-min">${tr(cfg.lang, 'lblTimerFixed')}: <span class="adhd-val" id="adhd-timer-min-val">${cfg.timerMinutes}m ${cfg.timerSeconds}s</span></label>
            <input type="range" id="adhd-timer-min" min="1" max="30" value="${cfg.timerMinutes}">
            <label for="adhd-timer-sec">+ <span class="adhd-val" id="adhd-timer-sec-val">${cfg.timerSeconds}s</span></label>
            <input type="range" id="adhd-timer-sec" min="0" max="59" step="5" value="${cfg.timerSeconds}">
            <label for="adhd-timer-hardness">${tr(cfg.lang, 'lblTimerHardness')}: <span class="adhd-val" id="adhd-timer-hardness-val">${cfg.timerHardness != null ? cfg.timerHardness : 35}</span>%</label>
            <input type="range" id="adhd-timer-hardness" min="0" max="100" step="5" value="${cfg.timerHardness != null ? cfg.timerHardness : 35}" aria-label="${tr(cfg.lang, 'lblTimerHardness')}">
            <label><input type="checkbox" id="adhd-timer-label" ${cfg.timerShowLabel ? 'checked' : ''}> ${tr(cfg.lang, 'lblTimerLabel')}</label>
            <button id="adhd-test-fx">${tr(cfg.lang, 'btnTestFx')}</button>
            <div class="adhd-hint">${tr(cfg.lang, 'hintTimerGoal')}</div>
            <div style="font-size:11px;color:#666;margin-top:4px;">${isEn ? 'Avg' : 'Promedio'}: ${avgDisplay}</div>
          </div>
          </div>
        </details>
      `;

      // ===== Sección DIARIO (cerrada) =====
      const journal = cfg.journalEnabled ? getJournal() : null;
      html += `
        <details>
          <summary>${BOOK_SVG}<span>${tr(cfg.lang, 'secDiario')}</span></summary>
          <div class="adhd-sec-body">
          <label><input type="checkbox" id="adhd-journal" ${cfg.journalEnabled ? 'checked' : ''}> ${tr(cfg.lang, 'lblJournal')}</label>
          <div class="adhd-hint">${tr(cfg.lang, 'hintJournal')}</div>
          <div id="adhd-journal-data" style="${cfg.journalEnabled ? '' : 'display:none;'}">
      `;
      if (journal) {
        const jrAvg = journal.raceTimes && journal.raceTimes.length > 0
          ? Math.round(journal.raceTimes.reduce((a, b) => a + b, 0) / journal.raceTimes.length / 10) / 100 + 's'
          : '—';
        html += `
          <div>${tr(cfg.lang, 'jrLessons')}: <strong>${journal.lessons}</strong></div>
          <div>${tr(cfg.lang, 'jrSeps')}: <strong>${journal.separators}</strong></div>
          <div>${tr(cfg.lang, 'jrAvgTime')}: <strong>${jrAvg}</strong></div>
          <div>${tr(cfg.lang, 'jrStreak')}: <strong>${journal.streak}</strong></div>
          <div>${tr(cfg.lang, 'jrTotal')}: <strong>${journal.totalLessons}</strong></div>
        `;
      } else {
        html += `<div style="color:#999;">${tr(cfg.lang, 'jrNoData')}</div>`;
      }
      html += `</div></div></details>`;

      // Botón reset (footer separado)
      html += `<div class="adhd-foot"><button id="adhd-reset">${tr(cfg.lang, 'btnReset')}</button></div>`;

      panel.innerHTML = html;
      document.body.appendChild(panel);

      // Eventos
      panel.querySelector('#adhd-lang').addEventListener('change', (e) => {
        setCfg('lang', e.target.value);
        panel.remove(); panel = null;
        togglePanel();
      });
      const range = panel.querySelector('#adhd-range');
      range.addEventListener('input', () => { panel.querySelector('#adhd-pn').textContent = (parseInt(range.value, 10) + 1); });
      const done = () => {
        setCfg('separators', parseInt(range.value, 10));
        buildOverlayContent(); render();
      };
      range.addEventListener('change', done);

      // Feature 1: timer events
      panel.querySelector('#adhd-timer-mode').addEventListener('change', (e) => {
        setCfg('timerMode', e.target.checked);
        panel.querySelector('#adhd-timer-opts').style.display = cfg.timerMode ? '' : 'none';
      });
      panel.querySelector('#adhd-timer-min').addEventListener('input', (e) => {
        panel.querySelector('#adhd-timer-min-val').textContent = e.target.value + 'm ' + cfg.timerSeconds + 's';
      });
      panel.querySelector('#adhd-timer-min').addEventListener('change', (e) => {
        setCfg('timerMinutes', parseInt(e.target.value, 10));
      });
      panel.querySelector('#adhd-timer-sec').addEventListener('input', (e) => {
        panel.querySelector('#adhd-timer-sec-val').textContent = e.target.value + 's';
      });
      panel.querySelector('#adhd-timer-sec').addEventListener('change', (e) => {
        setCfg('timerSeconds', parseInt(e.target.value, 10));
      });
      // arena-timer-overhaul: dureza — recalcula bandas y redibuja el timeline en vivo
      panel.querySelector('#adhd-timer-hardness').addEventListener('input', (e) => {
        panel.querySelector('#adhd-timer-hardness-val').textContent = e.target.value;
      });
      panel.querySelector('#adhd-timer-hardness').addEventListener('change', (e) => {
        setCfg('timerHardness', parseInt(e.target.value, 10));
        lastProjectedRung = null; // el decaimiento se re-proyecta con las bandas nuevas
        // ensureDecayTimeline() detecta la firma de bandas nueva y reconstruye
        if (cfg.timerMode && raceStartTime > 0) ensureDecayTimeline();
      });
      panel.querySelector('#adhd-timer-label').addEventListener('change', (e) => {
        setCfg('timerShowLabel', e.target.checked);
      });

      // tramo-fx-round2 (D4): calibración en vivo — cicla los 6 bursts + perdido
      // SIN esperar cruces. Spacing 1400ms: el burst vive ~1.2s y el cap 44
      // recién libera, así Super nunca se recorta (design D4, riesgo de apilado).
      panel.querySelector('#adhd-test-fx').addEventListener('click', () => {
        if (!bar || !overlay) return;
        for (let r = 0; r <= 5; r++) {
          setTimeout(() => burstRung(r, 50, r === 5), r * 1400);
        }
        setTimeout(() => { // perdido: trama + flash sobre el tramo activo, sin texto
          const seg = overlay.querySelector('.adhd-seg.adhd-active') || overlay.querySelector('.adhd-seg');
          if (!seg || seg.querySelector('.adhd-rung-prev')) return;
          const s = document.createElement('span');
          s.className = 'adhd-rung-prev adhd-rung-perdido';
          s.setAttribute('aria-hidden', 'true');
          seg.appendChild(s);
          setTimeout(() => s.remove(), 360);
          flashLoss(seg, true);
        }, 6 * 1400);
      });

      // Feature 3: journal toggle
      panel.querySelector('#adhd-journal').addEventListener('change', (e) => {
        setCfg('journalEnabled', e.target.checked);
        if (cfg.journalEnabled) { getJournal(); }
        panel.remove(); panel = null;
        togglePanel();
      });

      panel.querySelector('#adhd-reset').addEventListener('click', () => {
        const keepLang = cfg.lang;
        Object.assign(cfg, DEFAULTS, { lang: keepLang });
        save();
        resetTimes();
        resetJournal();
        panel.remove(); panel = null;
        togglePanel();
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
      // SPA pathname tracking: clear cached bar/overlay on screen change so a
      // stale overlay from a previous lesson screen can't persist (e.g. into
      // the lesson-complete celebration screen).
      let lastPath = window.location.pathname;
      const watchPath = () => {
        const p = window.location.pathname;
        if (p !== lastPath) {
          lastPath = p;
          if (overlay) { overlay.remove(); overlay = null; }
          bar = null;
          teardownTimerFx();
        }
      };
      // Nota (decay-timeline-visibility, D5): se evaluó coalescer este callback
      // con requestAnimationFrame y se DESCARTO. Medido en el harness: no cambia
      // nada. (a) Con 200 mutaciones ajenas, el guard
      // `w !== lastWidth || value !== lastValue` ya evita el render → 0 pasadas
      // con y sin rAF. (b) Con 30 cambios REALES de progreso dentro de un mismo
      // frame, MutationObserver ya entrega un único batch → 1 pasada igual.
      // rAF solo podía agregar hasta 1 frame de latencia al arranque.
      const mo = new MutationObserver(() => {
        watchPath();
        ensureRoots();
        const w = bar ? bar.getBoundingClientRect().width : 0;
        const { value } = getProgress();
        if (bar && (w !== lastWidth || value !== lastValue)) render();
        if (!bar) {
          overlay = null;
          if (miniCronoEl || decayEl || fastLabelEls.length) teardownTimerFx();
        }
      });
      mo.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['aria-valuenow', 'style', 'aria-valuemax'] });
    }

    function init() {
      const tryIt = setInterval(() => {
        if (ensureRoots()) {
          clearInterval(tryIt);
          // Cargar estado persistente
          raceTimes = loadTimes();
          if (cfg.journalEnabled) journal = getJournal();
          render();
          injectSettingsBtn();
        }
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

