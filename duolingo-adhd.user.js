// ==UserScript==
// @name           Duolingo ADHD — Progress bar milestones (for the easily distracted / bored)
// @name:es        Duolingo ADHD — Hitos de barra de progreso (para los que se aburren / se distraen)
// @namespace      https://github.com/MoriNo23/duolingo-adhd
// @version        2.23.0
// @description    Divide la barra de progreso de la lección en tramos. Modo tiempo: cada tramo arranca en Super y cada vez que el riel se agota baja un peldaño (Super→Madera); el peldaño en que cierres el tramo queda congelado. Cerrá rápido para congelar mejor jerarquía. Recompensas a pantalla completa en peldaños altos (Racha/Diamante/Super), cronómetro Baloo 2, diario local + panel EN/ES. Con sonido: fanfarria por peldaño y recordatorio periódico (Ajustes → Sonido). Mantiene el diseño nativo de Duolingo.
// @description:en Splits the lesson progress bar into segments. Timer mode: every segment starts at the top tier (Super) and each time the rail runs out it drops one tier (Super→Wood) — the tier you close the segment on gets frozen. Close fast to freeze a better tier. Full-screen reward effects on high tiers (Streak/Diamond/Super), Baloo 2 clock, local journal + EN/ES settings. With sound: a tier fanfare on every segment close plus a periodic reminder (Settings → Sound). Keeps Duolingo's native design.
// @description:es Divide la barra de progreso de la lección en tramos. Modo tiempo: cada tramo arranca en el nivel Super y va bajando de peldaño (Madera→Super) mientras se quema el presupuesto — cerrá rápido para congelar mejor jerarquía. Efectos de recompensa a pantalla completa en los peldaños altos (Racha/Diamante/Super), partículas, cronómetro Baloo 2, diario local + panel EN/ES. Con sonido: fanfarria por peldaño y recordatorio periódico (Ajustes → Sonido). Mantiene el diseño nativo de Duolingo.
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
// @grant        GM_notification
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
   PURE CORE  (núcleo puro; se comparte con el arnés de test via el enganche
              __ADHD_TEST__ — ver test/harness/core-loader.js)
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
  timerMode: true,        // ON = escalera por vueltas (nuevo) | OFF = solo separadores
  timerMinutes: 10,       // minutos por tramo (1–30)
  timerSeconds: 0,        // segundos adicionales (0–59)
  timerShowLabel: true,   // efectos de recompensa al cerrar tramo (racha+)
  // animations-panel-setting: nivel de animacion del script.
  // motion-default-always: el default es 'always'. Las celebraciones de recompensa son
  // lo que el script existe para, y en un escritorio que reporta
  // prefers-reduced-motion: reduce (org.gnome.desktop.interface enable-animations
  // en false) el default anterior las dejaba quietas sin avisar. El camino calmado
  // sigue a un click: 'system' = respetar la preferencia del escritorio, 'never' =
  // apagarlas siempre. Un config que YA tiene nivel guardado lo conserva.
  motionLevel: 'always',
  // tier-motion-per-seg: desde qué peldaño el canvas celebra animado cuando
  // el movimiento está permitido (3=racha, 4=diamante, 5=super, 6=ninguno).
  // Default 3 = el comportamiento de siempre: los tres altos animan y los
  // bajos nunca tuvieron canvas. Una config guardada antes de este cambio
  // la conserva (Object.assign solo completa lo faltante).
  tierMotionFloor: 3,
  // rail-fixed-lap-ceiling: la clave `timerHardness` ya no se lee ni se escribe.
  // Sigue en DEFAULTS para que los cfgs guardados sigan cargando sin romper.
  timerHardness: 35,
  // Feature 3: diario local (persiste via GM_setValue, nunca push)
  journalEnabled: false,  // contadores diarios simples
  // audio-cues: los dos sonidos nuevos arrancan ENCENDIDOS. Es lo que el script
  // existe para (reenganchar), y apagarlos es un click en la sección Sonido.
  // Una config guardada antes de este cambio se carga igual: Object.assign la
  // pisa con estos defaults y no pierde ninguna clave propia.
  soundCues: true,         // fanfarria del peldaño al cerrar un tramo
  reminderEnabled: true,   // recordatorio periódico mientras duolingo.com está abierto
  reminderSeconds: 60,     // intervalo del recordatorio (15–900 s, ver clampReminderSeconds)
  // reminder-desktop-notification: escala a notificación de escritorio cuando
  // la pestaña está oculta (el canal del manager, nunca el permiso del sitio).
  // Arranca ENCENDIDO como los sonidos; una config guardada antes de este
  // cambio la conserva (Object.assign pisa con el default solo lo faltante).
  reminderNotifEnabled: true,
};

// ---------- timer-mode-ux constantes + preview (pure core) ----------
// arena-timer-overhaul: BLINK_THRESHOLD, PREVIEW_CLASSES y previewClass fueron
// reemplazados por la escalera por vueltas (ladderAt/tierForLap/rungClass,
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
    hintTimer:       'Cada tramo arranca en el techo (Super) y baja un peldaño cada vez que el riel se recarga. Cerrá rápido para congelar mejor jerarquía.',
    hintTimerGoal:   'El riel se agota, se recarga y baja un peldaño. El color bajo la cabeza al cerrar el tramo es el que queda grabado. El objetivo es el largo de cada vuelta: menos tiempo, más peldaños. Pasá el cursor por el riel para ver a dónde vas.',
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
    lblTimerMode:    'Modo tiempo',
    lblTimerFixed:   'Objetivo (seg)',
    lblTimerLabel:   'Efectos de recompensa',
    btnTestFx:       'Probar efectos',
    // Feature 3: diario
    lblJournal:      'Activar diario',
    jrLessons:       'Lecciones hoy',
    jrSeps:          'Tramos hoy',
    jrAvgTime:       'Tiempo medio/sep',
    jrStreak:        'Racha (días)',
    jrTotal:         'Lecciones totales',
    jrNoData:        'Sin datos — activa el diario',
    // animations-panel-setting: nivel de animacion
    lblMotion:       'Animaciones',
    hintMotion:      'Siempre = las anima siempre. Respetar sistema = lo decide tu escritorio. Nunca = las calma. Afecta solo a este script; no toca la configuracion del escritorio.',
    // fix-reward-fx-static-and-duo-crash: el sistema pide calma y el usuario no
    // dijo nada. Sin esto, una celebracion quieta parece un efecto roto.
    hintMotionSystem: 'Tu sistema pide menos animacion, asi que las celebraciones de los peldanos altos (Racha, Diamante, Super) salen en version calmada: se ven, pero no se mueven. Poné Animaciones en "Siempre" para que se muevan.',
    motionSystem:    'Respetar sistema',
    motionAlways:    'Siempre',
    motionNever:     'Nunca',
    // tier-motion-per-seg: desde qué peldaño el cierre celebra con animación
    lblTierMotion:   'Celebración animada',
    tierMotionRacha:    'Racha, Diamante y Super',
    tierMotionDiamante: 'Diamante y Super',
    tierMotionSuper:     'Solo Super',
    tierMotionNone:      'Ninguna (solo partículas)',
    hintTierMotion:  'Con el movimiento permitido, desde qué peldaño el cierre celebra con animación en pantalla. Los peldaños por debajo solo disparan las partículas. Si tu sistema pide calma, nada se mueve pase lo que pongas acá.',
    // audio-cues: sección SONIDO del panel
    secSonido:       'Sonido',
    lblSoundCues:    'Sonidos por peldaño',
    hintSoundCues:   'Al cerrar cada tramo suena el peldaño que congelaste: satisfactorio en Racha/Diamante/Super, desagradable en Madera/Bronce/Plata.',
    lblReminder:     'Recordatorio periódico',
    hintReminder:    'Suena cada cierto tiempo mientras duolingo.com está abierto, en cualquier pantalla — pero solo si llevas 45 s sin interactuar, para no interrumpirte mientras practicas.',
    lblReminderInterval: 'Cada cuánto',
    btnTestSound:    'Probar sonido',
    // reminder-desktop-notification: textos de la notificación de escritorio
    notifTitle:      'Duolingo ADHD — recordatorio',
    notifBody:       'Es hora de volver a la lección.',
    // ...y los del panel (toggle + fallar visible)
    lblReminderNotif: 'Notificación de escritorio',
    hintReminderNotif: 'Con la pestaña en segundo plano, el recordatorio salta como notificación del sistema. La emite el gestor de userscripts, no duolingo.com; nada sale de tu navegador.',
    notifBlocked:    'La última notificación no se entregó: revisá si el sistema silencia notificaciones (No molestar en GNOME, Asistente de foco en Windows).',
    notifUnsupported: 'Tu gestor de userscripts no ofrece notificaciones: con la pestaña oculta el recordatorio queda pendiente y suena al volver.',
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
    hintTimer:       'Every segment starts at the ceiling (Super tier) and drops a tier each time the rail recharges. Close fast to freeze a better tier.',
    hintTimerGoal:   'The rail runs out, recharges and drops one tier. The color under the playhead when you close the segment is what gets frozen. The goal is the length of each lap: less time, more tiers.',
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
    lblTimerMode:    'Timer mode',
    lblTimerFixed:   'Goal (sec)',
    lblTimerLabel:   'Reward effects',
    btnTestFx:       'Test effects',
    // Feature 3: journal
    lblJournal:      'Enable journal',
    jrLessons:       'Lessons today',
    jrSeps:          'Segments today',
    jrAvgTime:       'Avg time/sep',
    jrStreak:        'Streak (days)',
    jrTotal:         'Total lessons',
    jrNoData:        'No data — enable journal',
    // animations-panel-setting: motion level
    lblMotion:       'Animations',
    hintMotion:      'Always = it animates regardless. Respect system = your desktop decides. Never = it stays calm. Affects this script only; it does not change your desktop settings.',
    hintMotionSystem: 'Your system asks for reduced motion, so the high-tier celebrations (Streak, Diamond, Super) play their calm version: you see them, but they do not move. Set Animations to "Always" to make them move.',
    motionSystem:    'Respect system',
    motionAlways:    'Always',
    motionNever:     'Never',
    // tier-motion-per-seg: from which tier a closure celebrates with animation
    lblTierMotion:   'Animated celebration',
    tierMotionRacha:    'Streak, Diamond and Super',
    tierMotionDiamante: 'Diamond and Super',
    tierMotionSuper:     'Super only',
    tierMotionNone:      'None (particles only)',
    hintTierMotion:  'With motion allowed, from which tier a closure celebrates with a full-screen animation. Tiers below it only fire the particles. If your system asks for calm, nothing moves no matter what you set here.',
    // audio-cues: sound section of the panel
    secSonido:       'Sound',
    lblSoundCues:    'Tier sounds',
    hintSoundCues:   'Closing each segment plays the tier you froze: satisfying on Streak/Diamond/Super, unpleasant on Wood/Bronze/Silver.',
    lblReminder:     'Periodic reminder',
    hintReminder:    'Plays on an interval while duolingo.com is open, on any screen — but only after 45 s without interaction, so it never interrupts you mid-lesson.',
    lblReminderInterval: 'Every',
    btnTestSound:    'Test sound',
    // reminder-desktop-notification: desktop notification texts
    notifTitle:      'Duolingo ADHD — reminder',
    notifBody:       'Time to get back to your lesson.',
    // ...and the panel's (toggle + failing visibly)
    lblReminderNotif: 'Desktop notification',
    hintReminderNotif: 'With the tab in the background, the reminder surfaces as a system notification. The userscript manager delivers it, not duolingo.com; nothing leaves your browser.',
    notifBlocked:    'The last notification was not delivered: check whether your system is silencing notifications (Do Not Disturb on GNOME, Focus Assist on Windows).',
    notifUnsupported: 'Your userscript manager does not provide notifications: while the tab is hidden the reminder stays pending and plays when you come back.',
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

// ---------- rail-fixed-lap-ceiling: la escalera de peldaños por VUELTAS ----------
// El tramo NO tiene jerarquía por posición: la GANA el usuario según cuánto tarda.
// Arranca en el techo (Super) y mantiene ese peldaño toda la vuelta; cuando el riel
// se agota se recarga un peldaño más abajo. El peldaño del instante en que se
// cierra el tramo queda grabado. No hay defeat: el piso es Madera.

// Tabla de peldaños (piso → techo). from/to definen el gradiente del skin; ink, el texto.
const RUNGS = [
  { id: 'madera',   label: 'Madera',   glyph: '🪵',     from: '#8d6e63', to: '#b39184', ink: '#3e2b26', skin: 'matte' },
  { id: 'bronce',   label: 'Bronce',   glyph: '🥉', from: '#8a4f2a', to: '#d29a6b', ink: '#3a1d0c', skin: 'bevel' },
  { id: 'plata',    label: 'Plata',    glyph: '🥈',     from: '#93a3ae', to: '#eaf1f6', ink: '#2c3a45', skin: 'metal' },
  { id: 'racha',    label: 'Racha',    glyph: '🔥',  from: '#ff9600', to: '#ffe066', ink: '#4a2500', skin: 'flame' },
  { id: 'diamante', label: 'Diamante', glyph: '💎',    from: '#3fd0cc', to: '#e7ffff', ink: '#04403d', skin: 'prism' },
  { id: 'super',    label: 'Super',    glyph: '👑',    from: '#8b5cf6', to: '#e9d5ff', ink: '#2a0a52', skin: 'super' },
];

 // rail-fixed-lap-ceiling: la escalera es una ESCALERA de vueltas, no un
// decaimiento. El peldaño de la vuelta en curso es su techo, y no baja hasta
// que la vuelta se recarga. El piso es Madera: pasado ese peldaño las vueltas
// siguen corriendo en Madera para siempre. No hay estado de derrota: el costo
// de tardar es un peldaño mas bajo, que es el mecanismo de feedback completo.
function tierForLap(lap) {
  const n = Math.max(0, Math.floor(lap || 0));
  return RUNGS.length - 1 - Math.min(n, RUNGS.length - 1);
}

// Una sola fuente de verdad para "que peldaño esta en play". El lap se DERIVA
// del elapsed (nunca se cuenta con un mutable) para que no pueda
// desincronizarse de raceStartTime en un restart, un re-render SPA o el
// reinicio de leccion (pct < 2).
function ladderAt(elapsedMs, goalMs) {
  if (!goalMs || goalMs <= 0) return null;
  const ms = Math.max(0, elapsedMs || 0);
  const total = ms / goalMs;
  const lap = Math.floor(total);
  return { lap, frac: total - lap, tier: tierForLap(lap) };
}

// Pure mapping: rung index → clase CSS del skin. Null-safe.
// rail-fixed-lap-ceiling: sin rama -1, ya no existe el peldaño "perdido".
function rungClass(rungIdx) {
  if (typeof rungIdx !== 'number' || rungIdx < 0 || rungIdx >= RUNGS.length) return null;
  return 'adhd-rung-' + RUNGS[rungIdx].id;
}

// Color del texto del mini cronómetro según el rung proyectado.
function rungTextColor(rungIdx) {
  const r = RUNGS[rungIdx];
  return r ? r.ink : '#ffffff';
}

const STORAGE_KEY_TIMES = 'adhd_timer_times'; // array de tiempos por carrera (ms)

// animations-panel-setting: resuelve si el script apaga sus animaciones.
//   'never'  -> apagadas siempre (override explícito del usuario)
//   'always' -> encendidas siempre (override explícito del usuario)
//   'system' -> lo que diga prefers-reduced-motion
// Un valor desconocido (config vieja, escrito a mano, corrupto) cae en
// 'system', que es el default y la única opción que no cambia el behavior
// previo. Puro a propósito: la precedencia se testea sin DOM.
function resolveMotion(level, systemReduced) {
  if (level === 'never') return true;
  if (level === 'always') return false;
  return !!systemReduced;
}

const MOTION_LEVELS = ['system', 'always', 'never'];

// tier-motion-per-seg: el eje por peldaño. La decisión resuelta del PAR:
// motionLevel dice SI puede haber movimiento (resolveMotion, contrato que no
// se toca); el piso dice DESDE qué peldaño el canvas celebra animado cuando
// el movimiento está permitido. Salidas: 'reduced' (la presentación calmada
// de siempre — gris, quieta), 'animated' (el canvas completo) y 'off' (este
// peldaño no celebra con canvas: solo el burst de CSS de siempre).
// Accesibilidad primero y sin excepción (spec motion-preference): si la
// decisión de motion ya resolvió calma, TODO peldaño resuelve 'reduced' y el
// eje no aparece en ese camino — ningún valor elegido puede re-habilitar
// movimiento que el usuario o el sistema pidieron suprimir. El eje solo
// elige MÁS animación dentro del rango ya permitido.
function tierMotionFor(state) {
  if (!state) return 'off';
  if (resolveMotion(state.level, state.reduce)) return 'reduced';
  // Movimiento permitido: los peldaños bajos nunca ganan efecto canvas
  // (spec reward-fx: "the lower tiers SHALL NOT gain a canvas effect").
  if (!Number.isInteger(state.rung) || state.rung < 3) return 'off';
  return state.rung >= clampTierMotionFloor(state.floor) ? 'animated' : 'off';
}

// tier-motion-per-seg: el piso reconocido. Solo 3/4/5/6 son valores válidos
// (racha / diamante / super / ninguno); cualquier otra cosa — config vieja,
// editada a mano, corrupta — cae al default enviado, que es el comportamiento
// de siempre. Nunca deja los efectos en estado indefinido (spec reward-fx:
// "an unrecognised stored value SHALL fall back to the shipped default").
function clampTierMotionFloor(v) {
  return (v === 3 || v === 4 || v === 5 || v === 6) ? v : DEFAULTS.tierMotionFloor;
}

function getTimerGoalMs(cfg) {
  return (cfg.timerMinutes * 60 + cfg.timerSeconds) * 1000;
}

// Evalua el tiempo de una carrera contra el presupuesto por VUELTAS.
// rail-fixed-lap-ceiling: devuelve { lap, frac, tier, rung, isFast } donde frac es
// local a la vuelta en play y rung es el techo de esa vuelta — el peldaño que se
// graba al cerrar, no el mejor que se rozó antes. No hay `lost`: el peldaño más
// bajo es Madera y siempre se alcanza algo.
function evaluateRace(ms, goalMs) {
  if (!goalMs || goalMs <= 0) return null;
  const L = ladderAt(ms, goalMs);
  return { lap: L.lap, frac: L.frac, tier: L.tier, rung: L.tier, isFast: L.tier >= 4 };
}

function loadTimes() {
  // Persistencia via GM_getValue. En Node los tests lo sirven con el mismo stub
  // (test/harness/core-loader.js): no hay rama de test en este archivo.
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
// por evaluateRace, que hoy proyecta el peldaño de la vuelta en curso — ver arriba).

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

// =====================================================================
// audio-cues: núcleo puro del sonido (fanfarria por peldaño + recordatorio)
// =====================================================================
// Ids de cue del script. El orden de RUNG_CUES es el de RUNGS (0 = madera
// … 5 = super), asi cueForRung() es un indice directo y no una busqueda.
const SOUND_CUE_IDS = ['reminder', 'madera', 'bronce', 'plata', 'racha', 'diamante', 'super'];
const RUNG_CUES = ['madera', 'bronce', 'plata', 'racha', 'diamante', 'super'];
// Los tres altos suenan satisfactorios; los tres bajos, desagradables
// (el mismo split que reward-fx, donde los altos celebran y los bajos no).
const SATISFYING_CUES = ['racha', 'diamante', 'super'];

// Índice de peldaño → id de cue. Cualquier cosa que no sea un índice entero
// válido devuelve null: un cierre sin peldaño no tiene sonido (spec: "no tier
// sound when the timer is off").
function cueForRung(rung) {
  if (typeof rung !== 'number' || !Number.isInteger(rung)) return null;
  if (rung < 0 || rung >= RUNG_CUES.length) return null;
  return RUNG_CUES[rung];
}

const REMINDER_MIN_SECONDS = 15;
const REMINDER_MAX_SECONDS = 900;
const REMINDER_DEFAULT_SECONDS = 60;

// El slider del panel va de 15 a 900; una config editada a mano (o un storage
// corrupto) no puede dejar el recordatorio sonando cada 0ms ni nunca.
function clampReminderSeconds(value) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return REMINDER_DEFAULT_SECONDS;
  return Math.min(REMINDER_MAX_SECONDS, Math.max(REMINDER_MIN_SECONDS, n));
}

// Rótulo legible del intervalo para el panel: "45s", "5m", "5m 30s".
function formatIntervalLabel(value) {
  const s = clampReminderSeconds(value);
  if (s < 60) return s + 's';
  const m = Math.floor(s / 60), r = s % 60;
  return r ? m + 'm ' + r + 's' : m + 'm';
}

// remind-only-when-idle: ¿puede sonar el recordatorio AHORA? Solo en idle —
// pestaña VISIBLE y sin interacción durante el umbral: suena cuando NO
// estás enfocado en la página (spec audio-cues). Oculto nunca es
// reproducible: la pestaña no está delante.
const REMINDER_IDLE_MS = 45000;

function canPlayReminder(state) {
  if (!state || state.hidden) return false;
  if (!Number.isFinite(state.now) || !Number.isFinite(state.lastInteractionAt)) return false;
  return state.now - state.lastInteractionAt >= REMINDER_IDLE_MS;
}

// reminder-desktop-notification: la decisión "vence ahora, ¿qué hago?",
// extraída del tick como función pura — es el paso que hace testeable el
// canal de escritorio: la rama oculta deja de ser un `return false`
// enterrado en canPlayReminder y pasa a ser una salida con nombre.
// Contrato: 'play' (visible + idle: suena), 'notify' (oculto + notificación
// activada: escala al escritorio — el SO entrega sin importar cuánto hace
// que la pestaña no se ve, el throttling del browser no lo alcanza),
// 'pending' (enfocado, u oculto sin canal: la deuda es UNA, nunca una
// ráfaga), 'none' (antes de vencer o basura: nada que hacer). notifEnabled
// estrictamente true: basura o desactivada → el silencio de antes.
function reminderAction(state) {
  if (!state) return 'none';
  if (!Number.isFinite(state.now) || !Number.isFinite(state.nextAt)) return 'none';
  if (state.now < state.nextAt) return 'none';
  if (state.hidden) return state.notifEnabled === true ? 'notify' : 'pending';
  if (!Number.isFinite(state.lastInteractionAt)) return 'none';
  return state.now - state.lastInteractionAt >= REMINDER_IDLE_MS ? 'play' : 'pending';
}

// reminder-desktop-notification: el canal de escritorio. GM_notification es
// del MANAGER (ya concedido en Tampermonkey): no se le pide permiso al sitio
// y la notificación no se atribuye a duolingo.com — la Notification de la
// página no se toca (spec: "Notification permission is not requested from
// the page"). Feature-detect obligatorio: un @grant declarado no garantiza
// que la función exista (Violentmonkey, Greasemonkey, Safari). silent: true
// — el sonido lo pone el script si el audio está vivo; la notificación
// pone el texto, así el aviso no depende del volumen del sistema.
// 'sent' | 'blocked' (el intento no se entrega) | 'unsupported' (no hay
// API: degradación al comportamiento anterior). JAMÁS lanza.
function notifyReminder(title, text) {
  try {
    if (typeof GM_notification !== 'function') return 'unsupported';
    GM_notification({ title: title, text: text, silent: true, timeout: 10000, duration: 10000 });
    return 'sent';
  } catch (e) {
    return 'blocked';
  }
}

// fix-crono-contrast: el contador lleva el color del peldaño como SUPERFICIE y
// su dígito se empareja para ser legible sobre ella. Antes el color iba como
// texto sobre una pill oscura (madera 1.29:1, bronce 1.09:1, super 1.40:1).
// Luminancia relativa WCAG de '#rrggbb'; null si no es un hex válido.
function hexLuminance(hex) {
  if (typeof hex !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(hex)) return null;
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// Contraste WCAG entre dos luminancias: (Lmayor + .05) / (Lmenor + .05).
function contrastOfLuminances(l1, l2) {
  const hi = Math.max(l1, l2), lo = Math.min(l1, l2);
  return (hi + 0.05) / (lo + 0.05);
}

// calm-canvas-grayscale: rampa de grises para la presentacion calmada.
// Cada efecto sirve a EXACTAMENTE un peldano (FX_BY_RUNG: 3 racha, 4 diamante,
// 5 super) con paleta hardcodeada: no hay color de peldano que re-mapear, asi
// que el ramp son tres grises elegidos a mano con >=1.5:1 entre consecutivos.
// Los peldaños bajos no tienen efecto canvas: resuelven null.
const CALM_GREYS = { 3: '#565656', 4: '#9e9e9e', 5: '#e2e2e2' };
function calmGreyFor(rung) {
  return Object.prototype.hasOwnProperty.call(CALM_GREYS, rung) ? CALM_GREYS[rung] : null;
}

// seg-skin-earned-at-close: el tono dormido del tramo que llena. Desaturacion
// a LUMINANCIA CONSTANTE — mezcla hacia el gris de la propia luminancia en
// espacio lineal: Y se preserva exacto (el orden de la escalera sobrevive por
// construccion), la direccion de croma lineal queda intacta (el matiz no cambia
// de familia) y solo la saturacion cae. Nunca un gris uniforme: colapsaria la
// escalera (Plata<->Racha 1.01:1, el par que motion-preference deja registrado).
// El gris puro entra y sale igual: ya es quieto. levelColor interpola en
// formato rgb(...) cuando hay mas tramos que rarezas, asi que tambien entra.
const DORMANT_DESAT = 0.65; // cuanto se mezcla hacia el gris: croma *= 0.35
const LEGENDARY_ANCHOR = '#7c3aed'; // ancla violeta del gradiente epico
function dormantTone(hex) {
  let r, g, b;
  if (typeof hex === 'string' && /^#[0-9a-fA-F]{6}$/.test(hex)) {
    [r, g, b] = hexToRgb(hex);
  } else if (typeof hex === 'string') {
    const m = hex.match(/^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/);
    if (!m) return null;
    r = +m[1]; g = +m[2]; b = +m[3];
    if (r > 255 || g > 255 || b > 255) return null;
  } else {
    return null;
  }
  if (r === g && g === b) {
    return '#' + [r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('');
  }
  const lin = (c) => (c / 255 <= 0.03928 ? c / 255 / 12.92 : Math.pow((c / 255 + 0.055) / 1.055, 2.4));
  const Y = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  const mix = (c) => {
    const m = (1 - DORMANT_DESAT) * lin(c) + DORMANT_DESAT * Y;
    const s = m <= 0.0031308 ? m * 12.92 : 1.055 * Math.pow(m, 1 / 2.4) - 0.055;
    return Math.max(0, Math.min(255, Math.round(s * 255)));
  };
  return '#' + [mix(r), mix(g), mix(b)].map((n) => n.toString(16).padStart(2, '0')).join('');
}
// Escala un gris por factor con clamp. Basura (hex invalido, factor no
// finito) -> null: nunca lanza. Solo pisa el eje neutro: r === g === b
// siempre, asi el que lo usa no puede introducir tono por accidente.
function shadeGrey(hex, f) {
  if (typeof hex !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(hex)) return null;
  if (!Number.isFinite(f)) return null;
  const v = [1, 3, 5].map((i) => Math.max(0, Math.min(255, Math.round(parseInt(hex.slice(i, i + 2), 16) * f))));
  return '#' + v.map((n) => n.toString(16).padStart(2, '0')).join('');
}
// Dígito del contador: blanco o la tinta del peldaño, el que más contraste dé
// contra la superficie (cociente WCAG real: comparar solo |L1 - L2| NO sirve,
// porque el dígito puede caer de cualquiera de los dos lados del fondo).
// Empate → la tinta. Entrada inválida → blanco: nunca lanza.
function cronoTextColor(surfaceHex, inkHex) {
  const s = hexLuminance(surfaceHex);
  const i = hexLuminance(inkHex);
  if (s === null || i === null) return '#ffffff';
  return contrastOfLuminances(s, i) >= contrastOfLuminances(s, 1) ? inkHex : '#ffffff';
}

const CORE = {
  RARITY, LEGENDARY, DEFAULTS, I18N, tr, detectLang,
  hexToRgb, lerp, lerpColor,
  levelColor, levelName,
  segmentCount, segLeft, segLength, sepPos, segProgress, currentSeg, reachedSeparators,
  // arena-timer-overhaul: evaluación
  // rail-fixed-lap-ceiling: escalera por vueltas (ladderAt/tierForLap)
  RUNGS, tierForLap, ladderAt, rungClass, rungTextColor,
  loadTimes, saveTimes, getAverage, resetTimes, newRaces, evaluateRace,
  getTimerGoalMs,
  // animations-panel-setting: resolucion de la preferencia de animacion
  resolveMotion, MOTION_LEVELS,
  // tier-motion-per-seg: el eje por peldaño
  tierMotionFor, clampTierMotionFloor,
  // Feature 3: journal
  loadJournal, saveJournal, todayKey, initJournal, getJournal,
  recordLesson, recordSeparators, recordRaceTime, resetJournal,
  // audio-cues: qué suena y cada cuánto (núcleo puro del sonido)
  cueForRung, clampReminderSeconds, formatIntervalLabel, canPlayReminder,
  reminderAction, notifyReminder,
  SOUND_CUE_IDS, RUNG_CUES, SATISFYING_CUES,
  REMINDER_MIN_SECONDS, REMINDER_MAX_SECONDS, REMINDER_DEFAULT_SECONDS, REMINDER_IDLE_MS,
  // fix-crono-contrast: par superficie/dígito legible del contador
  cronoTextColor, hexLuminance,
  // calm-canvas-grayscale: rampa de grises de la presentacion calmada
  calmGreyFor, shadeGrey,
  // seg-skin-earned-at-close: el tono dormido del tramo que llena
  dormantTone, LEGENDARY_ANCHOR, DORMANT_DESAT,
  // lesson-only-overlay + lesson-bar-container-anchor: detection
  isLessonScreen, isLessonBar, findLessonBarByAnchor, findBarBySignature,
};

// Punto de enganche para tests. INERTE salvo que el arnés defina este global
// ANTES de inyectar el script: en un userscript manager nunca se define, asi que
// la rama no se ejecuta y el archivo se comporta igual que sin esta linea. Es lo
// que permite testear ESTE archivo (el que se instala) sin mantener una copia
// "dev" que se desincroniza. Vive a nivel de modulo, junto a CORE, y no dentro
// del IIFE browser-only: el arnés evalua el script sin window/document, asi que
// el guard de navegador no corre y este enganche tiene que ser alcanzable.
// Ver openspec/changes/test-published-file-ci/design.md (decision 1).
if (typeof globalThis !== 'undefined' && globalThis.__ADHD_TEST__) {
  globalThis.__ADHD_TEST__(CORE);
}

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
// Los 3 modulos se auto-registran en `window` al cargarse, asi que el bloque
// entero va dentro del guard browser-only: Node tiene que poder importar el
// dev file para los tests (regla DESIGN.md: no romper el guard typeof window).
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
// ==== REWARD FX (reward-fx-canvas) =============================================
// Effects de recompensa por jerarquia, disparados al cerrar un tramo.
// Playground canvas 2D, sin dependencias externas, overlay a pantalla completa
// (position:fixed; inset:0) con pointer-events:none, DPR limitado a 2 y
// limpieza propia. Los 3 respetan prefers-reduced-motion por defecto.
//
//   Racha   -> streak-flames.js  (StreakFlames)
//   Diamante-> crystal-reward.js  (CrystalReward)
//   Super   -> duo-reward.js      (DuoReward)
//
// CODIGO DE TERCEROS: entra casi verbatim, con parches locales acotados y
// marcados. Cada modulo se expone como clase en el isolated world del sandbox
// (window.<Clase>), que es lo que necesita playRewardFx().
//
// Parches locales (fix-reward-fx-static-and-duo-crash), todos marcados en el
// codigo con ese tag:
//   1. La opcion es `reduced`, no `respectReducedMotion`. El modulo viejo la
//      combinaba con AND contra su propia consulta a matchMedia, asi que el
//      override 'never' del usuario se perdia en un sistema sin preferencia:
//      el <body> quedaba calmado y el canvas se animaba igual.
//   2. El tiempo transcurrido se clampa en 0 y el pedido del siguiente frame va
//      en un finally. El timestamp de rAF es el instante en que el frame empezo:
//      un burst disparado desde una tarea puede recibir un frame mas viejo que
//      el, el radio de la onda de choque se volvia negativo y Chromium lanzaba
//      IndexSizeError DENTRO del callback, sin reposicionar nunca el frame
//      siguiente: el efecto moria en silencio.
//   3. En Duo, la rotacion de los sprites y el pulso de las estrellas quedan bajo
//      el flag de calma, para que la version calmada este de verdad quieta.
//
// El CI diffea los tres modulos contra los zips de referencia del repo
// (streak-llamas.zip, diamantes-orbita.zip, animationFXSuper.zip) e imprime la
// divergencia: la diferencia tiene que ser la de estos parches y nada mas.
// Nota de marca: el sprite de Duo es el personaje de Duolingo recortado de una
// imagen aportada por el usuario; el repo es publico.

/* >>> streak-flames.js (llamas vectoriales (18; 4 en calma), naranja/amarillo, peldaño Racha) — vendored, parches locales <<< */
/* StreakFlames — animated vector flames, transparent Canvas 2D */
(()=>{
'use strict';
const TAU=Math.PI*2,clamp=(x,a=0,b=1)=>Math.max(a,Math.min(b,x)),rand=(a,b)=>a+Math.random()*(b-a),ease=t=>1-Math.pow(1-clamp(t),3);
const ORANGE='#EF9B38',YELLOW='#F7CA45';
// Normalized paths redrawn from the supplied streak flame, not a bitmap.
function flame(ctx,width,time,seed=0,motion=1,cols){
 // calm-canvas-grayscale: paleta opcional [exterior, nucleo]. Default: los
 // naranjas de siempre (el camino animado queda byte-identico en
 // comportamiento). En calma el draw pasa dos grises del ramp de racha.
 const C = cols || [ORANGE, YELLOW];
 const t=time,phase=seed;
 ctx.save();ctx.scale(width/340,width/340);ctx.translate(-170,-200);
 const wave=Math.sin(t*4.2+phase)*.72+Math.sin(t*7.1+phase*1.7)*.28;
 const wave2=Math.sin(t*5.6+phase+1.2);
 // The base stays stable. Height-dependent displacement bends only the
 // upper flame and control points; this is shape morphing, not rotation.
 function warp(x,y,inner=false){
  const height=clamp((415-y)/430),bend=inner?wave2:wave;
  const travel=Math.sin(t*5.8-height*5.0+phase);
  const taper=1+(Math.sin(t*4.7+phase+height*2)*.095)*height*motion;
  const stretch=Math.sin(t*(inner?5.6:4.2)+phase+.5);
  return [170+(x-170)*taper+(bend*Math.pow(height,1.5)*(inner?78:100)+travel*height*(1-height)*72)*motion,
          y-Math.pow(height,1.6)*stretch*(inner?74:66)*motion];
 }
 function path(commands,fill,inner=false){
  ctx.beginPath();
  for(const cmd of commands){const [type,...coords]=cmd;if(type==='Z'){ctx.closePath();continue;}const a=[];for(let i=0;i<coords.length;i+=2)a.push(...warp(coords[i],coords[i+1],inner));
   if(type==='M')ctx.moveTo(...a);else if(type==='L')ctx.lineTo(...a);else if(type==='Q')ctx.quadraticCurveTo(...a);else ctx.bezierCurveTo(...a);
  }ctx.fillStyle=fill;ctx.fill();
 }
 // Asymmetric shoulder, high rounded tip, broad rounded lower body.
 path([
  ['M',0,98],['C',0,66,19,55,44,69],['L',83,89],
  ['L',143,14],['C',158,-6,180,-7,196,14],
  ['L',291,135],['C',322,176,340,211,340,253],
  ['C',340,346,268,415,173,415],
  ['C',76,415,0,349,0,254],['L',0,98],['Z']
 ],C[0]);
 // A separate warm-yellow core, independently morphing in place.
 path([
  ['M',155,184],['C',164,169,178,167,189,184],
  ['L',226,237],['C',244,257,249,278,239,304],
  ['C',229,337,201,354,171,353],
  ['C',137,353,109,338,100,311],
  ['C',90,286,97,264,112,243],['L',155,184],['Z']
 ],C[1],true);
 // Successive drops peel off, drift upwards and disappear. They stay orange
 // and retain the reference teardrop shape, rather than becoming glitter.
 for(let k=0;k<(motion?2:1);k++){
  const age=motion?((t*(k?.71:.88)+phase/TAU+k*.5)%1):.20;
  const fade=motion?Math.sin(Math.PI*age):1;
  const px=65+Math.sin(t*3.7+phase+k)*21*motion+wave*14*motion;
  const py=-7-age*94*motion;
  const sz=(1-age*.65)*(k?.65:1);
  ctx.save();ctx.globalAlpha*=fade;ctx.translate(px,py);ctx.scale(sz,sz);
  ctx.beginPath();ctx.moveTo(0,-28);ctx.bezierCurveTo(12,-23,35,3,26,18);
  ctx.bezierCurveTo(21,30,-3,30,-10,17);ctx.bezierCurveTo(-17,6,-7,-19,0,-28);
  ctx.closePath();ctx.fillStyle=C[0];ctx.fill();ctx.restore();
 }
 ctx.restore();
}
class StreakFlames{
 constructor({canvas,count=18,duration=6000,reduced=false}={}){
  this.canvas=canvas||document.createElement('canvas');this.owned=!canvas;this.count=count;this.duration=duration;this.frame=0;this.run=null;this.dead=false;
  // fix-reward-fx-static-and-duo-crash (parche local): la decision de calma la
  // toma el script, que ya la resolvio para el <body> y para los tres modulos.
  // Antes este modulo la Volvía a consultar con matchMedia y la combinaba con
  // AND: el override 'never' del usuario se perdia en un sistema sin preferencia.
  this.reduced=reduced===true;
  if(this.owned){Object.assign(this.canvas.style,{position:'fixed',inset:0,width:'100%',height:'100%',pointerEvents:'none',zIndex:9999,background:'transparent'});this.canvas.setAttribute('aria-hidden','true');document.body.appendChild(this.canvas);}
  this.ctx=this.canvas.getContext('2d',{alpha:true});this.resize=()=>{const b=this.canvas.getBoundingClientRect();this.w=b.width;this.h=b.height;const d=Math.min(devicePixelRatio||1,2);this.canvas.width=Math.round(b.width*d);this.canvas.height=Math.round(b.height*d);this.ctx.setTransform(d,0,0,d,0,0);};
  this.observer=new ResizeObserver(this.resize);this.observer.observe(this.canvas);this.resize();this.tick=this.tick.bind(this);
 }
 start({count=this.count,duration=this.duration,loop=true}={}){
  if(this.dead)return;this.clear();const n=Math.max(1,Math.round(count)),cols=Math.ceil(Math.sqrt(n*this.w/this.h*1.25)),rows=Math.ceil(n/cols),particles=[];
  for(let i=0;i<n;i++){const row=Math.floor(i/cols),col=i%cols,last=Math.min(cols,n-row*cols);particles.push({nx:(col+.5+(cols-last)/2+rand(-.10,.10))/cols,ny:(row+.5+rand(-.08,.08))/rows,seed:rand(0,TAU),rate:rand(.80,1.18),scale:rand(.82,1.05),delay:this.reduced?0:row*.035+col*.022});}
  this.run={start:performance.now(),duration:Math.max(1500,duration),loop,particles,cols,rows};this.frame=requestAnimationFrame(this.tick);
 }
 burst(options={}){this.start({...options,loop:false});}
 draw(r,ms){
  const t=ms/1000,c=this.ctx,mx=Math.max(16,this.w*.025),top=Math.max(85,this.h*.13),bottom=Math.max(130,this.h*.15),w=this.w-2*mx,h=Math.max(80,this.h-top-bottom);
  const base=Math.min(w/r.cols*.72,h/r.rows*.57,102);
  for(const p of r.particles){
   const age=t-p.delay;if(age<0)continue;
   const entry=ease(age/(this.reduced?.18:.5));
   const exit=r.loop?1:1-ease((ms-(r.duration-700))/700);if(exit<=0)continue;
   const breath=this.reduced?0:Math.sin(t*p.rate*4.2+p.seed)*.045;
   const x=mx+p.nx*w,y=top+p.ny*h+(this.reduced?0:Math.sin(t*1.2+p.seed)*1.7);
   c.save();c.globalAlpha=entry*exit;c.translate(x,y+(1-entry)*13);
   c.scale(1-breath,1+breath);
   // calm-canvas-grayscale: este efecto sirve al peldano racha (3) y nada mas
   // (FX_BY_RUNG). En calma la paleta naranja se cambia por dos grises del
   // ramp: exterior oscuro + nucleo en el valor asignado. Sin calma, undefined
   // y flame() usa sus naranjas: el camino animado no cambia.
   const G3 = this.reduced ? calmGreyFor(3) : null;
   flame(c,base*p.scale*(.80+.20*entry),t*p.rate,p.seed,this.reduced?0:1,
     G3 ? [shadeGrey(G3, 0.55), G3] : undefined);
   c.restore();
  }
 }
 tick(now){
  const r=this.run;
  // fix-reward-fx-static-and-duo-crash (parche local): el timestamp del frame es
  // el instante en que el frame empezo, asi que puede ser ANTERIOR al burst si
  // el burst salio de una tarea de ese mismo frame. El tiempo transcurrido se
  // clampa en 0 y el siguiente frame se agenda en un finally, para que un frame
  // que no se puede dibujar no corte el efecto.
  const ms=r?Math.max(0,now-r.start):0;
  this.ctx.clearRect(0,0,this.w,this.h);
  if(!r||(!r.loop&&ms>=r.duration)){this.frame=0;this.run=null;return;}
  // Static presentation for reduced motion in loop mode after the entrance.
  const still=this.reduced&&r.loop&&ms>650;
  try{this.draw(r,ms);}finally{if(still)this.frame=0;else this.frame=requestAnimationFrame(this.tick);}
 }
 clear(){cancelAnimationFrame(this.frame);this.frame=0;this.run=null;this.ctx.clearRect(0,0,this.w,this.h);}
 destroy(){this.dead=true;this.clear();this.observer.disconnect();if(this.owned)this.canvas.remove();}
}
window.StreakFlames=StreakFlames;
})();
/* <<< fin streak-flames.js <<< */

/* >>> crystal-reward.js (cristales 3D facetados (24; 4 en calma, 33 vertices / 57 caras), peldaño Diamante) — vendored, parches locales <<< */
/* CrystalReward: faceted 3D meshes rendered on a transparent 2D canvas. */
(()=>{
'use strict';
const TAU=Math.PI*2,clamp=(x,a=0,b=1)=>Math.max(a,Math.min(b,x)),rand=(a,b)=>a+Math.random()*(b-a),ease=x=>1-Math.pow(1-clamp(x),3);
const V=[],F=[];
// 4 octagonal rings plus the culet: 33 vertices, 57 individually lit facets.
for(const [r,y] of [[.27,-.38],[.50,-.10],[.50,-.025],[.255,.32]])for(let i=0;i<8;i++){const a=i*TAU/8+Math.PI/8;V.push([Math.cos(a)*r,y,Math.sin(a)*r]);}
V.push([0,.68,0]);F.push([0,1,2,3,4,5,6,7]);
for(let j=0;j<3;j++)for(let i=0;i<8;i++){const n=(i+1)%8,a=j*8,b=a+8;F.push([a+i,a+n,b+n],[a+i,b+n,b+i]);}
for(let i=0;i<8;i++)F.push([24+i,24+(i+1)%8,32]);
const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const norm=v=>{const d=Math.hypot(...v)||1;return v.map(x=>x/d)};
function rot([x,y,z],ax,ay,az){let c=Math.cos(ay),s=Math.sin(ay);[x,z]=[x*c+z*s,-x*s+z*c];c=Math.cos(ax);s=Math.sin(ax);[y,z]=[y*c-z*s,y*s+z*c];c=Math.cos(az);s=Math.sin(az);return [x*c-y*s,x*s+y*c,z];}
function crystal(ctx,size,ax,ay,az,time,anchor){
 // calm-canvas-grayscale: anchor es el gris asignado al peldano de este efecto
 // (el del diamante) o null. Con anchor, el tono se va (sat 0) y la
 // luz de las facetas se centra en la claridad del anchor en vez de recorrer
 // 17-99%: el juego de facetas sigue, pero en grises de ese peldano.
 const pts=V.map(v=>rot(v,ax,ay,az));
 const key=norm([-.75+Math.sin(time*.5)*.2,-.95,1.3]);
 const fill=norm([.85,.12,.55]),half=norm([key[0],key[1],key[2]+1]);
 const faces=F.map((ids,index)=>({ids,index,z:ids.reduce((s,i)=>s+pts[i][2],0)/ids.length})).sort((a,b)=>a.z-b.z);
 ctx.save();ctx.scale(size,size);ctx.lineJoin='round';
 for(const face of faces){
  const p=face.ids.map(i=>pts[i]),a=p[0],b=p[1],c=p[2];
  const u=b.map((x,i)=>x-a[i]),v=c.map((x,i)=>x-a[i]);
  let n=norm([u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]]);
  const center=[0,1,2].map(i=>p.reduce((s,v)=>s+v[i],0)/p.length);
  if(dot(n,center)<0)n=n.map(x=>-x);
  const diffuse=clamp(dot(n,key)),secondary=clamp(dot(n,fill));
  const spec=Math.pow(clamp(dot(n,half)),28);
  // Environment reflection gives each cut a moving icy/white band.
  const reflection=[2*n[2]*n[0],2*n[2]*n[1],2*n[2]*n[2]-1];
  const band=Math.pow(clamp(.5+.5*Math.sin(Math.atan2(reflection[0],reflection[2])*3.5+reflection[1]*5)),10);
  const glint=clamp(spec*1.15+band*.33);
  const light=clamp(.12+diffuse*.52+secondary*.17+glint*.40);
  const hue=207-light*17,saturation=85-glint*65;
  // Con anchor: grises centrados en su claridad (canal/255 como proxy).
  // Sin anchor: los azulados de siempre.
  let lum=22+light*59+spec*16, sat=saturation, h= hue, stroke='rgba(206,248,255,';
  if (anchor) {
    const m = /^#([0-9a-fA-F]{2})/.exec(anchor);
    const base = m ? parseInt(m[1], 16) / 255 * 100 : 60;
    lum=clamp(base-30+light*60+spec*16,4,98); sat=0; h=0;
    const ch = Math.round(base / 100 * 255);
    stroke=`rgba(${ch},${ch},${ch},`;
  }
  ctx.fillStyle=`hsl(${h} ${clamp(sat,0,100)}% ${clamp(lum,4,99)}%)`;
  ctx.beginPath();p.forEach(([x,y,z],i)=>{const q=2.65/(2.65-z);i?ctx.lineTo(x*q,y*q):ctx.moveTo(x*q,y*q)});ctx.closePath();ctx.fill();
  ctx.lineWidth=.007;ctx.strokeStyle=`${stroke}${.13+diffuse*.26+spec*.35})`;ctx.stroke();
 }
 ctx.restore();
}
class CrystalReward{
 constructor({canvas,count=24,duration=6800,reduced=false}={}){
  this.owned=!canvas;this.canvas=canvas||document.createElement('canvas');this.count=count;this.duration=duration;this.frame=0;this.run=null;this.dead=false;
  // fix-reward-fx-static-and-duo-crash (parche local): ver StreakFlames. La
  // decision de calma llega resuelta desde el script, no se re-deriva aca.
  this.reduced=reduced===true;
  if(this.owned){Object.assign(this.canvas.style,{position:'fixed',inset:0,width:'100%',height:'100%',pointerEvents:'none',zIndex:9999,background:'transparent'});this.canvas.setAttribute('aria-hidden','true');document.body.appendChild(this.canvas);}
  this.ctx=this.canvas.getContext('2d',{alpha:true});this.resize=()=>{const b=this.canvas.getBoundingClientRect();this.w=b.width;this.h=b.height;const d=Math.min(devicePixelRatio||1,2);this.canvas.width=Math.round(b.width*d);this.canvas.height=Math.round(b.height*d);this.ctx.setTransform(d,0,0,d,0,0);};
  this.observer=new ResizeObserver(this.resize);this.observer.observe(this.canvas);this.resize();this.tick=this.tick.bind(this);
 }
 start({count=this.count,duration=this.duration,loop=true}={}){
  if(this.dead)return;this.clear();const n=Math.max(1,Math.round(count)),cols=Math.ceil(Math.sqrt(n*this.w/this.h*.9)),rows=Math.ceil(n/cols),particles=[];
  for(let i=0;i<n;i++){const row=Math.floor(i/cols),col=i%cols,last=Math.min(cols,n-row*cols);particles.push({nx:(col+.5+(cols-last)/2)/cols,ny:(row+.5)/rows,seed:rand(0,TAU),speed:rand(1.75,2.45)*(i%2?1:-1),pitch:rand(.40,.65),scale:rand(.88,1.03),delay:row*.065+col*.04});}
  this.run={start:performance.now(),particles,cols,rows,duration:Math.max(1500,duration),loop};this.frame=requestAnimationFrame(this.tick);
 }
 burst(options={}){this.start({...options,loop:false});}
 draw(r,ms){
  const t=ms/1000,c=this.ctx,mx=this.w*.045,top=Math.max(90,this.h*.13),bottom=Math.max(135,this.h*.17),w=this.w-2*mx,h=Math.max(80,this.h-top-bottom);
  const base=Math.min(w/r.cols*.65,h/r.rows*.64,108);
  const items=r.particles.map(p=>({...p,z:this.reduced?0:Math.sin(t*1.15+p.seed)*.65})).sort((a,b)=>a.z-b.z);
  for(const p of items){
   const age=t-p.delay;if(age<0)continue;
   const a=this.reduced?0:age,entry=ease(age/.7),fade=r.loop?1:1-ease((ms-(r.duration-800))/800);
   const growth=this.reduced?1:.70+.43*(.5+.5*Math.sin(a*2.3+p.seed));
   const perspective=3/(3-p.z*.55);
   const x=mx+p.nx*w+(this.reduced?0:Math.cos(a*1.15+p.seed)*base*.08),y=top+p.ny*h+(this.reduced?0:Math.sin(a*1.15+p.seed)*base*.08);
   c.save();c.translate(x,y);c.globalAlpha=clamp(age/.17)*fade;
   // calm-canvas-grayscale: este efecto sirve al peldano diamante (4) y nada
   // mas (FX_BY_RUNG). Sin anchor, los azulados de siempre.
   crystal(c,base*p.scale*growth*perspective*entry,-.35+a*p.pitch+Math.sin(a*1.2+p.seed)*.28,p.seed+a*p.speed,Math.sin(a*.9+p.seed)*.32,a,
     this.reduced ? calmGreyFor(4) : null);
   c.restore();
  }
 }
 tick(now){
  // fix-reward-fx-static-and-duo-crash (parche local): ver StreakFlames.tick.
  const r=this.run;const ms=r?Math.max(0,now-r.start):0;
  this.ctx.clearRect(0,0,this.w,this.h);
  if(!r||(!r.loop&&ms>=r.duration)){this.frame=0;this.run=null;return;}
  try{this.draw(r,ms);}finally{this.frame=requestAnimationFrame(this.tick);}
 }
 clear(){cancelAnimationFrame(this.frame);this.frame=0;this.run=null;this.ctx.clearRect(0,0,this.w,this.h);}
 destroy(){this.dead=true;this.clear();this.observer.disconnect();if(this.owned)this.canvas.remove();}
}
window.CrystalReward=CrystalReward;
})();
/* <<< fin crystal-reward.js <<< */

/* >>> duo-reward.js (lluvia de mini Duo (36 sprites + destellos + particulas; 5 en calma), peldaño Super) — vendored, parches locales <<< */
/* Duo Reward FX · Canvas 2D · no dependencies · transparent overlay */
(() => {
  'use strict';
  const SPRITE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAK8AAACWCAYAAACo59gQAABco0lEQVR4nO39ebxmV1Xnj7/X3md4hjvVPGQOGStMCioCIcRmFBVbvOWXphVs2qC2inb/bFvt9lZ9VdSmlXbobxscGLRF6yoOrUCIEAIJMguSVIDMU1VS052e6Zyz916/P/Z57r11a55DqM/rderWM51hn3XWXnutz1pLOI+nDFSRrWCmBQ/C5Cd1dQeubaX2Na3gX2LhWS6xY14MKCoGUfDe61eAL6mztw8Kbl0dNu5+z40PD1BkCmS7EM71tZ0JyLk+gfOImFLM9m3AdsJ//LvnrZ1tP/Y9g4l9PxTG5XKtpJ0PXBNH7owxKubgHwulWAqxpq8+mdGe3iauuvnK6oV3bb/xdje5Azs9SUDQc3FtZwrnhfcpgMkd2Omt+KkpzO6XXPhik4ZfLUdnvrVsDLJgM7QEWzlEA14NK4VXDIgFMQZRQYPHmLC3nEv+dydPf/fvn9/ZN6WY7aBPJwE+L7znGJOKnRb8v71lQ1vGZn40HeU/B9H1pXPqgwkaDEYRJIgIAubQnSiqCgpKQMUiNvemUvUD5ZPpwsh/+asXLXzy6aaBzwvvOcQNt5HcfiPujbeNT5jM/bof8W9yacgHZfDGG7FGDRIwAcAQlt0tc1jxM6gKPqDO+EDqJG+oybrmgeRA9sN//K8GH68flgBf/wJ8mMf4PM4GhoJ7020ja2nMvd3k5U0SNHM99UkQa0xtGyggAcQBDo669gqIllhTirXBSgV0cKYRLg9rine98aOrXjQt+MkdT4/7fl7znm0ocsPHsLffiHvLBzdc6ibmf4+8eo04CeogpMF4CTgxqEAQAzjMUNUGAU04nBBb9SQhfqU08a8JKODzliRVJ/9StzP+vX9745MPTSnm690L8bR4Ar9uoMgkmNtvxP3QR8aeMZiYeS8j7jUuSFCHWMHYELABEg2IRvPAAKJL21EhS983ATAIAVsO1IVm+RzG5n/hBZ+8sLkddGrq6/v+f12f/NcVasGdFvy//cTEc2hV75W2u74qvQ8hiEuDFEmgMqbWtgYD2AA2GIwH4+OuRA+vMIMIFVAxNGglKmiDqEc8qrbhf+Dijr0REWXbmb/sM4nzwnsWMDWFmQKZFuN/+MMTN8jY3LSMDV5YFcH7IEYt4g14Aypxg1rrKphgABs3PfItUwxeBC/CkkU4/L/Y4DSI+LF0pP8TP3vHt49uF8LkDuwZvfgziORcn8DTHZM7sNsnCYjy5o+u+4Ew2n27SbjI9dSjGLGISBQ01VpfHmQahEVhPghyBHP1SGaFgHEgWVAZnf+WJ5744hXAP5/kZT0lcH7BduYgN9wWF2a/uWOyec/ER9/o1868TTNdVfbVGcUiCMYSZbZ+Y5nwiciiQMfF29IyTc3hhfcIFkX9mSoZYPCh4LcXxvjFD11J+fUaQj5vNpwJ6JLg3nTbprUPrLrjHTJe/pZDVlU9vIEEQVQhBE8IgeAD3nsIHqMBowEJHlvrl6AeCLXb7OTkTCwijiCWxDXMK3yvPY6gO6fPshJTZGoKg57acc9r3tOMKcXsnEamt+K/9w6e0UqT384Mr/GCOkewxtuhelUFFWHVqgkQmD0wi3FKKoARfFBUBWNBreBqtapGDm9KcHTNiyiieG1iXchmZfelr59++X0fQoOpo25nNHAxHJstd6Pbt6FTIDunkS2T6Mlo/vPCe/ogkzsww/Draz/VuF7y6nfTVJ+jhQbxihWMldqNRTQBRidGWbNqDQrMHjhAMdchuAAmEhHKUhmfaJK3mvQGAzr9Pmo4ovD6WvyWu4WHMAoEFIOmYqWx57I/Hpn/rp98x9Z3DKb0DJoOikxOY6a34odvPe9zpJ9/PtXw9dQUZvv2Ezv++QXbacDUFGbnNmRa8Dd9blNr/z/tfoPkg1+S3FzoCjyKSSyLoiECwUOSJKwbnyDBoKpsGF/NrBcW5uej1hWl2UyYGBunNdIi7XUZDApc8IipVeUKIbYY/FFlIJHUVsEMjMkmOjcs7L1zDfDYzukzY0JOadzv9q34t/71DRNzI/9yUXd05pkVyZUXflY/J/P+q+u7m3Zv/57dPbT2Sh8nzmveU8FQo0yiCOGNH8wvDWPyi2G0+DcqtHyJQ7GRUBMNPKNDzSusHRtl9egYdsg0EKHvSjrdBebne3gsF124kTRJ8HiCQKfbZ667QFmVMXR2yClFiJFDPtBgaIwru28f03/53QvkW35mT+8ZN/ifeMdlP/keprbDttPIOlvyawdAf/hDFzyHlvyqmZj71opuXjlpmAa9ROlXs+k/ZK75/777hplHmcJwnBr4vPCeDGqSN8B2IeyY3GFvv+lHri8m5n+rSvmmKqAa1Z9dcrfqouAK0M4z1k2somUsSYjvB4ESpdTA3Nw8g0HBBZsvQKzFhxIRQ0Do9HvMd+cYlI6iBCRqc1N7JERqmmTtghuKY9KCB/9qHXe9cyPVgujoZaU8/5ce+ZsfeW33Dd8j9E5XyHhR2wrh396yoV21nnytbSe/YlJ7GeqRoKhHJUGktp98qbcnndE3vefGuYeO14Q4bzYcP2RqCtl5HbKFpQXGmz60+aKPylv/Pav0xzWxa50LIQRFzJGd/4LQbDbJ8xwqj2pAainXoCTWMjYyQmotio+RtkUOrzDaaGMIzGsHGwLeKwFFg2IXhVdqbQsmBZspX/qdC7j3z9eRtj3ZeKD3eKZfeNvF/+rtX+1eA4984ZS9DvVMtN3gUXjNx9Ze6fP57cmIfA+4tqucxxmMxrkIh6IEkyE2Nzf4UL1t8rZ1N21/6d7uFMcW4K9H4RUUprbVmm/7Yae5k5n6Fm+cKmzbhrBtip3TOwWmqVfECgRBeONtF0/0s32vkvTAz1cSrgvG2KowXlEjiR5x8g0Bmq2URqOBkUW1vOjPNaJ4VdIkIRkZwSAQlnxKNvJ2aaYtkpEEWQs2CVTqKKuKol9SdD3FIH4/bSpV1/LpX7mIxz46QTbm0BjGE0wIg33ZaP+R8AOq+s8ioihyMqbDctv27e99efszF9/z2nLDnu1O3RWmUtThJWCMRRY9fQYQTKhwxqrSLl5R9npXIHxx53Ew374+zIZ6mt5J1Hpsg+3b4gBPHeYadk4jTJ7A/qdhy2Tc3/bhEYGVN/EFn6S5Ttpjo8XoS0Jr4c22MXhh5s0olWrlVTEYNYFgFBNWnJZoDEYEmBhtsmbVBK0kxZQ+2rxBUQFn4sGHwgymDlYEVA0aFJND1lK8E3Z/xbDnK5bufnClp725YOKKPs31fVxwzD6ScecvX8r+nS2ycYd6QWwU6Hzch2/974/I2i3Vx/v/kn7f9Nb5A8OsjuMeuxWehDd9eO2VWZJtH6ya/55+3m2XTgNOSCUS42wk1x+8CyWYBKlsUvSq7Ocbz1v43elhPOYoD9JTWvNOTWF2XofsiJyTZVOIcPPm308B3vKWH60O/eUpKV5uvun301Uv2yWf/Zt/zn13Lj/Q6jbD2Oy1fbPrO0M++A432r/UBB1FlarCizeGRI0SomvqCH4sA1gr5GmGFUFDPM+hnQpgtN4HUZgJgnrBppC1AijMPG64+86EnbckPPJZoTcTUIUkadAe30RjvOKS73iSdc+s+OTvrKP7ZHqQ4JYLCWuu7fHNP/eojj57YFzHXMe6/sXAgRMZsSErbftW/Mtv2dBuTex9rc9ntxfIFQ6H9NWLiDEWMUGxGq9vZWxMQNSjItKwIi96/M41f8SL9y8spi4d8449lbC0il9MWXnjPzNRHWiMN/z6K9Tn65PEXK0qqvjPqlZOMRbAqNcq6e8q3PxMmYtC/6iHygokTyZW5b59gSf1lUqWmcZzRNKmIJer8ZfbsXKzlwOjg9AZ863KKB4GEowHtRg1BkK8IfEZC4dmOsQAAa1GxurxcVpZRqqCCYqESPsCCBLQAFUIGCvkbUuWQGe/8NBnLXd/KOH+TxpmHlNElMaopTnSotUeI2+0MMYSKuHR+x7Ch4Ks1cBkgtYLxWLBsun6eV74Cw9jmz70fCKamkp78ms8XLxtepJqahtyVHtzeH9+YGjbZldmrbDdjrjvSUPaZqDBqwOLCSIYlKwmGQUlmi0rdxnwScta55P7Oh254e9e3N91rFngKad5h0/b9Fb8T37gJ/P9f/8XFzC+78aqDFuzTdUW7/a0gzdJFaSBBkyivTpQhZcoPGK0zAxlpsTMxBrCEulFlr2pYSEr/EKuiCpGBi5tBs2MiiSJ9STGIb7CBK9uELxHJFFEDBJECYR6h6bm0g5DEBHDBDMjQiNNSQAJvl5qC4boxgpBCRgaowntTOkvBB77nOWeDyd89WOGPfeBqwKNNkxsbNJqjZHlbZIkjaZGCDHcjGH9RSPMzfQpih4mNAnB4AvDtW/Yw5abdpNUSuiLMSlercnI9Xv9Rv4Xwt6j2ZtTU0sRxJ/ZMdnctf6Ofx1W792u1l0hHnwRvARjTCJSkzaixmUpMHM4KIiopyGyqrGw7hLo7zqWrDylhHdyB3a74KcU85WPrLt8nvf/eDbaf13IZF1Q29IAShVpqkZVCWBkHOpBERYd97ro51xSgUaXhHZRMyrDMUbq1YoXpyIFGgjOeQ1BUUUEEUStlfibxXXH0Jgl1IJb71p1cd8AmTWMmIymGpKh9nFRG2VpStIQ+r2SAw80uPfjli99oOKxu6DoBNKm0l6V0WyP0shHSdIcESFoIIQQfcgiVF6xSeDdb381rizZ+mPTDMqCrNHiRT+xl2e8dhe9+fgQawISFMFDxkVpselqeGLvlkk9dKoeehLibBjeeNv4pbPy8V9ojHdf742O+AKvHgFvMboY6jPEGcdL9ElHDpIeds73HlQly8guAvNPWybDUReQTxnhHWbRvuEDq8fu+eT8j+SrZ/6DV3uJsWo0GEIVQijRYcAzmHj3XR3wX351QdAjmUpDAV4kZS0N4pJTVBQ0iAVBxDDk2Q73efCf+sfDV0s2nUjkJwCkFvI8JbMpqVqCA5sojdGAiDL7uPC1TyR8+UMNHv5CYGGfI0mhOZYyvmacRnOULG0gxtaLt7AoAwqUIVCpZ2FQsX5Ng8svGGXzxjFe87Irefe7v8wrf1Z52U+W3P9li1UPJsqXCMaXPiAykebyxp/Z8f2f3y7T/eU+3+XadmrHluy+T+18uUvnftWaznNQhb46G8RikRB0BcGiTsU7KumCegZEFRqS2C033/y/07fwFje1DTmS3fuUEN6h4P7grasulmb1G6Zlvk+SkIXSB1fga3e7YDHDy7C1qIXaQbr8QY5fZunOLv1Z/J7W1sRyDXwQlhxnJ3QtcX9LN2p4CtYkNPMWSWpIW5BlQmefsvPOlLtuSbjvDsOBxxSRQGPUsu6iMRrNUfKshbFJrcUDGvwivdxpoPCBInh8nJbIMssju7v8+Ycf5I3fcyVP7O2S5IbH/0UoF1JaYzlz8714roCVIMFpsG1jw/jsjbvN368C+rXPVyZ3LGnbH7y1cfEDrft/2rbkhwWd8KUPwYMxkkTb5zgG6AirLImTgFpIReTa+zb8QwNhAUWGLqCVOOfCWz/h/gc+sO4ZOjL/x6alLwleQ+iJVzBR79U4zOCsXBiFANbUpoDWq/gVA3aQF+uM8qhqDoOF9ljK+IYU2xUe/oLhK7emfOU2y557wZWBfESY2NCk2R4lz0dIkhSQSJcMLhrYIvgQKEOg8J5KA6pKLOgQn9gQlFYz4dffcxd/8P6v8OjXHmNkTcrDn4NdX05Y/5wmnV6Jcz5GpAFREbwSbLFeDS8CpvfcjUxqTFua2jGVPXLb77+iHN33K9aGZxNUfIXXgDFWTl8VCI1LFBHGS5VjZnicU+EdTk0/8MH80nSk+y7T4npXBa9eRcyicl2Gw089B2UeBEhTQVXo9xVjFGPALFuCnE4GyiHnWJ+MhPgA5W3IUqH3eINP/2XO/bemPP5lYdAJZCvt2CyPBl5tx1Iv6lSEfjGgCIoTCIsCuywEvAzD4MeTc45Gu00oO7iB5csftLz8m4XVq9aw98B+1DtqmRdfSMDKqEns1jd8avyWP/22Awsi6A/euuriR9M/+mkZr96UJOkqX7qgQVUkWEnq0Vx2ChJW3iM5+O8RM0glGg5GECObQr4/Bdg5PSkwfdhfnDPhHXoVbvocrV5VvM02k+tdYZyqGDGHS9Q6uuCKRK0L0MobjI6OEgJ05ucYDEpKNzR266n8TDoJNR4nbcGu29s89H9Xs+/LGd19YFKlNZYcbMdaG32+qqh61If4tLXHGLiKhdkDrLrqGtz+fZQH9mGTdFkQ48jIEoNvtNBBh6QJ933M8qIfS2mOpDS7Oa7r4gxlEfUE21BMyosGe7rrt0Fv62fsq13W++VA/9kiCIV6DXLUCOLJYnj/xApJw6zuP1bmx/rNuRFeRdgGbBftfyL/XjNSvdY4CYkz4hN/+GIwx4CEOllRhEbeYGJklMRaRhsNOp0OC90uRVnigkaaU21SrAyEnSqGcidW+OI71nLv9DjBKfmoYfWFLZqtsSU7tuYjqKsQoCorNM2xq9dBawQaLfqP3IskCWsuv4JdMzMceSl6KDQETNYAk5LkjgMPGB77XMp13wntZpuFbr/mVQCioiEQcCM0deuXvyir7Lh5s5OwSgc+2BK1ItZYjsF4P0UM8/1bx/7qORHeyWnM9u34196ml+pYNSViWm6At9bbo1eEORRak7vVxL+pERIRXFkRtCK3Ccn4OCPtNp1el86gYFCVlGVVsxBlKRw7tJNPwa5QwOTwhV9bwwPvX83Y5pTWSjtWA8G7JSHIcqokZ8O3P5dKDLNP7Inh4mJANT/H6KYLcIMBvX17MUkCx6F1F2EMptFC+3OEAF/5kOVZr3a0W03SzOJcGF6zCaUi+LYdkV9UpaE+GF/hjVeDRdBwhqesIY7v+s6+8GoM925VrHwqeZ2KXuac02CNOBNpfUcOrsYIVHwVx3JQKdZCngipETIM4hUqjxiDCxWYyE0cabVJsoxBVUYbsiqpvMZFkUaf+tAvOcQhFIUjXFZQUC9kY8pDfzPK3o9eziXPGsHaxiF2LAA2QZsjaGsMWm2C83zT67+fiY3r+etf/FUqX1H2FvBlSXvDRvqzMwRXkSSN4zIZlsZbsY0WVW+etKk8+E+GmYdhZBOMj4xQzs9ShbguCFLHUry2rKK+8CGt2XESZTyG1A7CigDYITb4EWzgFbZvHQk/oSJqZz0Bc3IaI4LyCVbbRvhBCEkIGkISjK9rEx0PpJ72VSE48KVSDsKS+aBRwGPqi8YpVCFPUtqNJhOjY6waGaNhE1Kb0MgSGpklSexBlWkW93WsE1OQBIpZ4eH3b2TN5nXYJI9RL1ehzkWbttlG124kbL4UXX8BMjqGd56xtatYc+Emdt/zNXrz85jEUnXmsWlKY3wVvf17D151Hi9UkTRDkgybKnO7DfffackaSpo0SLL0kDEPJYEKkppMM7z2M+uYqdckcvzK/RxlDwstt+kqm9uLjDECImJMHS49PsQZXhlpCO2spgpWcaCHDHCzKICyyJe1CqkYGjZlpNFi8/qNrJtYRcOmUAWMU8RLrGnnQV3c8AcLsmitjWJMGmOhMabs+3yLma8Z1A4QNXFxmOXo6nWEzZegGy9Gx1ZDkkQtrAFflmy48hk0xkZ5/K574gNZVZSdefKJVdgso7c3mgwnpHUXh1swjRaEyADZeYvFl5A3UtqtFok9pN6vEXP4Saa2rM4ejsIOPKtmQwyxEm6++ffTz5rfeJkrzUjAKzVx+ngQvGJsnOJTY5kYaaE+4IqS4KJ2Ve9R55FGGu1KjVkMy2mkEInfqoHcpKStCUZzR98t4E2BqxRXxYWXSRVfQdEDiMwsETAZmFwZzEM5l+AXhCfvHEXxzOzbTXNkLUysprHp4sUBGJ7PkpoBMYYLnnktRafLE/c+QJLnlN153KDPmmdcRdGZp+r3sFl2YvbusoE3eQvfmSNrKo9+QXjyXmHt1UrLNVmwXaoyLM4eZ1U4D3+6x4WzKrzbQBDCzr/+s7ao+XYRyYLXIMiSBTQ0rg6DeFGRuG0RVo+OMdpsIiGQtAX1ngP799Pvd8myBMhqCt7yec8wjCcbLwSFRmbIxiD4hN1fS/jqh2HPV6E/C8Yq45dXrP/mLuu/eYAquEH0n/ceS3j0Ey0e/tAYIxs9Ixc6Hv77MbLxQNEfMCh207CWxnq/whYc2n1C8J7WxBgbr76CvQ8+wsKevSSNJv3OPCJCY/UaBgcOQO0VOCnBUkWSBMlycH16M5avfcSw+VmexKS4QTTXAoKpNcyRjyNLQ3nET4/nnA7+piKIBoJXXD8caDazAjiSixc4y8I7dDgnocxMwmZjwTu0JlYdF5ZzOqwYEgVRwaqAWlZNTKCqGGsoiwIxBltPiwbQ4fSfQHMEMMLM43DP/zXsvMXyyGczuvsUjJClKXmzTefuMR7+uwVGrnicLT88w7pv67P7n5p84mcuJAwEDBT7PQuPpCRNRQMxIgaEsqDqLpCNraqDAsvIFCKURcnm665mdO1qdv7j7fjKYZNoMqTtEfKRUfZ9dWftWjsFiGAbbdx8H5vBV241vODNHpsIzUZKKD0u1DPUuSDKqioG0aC4EJ4wha0AtkxOH/Gyz663obZf5vBZ3rAT2KhFzcpM16MiXstwIWYQUpW43BchyfK6KIfgg48RqBBna2Mga0KSQfcAfO2fLHffknDfHcLMI9GQzUcMqy5o02yNkjdaWJvEsKvPePQzXfZ/tcGGF/S45FULjF1UMf9ogs0gVMJgv8VmGoMlqkiSIsZSzM+Qja86wuUoF1x3Db5y7Lrnq9gso+p38IM+45dchq8qirlZxNqTMxmGCAGTN0ASsqZn907hsS8Jl7xAWTU+gZvZR6jcCajOM4MY7vYzmYwfM5vj3IWHT3AOXB4VGy7EFgk4RC0mRpChy0d9jFqJILnQbAlVV3j8i4ad/2i556OGJ+9VXBFojMD4hmYtsG2SJAMghIB3S9N1c0Ip+sLDfz/O/s+3SUe0DtHWzK5B1OxZK/qKNQTEGlyvgy8GmPRgm1W9J2+32Lzlag48tovZx58gyTK6B55AQ6C1Zj3F/CyhqkgaJ+giOxxsgskbaNmh6hvu+ZDh8us9rUabLJmjXzjOVc1IBTUGQbUyXr52xYWvGaB/J0crw3pOhNeVQfKoNI8bWv+z3D2ogBqLZ4nNpTUlzzYczZGAq1L23W+5/xMp93zY8tiXIsk7awTa45FXkDdGSNPGIfzYYciy1EC/KilLjxjIV3mKBaGYjwGO7n6hOaFccX0gb8PDnzUUHUG0IpQFkuaUnXmaa9ZHl5kIIkJVlKy/4jImNm/irls+QtnvkzWblAvzmDSjMTHB/vu+hhhzehZRCqbRxg26pE2473ZL54lANuJoJBkLDPCqK8zRY92klRbfSUbfFGzUPSWYh296/k3uJn0LbEO3P5VYZYkzKqg7ZpXvI2C537G2HggBEmtotKM7aHaX5b47c+76UMrDn7Es7A3Y1NMcS9lwSaQbpmkTcxR+bBE8pfd4VcQYktEJ3PyBaDcn4AoYWQsv/YmSq1/qWX9lYHSN8Lf/NeOj/yuhNQGh3yPJGlQLszRXr1uyeUUI3rF5y1WYxPL43V/F2ATX7+IGPdobNpE0m/T37UFONKp2RMTrAMEmSmcvdPcYGuOO3KY0UkNPjz/38rShHnS1Fkc6ECnuEUQnp59CaUBbiMb3BSPNzq7O/q/5PFwiIqJDvvzRUF/gYg0urwQf3Rd5G9IU+vvh3o8m3HWL4d474MAjiqI0RoU1F47SbI6S5W3sIq8gps2s5MeWweNUa9+eRJaWKtIaxXqH78yiwZDk8Lq3F2x5haM3I1QDGMzCda9w3PnuBA0GLfsQAm7Qxw16JI0WGuLDYrOMC667hoU9+9j/0CMkWUZvz15qbiMzD9yPr0rEnMa5fMgVNYIvhd6ssg4lTzOaeYNe0T19xzrucwIR1FtLL6Rz3bx46Hh+dm5sXnt16fXRh4NDo/DqYcKKK1BrxVDn+zSaQntNNCMe+5Lhqx82fPWjhie+FnCFJx8xh7Fjh2aBYxi28KqUwVP4sIIfy6HnpAHTaOG78wQPjRasvjjQ2Sf4KgYqqgFccF3gwmd7Hv6cJWt6QjlA8ibl/BxJsw0CvqwY37ietZddwoOf/SL9+Q5pI6fszGGzjP7MAXr790Uuw+mCCKEcLLGSRLE2agMBsjyHoibrnM2FW628QqX4oF9jU+jCUjmCI+GsRti2gTKF2fbdN/eD6KclpW+SyKs5nt+rglrI2pAO1vOl94zz3n+T8sf/j+Ujv608ea+nPZ6x8bJ1bLroEtasu5j2yGqsTSN/wVXRN6dCEQLzVclMMWDBVVS6lAd2xPs29CCkOTYNzD0h3HNLQmskRvWG3JWspVz3co93ceHm+93oFuvMod5jxOCrig1XXUHWbPD4XXeDCH7QI1QVIIgxmDQ9PQM/ZOUHj+93ohA7aK2CVZsVP4gF1ZppurQQOW7hDSs2s2I7rrNTSRCjoWiUg39cdflMRxXZdgy5OKvCK4JOXoeIiPbdvo9L6mclkeGTd1RoEJKW4mYTPv3Lm/mLyVFu+SXDw58JJJll/SUTbLrkItZuuITR8XUkWWMxbYYQo1raaKHrNjGPsuAda5/3bSTNVkxCPF5VI4JttCBAksLOWy1VXxaZaGKgHAhX3+hpr1G8M2hVoN7hywLX64IYxBgufu4zqQYFT977IEmWUizMHuzIPi12LtHsUKWa3QfeY6xQ9eHibwqMbwiEChIjJMZymLzVMw5VxSYiDbJOc370k9OC3zrkwBwFZ91sGE4FYdPCLt9NP2kS/X5i+c8j2r3BQzYS2Pe5Fp/avp7uE5Z8VFl9wcgKO5aaCOOiwBpDGZTQbJOuWQd5k+AdZf8BRjduJmu1cYN+XMQcr6AExeRNXMeSNpXH/sWy627Dhc92lL0Y6nUDWH954LJvCdz9YUtjxBOKPqY5QrEwSzo6RpLnfP6v/p77P/U5im4PUKrOwomdy2FRh54lsu7VuajRuwuoK0BMZM9Z4dveECN/gizOOHL08NppwFBf1uxArYPkajALE7uy3poHYOaE9nTWsJ3Y/2v6mdptza7f0fT5QmbFEA5/xzRA0lDm7k/55H/dSOiNsuHydWy48DJWr7mAZmscMYbgHerKYeFbdGwVYcOFPPc//DiXvfrVaJLGRdnCHKEsGdl4Ad29T+KK4vi1bjwjSBJM1sCYwKADO//RkGTDNPe4GCOFLa9ytSwJYdCL7rHuPMFViAgzj+3i/k9+FgBfDPBlcWzb/0jnRDxOrL2ihEEPN7OXav9u3Oy+ODbGYFPo7ofnbQ1c9oJA0YnBm+Hgn9hYnBqMAqoqCSZUeMr81menPzKLxurpx/z9WTjHgyHozusQEG08uf7OVmdiTx4MoqgEYbFVky55FEKAu/7XBYw1LmPz5RfSbq85xI7FGLQ9Rli/mXDBZbhV62ht3sRzv/tVXP2ib8UVUTDKhVlMktKYmKC3dw/mJH2optEiBEgbcM9HEnozsV6CECAJ9AfK5S8OTFyo+FJQV6KuIlQVVXcBk2YkeUbWatTnNbe0kDqh8awFVmIo2s0doNr3BNXsHkK/G0k5icGkcb/ze4RrXxb4zp8v8YUidbn0Yb+LYaOIpU0P3oaMuiNsh9rAB41avL9qMMPsAUVtikiqc84V73/rd/50McUxKvYs7e3sY2g6ZMlLZ6p++7aykiCoUAUVH5dvYpUkg+Z6Zc/nM+buWsPEpjbqleAr1FVLduyajZFuuOECGBlDjMEP+mx4xmUkacL9n/psTB33jrK7QGNiFcYm9GcPnJwPdVl6TZoHnrzX8PAXEvKW1lxzQ1nByAWBK673lP1IPfL9LmItvT276e9/MpLTjUV9oOqeiMkgda6RQV2F78xR7XsSd+BJfHce9Q5jDCY1iIGqD70DggbhX/2U4w3/X0XSiM/8ymflTGteQ6SlSuzuVddjg1DoV6pNu3eCcrylVs+Jq2y7EGLm8G8NXn/r376HMf2+LNHVUqoXg/UllLMJ/X0p3d05D7x/lF5ngSefnCXPcpojDUJrBNqjkOXDWGydpRBvrBjDhc+6lqLbY+/9D5HkDarOPL4Y0L7iKspuh6rXjVyIk7ExrcXmTXQwj6/grltSrr3Ro3WjPwsQlC2v8nxhOgGEUPRBJ1BX0d31CP18D83V6zBpRjiqyXCoHRv6fcKgFxeDIUShM4KtV1xVAVVPsDlsvEq59l85rnt5YPOzPWVP8CU1tVRjWL0+9pkU3lglcsjr05htnyNBbU8rfdf7ns9snZh7XGG6c8ZtiE+XhIVVfIVdjcfDvnz1/Fcb0n2swfxDDXpPZAwOJLiuRekxMgHb/8Oz+MLX5vjLzw9Yv2Ezvihq/5ljcaITIVSO1qoJNlx1BXsfeJj5PftIGg36C7OA0F67ns4Tu05tYaKKabSo+gukTeVrH0+Y3Z2QTwiuUiwg88o1zynYcEXCngcsSVYRigGm2Yp2elXS3f1o1P6HCM1QYGuhDZ4w6MWt7KPe1zUpag0L+Ar6C5Hwsfoi5arrHde9MnDJ8wKtcaUqhMF89Iwcjvevh6Stn36EYbAJQFARY0yR3+d68n+Rru7cgWHrU1p4p8z01u1h9cXP+v5Pvs5MSeKe4bqJhkqMhmgymFQxVsnHPLMHBrzkusv5kX/zXB5+dIZPfvVOOt0BWTqs5baCZliWbL70GkbXrubuWz+GqxxJ5qm6HbJ2m6TZondgP8bak5dfVSTNkSQlMRUzjxvu+1TKs76/ws8E2sGR9yo2jxZ824uFv/zKGFkDfH8B02wtRu84nNmyKLCBUBZRwxZ9gq+iXWkMJjGLjVmKhei3HVmnXPVSz3Wv9FzxAs/4RkXVUPahOyOIgLWHXAaLI+j1SOvmZed2jM+PksPjDVQGwJBWQdNUBcXZTuv9Y/d/3wHVdwonwMg8R8L7MUOMxk6YxD4zFCGYLIjNl5EL6v+oQrOZctdX9/DV+/dz5cUTrG0qezsdGmsmYuO9ZRCINMNnXoOrHE985V6SLKPsLuAGPcYvuQx1p4lmaASTtwi9WQDu+oDwza/15MGzyjvGJHBB4XndS+f4+/8zGotDF33c/AzJ2Kp61lhc58fsU42p8KEYmgXlYtQvFrqNY1L1o2nQGIXLXuC59pWOq24IrLs0JlO6rtCbFcRG8/h4IsxeYzPDM4VALLiHQGIIxmCVcP/AV3/yZ295ZzWz6sQKW58j4b29rnpt/in4ytXptR6pk3eDEJygzhCcYEzGngNdfvzn/45nXH0xX7p3hta6hMDEISv04D35SJvN117FzGO7OPDYLpIso7N/NxoCI+s30du/L2bi5qdIM6xNB9+dJ2sqD37WEO4uufKCAaudZR2B0Spw5TMLvu05fT72mRYTo1B15sBVmPZopEkiaPDooI8f9NByyY4VY+q8S6UqAlXfYDPYeAVccyNc84rAxusqkqZS9aHfkZiEaoh3V5aX/jtUcQ5fBolKMwRdcjWcZn+vIZAoBB9CZtUYGAz6/Ob7Xjb34NQUsSbaCeBc2bzRqSJhlyh7jbGbNChVJzrIk7anscbR2lgycVUf1w08/A9j3PmFx7j9C0+y5uKLqDrzBOcOWmCIMVT9AeuvuJCJCzbx5Q9+hGpQkLWEqtvBZDn52Dj7vnbPCSV7Hvkq6nBxlmOqPrMHUh78iPBdP1zRKhNWpZAo2Ab85s/u5fofupiigiw1uEEvLuBsssS9rMsvIQabJohAVTrKBUXEsvbClCteWHDtyzpc+s1N8omUKkBZpJQDD9ZHoT3eoneADz7aEhL5y2caJgQSVU0TMfSTu5OFxl8iC9HWPcFOROdSeGXukS/PTFz0rAc0aMc23KMXv3r2urXP6m9orR9oe1Mp6ZgjHYHeE5ZdH29hBw2MjdOq14DrdsjGJ5Y4soB3js1brsYYy667v4KxFtfr4vo9mmvWYBJL/8A+5GQzcVdCBJM30bKHTZQvfLzJ6u+fZ6ShJK0cnMP3Kp59XcHv/acn+fdv24gLSjuPka4QXL0fkNqO9R468328U9ZvHOdZNzS55ka49oZAa10X55WiX9Gf84g12ESHhdkXi7AMDUczfM2S9jVKzDQhUHpHlqdU3rFvdg6ngVMO8h1pqACj6m2KUc8sB9rb/uRVc/tPxMOwHOey0J4CNEbcG54Q2a1373Q/8iA3B8ebfYX6EtSJDPYJ+SrPuud3eezD46TtCoo+pjVKsTBDNj6xuMOgStrIueCZ17CwZy/7HnqUJM/o7dlH8I6xzRdRdrtUvR5JfpIussNeRXThG6vMzFjMAiRJhXYrxJdQQXcefvAV82zIPD/zBxvY+UhCapU8jT5g1bjoqgpojcKLXnINN373daz91j0kFzzCwO6n052nXAArGYLHphxUUCIIBxW3XjxFOdhcGAp2AIIRSlfRHfQpnItxhFMflcMPVVAlARVkMNB3ja6dvUVjTGTYaemEcM5LnD5xzz0PS/QImf/nH+0t2Wp+ABtGgyPEUg7Rr3LBDR0e+8cxILKvbGsU1+sQyjJmxgKuLBnfuIG1l17Mg5/5AoOFBdJm9O8mWc7C7sdZ2P34qXkZVkKIPmaNpVW7fcOgB2PNAcHFctTOReHpd+AV39bl09c8zp99fIz339nkvl0JvUrIcs/YanjmiwPf8uoNvOCGZzLr5/jiw/+EW1ggaeQ4HNaCikHUDJ1pizA1VfdIy/UAS8SbmmmW5CmdQZ/Z7kJcTJ2psFUMkwfTUOv6fFFL/uc7r6fadAqNC8+58ALykl/C3r4dl9vVd9jQecinxbOMxJWDGHA92PD8AeOXeBYes5i0iuFWTSk78zRWrwVVXFmx4arLyVpNHr/rHkBw/R6+HCBJwmAmNrsRe7oyEwCNPAIkptGPNAIjtkL7sdVUkoKpM5YTUXxPGMkDN72u4KbvgpknhCe8Z++mitl1gcHqjPkgfH7Xh5nrzVPYGSpKEj9KM29B5Y45wR4uA1iXmQ/D12oEb4T5fo/OwGPSOjp/BlSvKt42sUFlbznIf/pvrh88MmzjcLL7PEcVcw6CvpTIKbt0748foDf2YXXisRiNTDPUCc01jgte2MMNTB1q7SHGUC7MRPeSKjZNueSbnk1/bp4n73swFu9YmFvirSRJDAicrrtjLL7fRcsCY4WiFK65sKQ1orhCSMVgfEJmc1LJMTbD5Ama5FTzY3QONAkLjmblyKTJQjdn976Efb2CebeANJSkkZPmo6ANgss48QzJuIITsQRr0SRBEwtpSoGy98AsnUEBaTQhhvUGTyc0EEyKqKdwXf31v/n2wcenFLPjBL0LK/FUEF62bydMTmO2b91eVoX/P5KFAzaTGPWu/fW+hAuv78S6CDoMtYaoWYsBBCVvt2itmmDP/Q/ROTATV+ud+SXOwEF+1ZNFzSswhtDv4OcPLNYQU4GtL1qIM3JQqDy+CIS+IFUKvo34MVynyRMP9/nS53dxzz3z7N+b0tsVmNAxMtsgiK3vjEF8TqpNMlKkcnG/JwFPfMARIVjDwHsOdBaY73XjZ0Zi8uUpjs5KqBJMUldd7ufvzQ9suJlti4kqp3S4p4LZACyRdfyGfQ9pwX02kXW1+C6SS1Zd1WPtVSV77slIcreUmbswS3PdJnxZ8sH//rs0RtskaVqbDEWddHiyWMEr8I7QGxAGXbQYAIJNYKEnPO8ZBd/zogV0ILH+l82wkoO3aBUIgwYL+4VHH17gyb0Or200VKRdZaJT0epVPNFKQBNEBaMGoykqDkMRWV+Hq7vNsty++vVQOpYjQCyQ4h2znXk63c6i4B4zsnYyCKgYQpKbpOrrx1Ttf/vTVz7ZPVVzYYizLbxxNHWpd/BiXv7HbjA3fe52O2Po2oq/MpbnSUoWSoIIRoNgRz0XvrDDE/+yBmlA6HdJ8iblwhyNNRsAcEXBQq+HbTSouvNLQYwTujkreQWBUNS8gqK/2NQEMVgLZRm7/Wz7sRmSpiHMZwTfJmgT9ZbB/ID52QU6cz327/GEMI4NaxAVvBnQX+gytlrp759BJtZgTILxigmhLmtmMBIrp+gyLb8SoZ5IPfXcr4o1Bq2vR4yhcFFwF2rB5TQKrhl2t1ETu9Fa9UluEr+Q3SGVf/P7ru8+ecLtYY+C0ye8dSKPMmw6Hd9e7AO8vL/vtqXewSxOHbcv2j/f9xH+sjHKTwXPxVpXPTVAMYBN375A432rCM6g5QANHlcMcL0O2egE6h1qDeo95XKT4XgxFFhVtCpixGuwgldgLcYI3nm6C9BsG376FwY840WWXbsasDfwxOOBuX09glPEKfgUQhb7VZsmaDPW9CVQuR7dhQK/2lBVBQElNVF4g1hEDJ4E6j5vUXDr4dJh3WLqvwZVxQcfw8oJi5IeCMzMzzLX71J5X9tkB4+NnELxaAFSb1Bv1KcEm0miC3JH6tM3vuv63gM33EYyfSPupA+wAickvHVSnMCwGzowOc2WoY2/DWQbyvZ6OwQ17Q7h9zf/73TXql0y2LGzKa2eme91csferLPq8aRozG0pF3TWpHKxmFq8BfxAGH9GxcZnlzz8yZy0WREGfWx7jM7jD5FNrCEfX0PabFF1F6KX4bgiaUNeAagrj8ArMIiJFMKiX1EMHCOjLZ71goTX/3SPq54l3Lc/Z63vkRSGTq9Jd96iComxWMAaQcQT1IK39YyQELyl6HmqnlLsn6WSjGQ0w2RZtO9D9N+qGup+m7D47EeEenJRFGMMSZqAMVRViTFCf1Aw212g4wqK4GvzP7ohTxsLUg3Bm2AS1TRX6zuNT5hu+03vevmeB264jeT20yi4cJzCq4psnY7dN6NPbvsRv3vTd5PO3IUUs+TSxpoeWdknzZuNpD2//kqTkIvYTZ+St2+ymNyKPjsE007GudC2ilaWBiNiW6Gg5QOYWCMaHcaIrOXC6/s8fEeOGCEMutj2KBoC/X1PUMzso7FqbaT3qS6SXVZcEUe0Y8vD82NdCWU/kGSGS69cw8tf82yuf/V6Bms/SiUzPNFPaefg2zA+amg3LV4qijQhWFMXRtG64HXMIggiUXN6S9EHP6+MjEDP9ph1fVw7J22MkEvGiDFIUCortSKtzYdldd5UQLAEVaqqxIeAD4FOp8NgMIisrlr4hx1DDYfQQ04Osb1GME2Mqhrf8//QLJKfuPnlex46E4ILxyG8U1O1TtqK3zal5u23/GDrsd5C6lSsS59o9BpftS6ducCZfFwbYWLW+ysYhEajyeVambXSYkNzjawSKuPGnmgDokoiXlJijb0Ekch6MoDG6uZDfvnBZyuURcK6b+nT3jBKMWcQW6JViaQZpjYR+vueJLZEWs4aO347dkg39FUMLKDCxGbhOa/OuPpFOc/+9o2s31ixv/NZBmEGNWBSjzdCWNWm7RKy/UqSDhiQE8QSiNwLglkivixO/SmubEDHs7E0lF3HLud5suNojg4Ya7aRtEkmBm+k7rE81L3LGhaqYFKh1xuwsLBAvx/LN1krqInNuJ0uhZJPKwSSFla89H03f2+zNP/15hvn9p0pwa0PeRRMYdhOeN7nSJ+xb2LLRNK+MfPtZ6tmGwPpapnobXKtx22pnUZlrFWw6kNeG2JJJD1HWp5Sc8aJNtnQlh36Z+oZr7a5YilzkTrFCggSG2AazTCNgs/9ygYe/NAIWdtB1iZdtW5YkeQwVymLi7Yj2bFDgnZwUPVjEZH2Wrj0+cqzXml5xgssYxsE75SiF3BOEevI8gIxJaIWCYGsqri032LjlyuSRwO79yllyGOp8WCwIcGEIeULwCGmRGWAHS0Yv0R4fG2Pz4wXPNyOBdrTACNqSBCCFYKBJKnXviaJA1VLs9OAcw7vfGzELZHjrLXJ42qa6VLVqVO3GTSgSU4wxuxlNtm2xq577zte+Fj/TAouHEXzTk1htm9D3/BtV4wNqsf/Y37x/I+W1fyY6zUaiaSiJkFThzf9WF10URqjqlMlqAOCLqcQyKKmiCnWYuoWKotVlYw/vJdcIZiAWE8wns03zPPgB0drf2sXZ2zkyC73LNRp3OqrxSyEQ+1YFvmxrhDyEbjk+Z4tr3Bc9VLP2suj5nKF0B/EUsI2F0xmEAmoOLQ2HNWANlJmqoo0nWNitIHtWEzXD31X9cUYltdp15ARENIBjA0C3ULIFRITH9ogULhAxWIngMU+JkIVNanG/tJafyQCxObJ8auqi1kMpzPTR5VgMowr9X7R9Kb3XT+4HX1MJndgT+fi7HA4rPAOBfemz29q9sb3/UajJW922kir4DVLegRPUG8JQTWUAbUQVEVZnM8EU4+RYA5aM+my/9RKdvimHvR5xFKYUwmimKSkHMDa5/dY96yCfTtT0rbB9xbQcoBpjWKSNAqTq/BHs2MLKPuCTWHdFYFrvqPk2pdVbL7Ok7Vj7bGyG7tpWhvz0hSFEKJIKBiph1CiZ8BmloXQRWxBYyyj2Wvj+nUK9DB7dgWEFEKKVJ6mKxhxgczHsLI1cYjKjMUWZctlb9HnVHsNtDZJhs+vHoXrcMrQ+pk1EGC/M4MvosjUx7Dbt55ZwYXDCe+wdo2gMx8/8JJ0XN4gVpKiI5U1akOdr6cSZNh3ajgrL2LlYB3BU3UiVSKHHpwQFB8gHQl8y//vALfctBFfKkkuhKrCz+3HDwv3LmrglXZs1MgTFwae8+KKa19VcvE3V4yuUlwpVH2hN7NkSkjUrQyrosRsgAC6rAmMatTiNqEnAZ8pa7xnbcvgkopuoSAJlqEw1T4DVZL6fEUDVgOpF1oVNB24LKbODAUwDQcRyQ5COMo9WPSAnc5YhAH1IBbSEdlcPKGjwPzOl54xYtpBOER4p0C2C+Hf3cHobNv9uyLJRtWpbySDNCMyOwLDgRo+3rHjTjhoajw+mHpVdjgiCSwX8GgY+xC508U8jG3p8LJf7fDRqRH6s4HGWCwwrYuWSe3f9FB2wVdCe61yxfWe617leMYLPeObHRqg6iUMZuJDaM3SZQyL+AQJYGt7fXidy7uY1scqiooqeKoUFvolm5OSTPrs82DSBrkJmGGlRvHENkMV1nma7UgoFwLtCpoFLKSGykRzaqh5j4SDnWfD81oxjitshkMaj5+Mlo6TZxrIE6Q4/THmI+AQ4d1ZX+5MxbhtmRdgLL4MiJHFOergrulLL46nn8HSAuzkTlg1Kr3EwGBWufK7O2y83PKx/5HxyGcMrlBMnf6idauprA0XPy9w7SsdV9/gWfeMECNjPaGYsYsOiNhn/GhckRDdW9SCIgf3F3Kq9KoBRSgYNGBmEBDrWN20DCqhEgM+RdUQrEPFIWGAEWVsJGHNqJDgSUKsbXDY/m8nGiw8k6ifFnUKmObaYv2V8NhDW+q4IKdXzx+CIy7YukVDVmlmGl5wlcGYBkEDhupEszVOCcsDPkFqm08iF8aqMru7zwXPbPDD7xPu/7hw78cMe+8XQinko8ray5RrX+HZdF0gaym+L5SdyJ4Sc2g27ckhIGIw4ul1FuhVJWULRkuDs8LGRoOkULpFwoGyQV8ynPQJpsRqQSqOTWOjrG6CBscBoEiFwkZzJfPgh+Jwglhpmp2q8jgKDMacrrKWx4UjCm87F81cDK4bPWYRxzOOIxKsg2NhpkBGM65+qeHq76hwhRA82BSsCXgnVD3ozQh2KTZxBCz3BBzus8MoEwVEccHRKRx9hcrCQlPY3wqsbSnjFbTF46sexg9wpiBIh8T0WN/OWddQDAO6xtG3hp4Vyrp2bhLiAxsAcwJ642Qrz58kVPCnhbNwvDhEeIeh3ivS/tyBBfmU5lxUuzBVxEik3h6Ms9H66HC2XgCqSun1+zSyBpUdpaoKoiYUXBFPbmgWGHuYG7py9S/Ls71gpZjXtXCGfXrjgiux9PtdnpyfoTQBL1HgBony0EhJo1IuC8qIDLi0neNNgjcOJJCYEZoEEt9jYB0zDeXJ1DGfBlwSvROiARuWmasnwD84lqZd+f6p2MB6rOr2pxmHCO92QWMpJln4kVtG3hXWdV9psjBKHzV4CStImOekZ9cyqIIrHd1uh9RabGJioONwXpDTDCF6PwpXUJQDQuwzgDGQYChEeLhZkrqKtoPEOpq+S0Pt4l0WLAGlJzCTBx5qOR5uKPMJVFYPmgPOWY+0pygOFygcuhCk4a+90/Un7nRixJpYZ+oM2+AnBUWpqopetxfrzAqnJ7kSjin9IkK/36fXHWBisCUWkwtQGmVPU3lgpOT+8YJd455O0+FtgeCwGqjEM58pu0eE+8YN96yGB8ehm0YFGyTgnxIpA089HNbmrbWvbJfPzr/+Ixt+T8b1RSZhVD1e4kL4KQHVOOs7Ewta9F1J03sya0/L/BVkKXIoxMaEaM2XBawxeO8pBgVF4dBskZwGRH9wkcFelPtD9NfO5TBRQKNUjAqFFRZS2JtV7Gorj43BTA6lxGXxcgtB9OgW+bmGnDUnWcSRFmzxfqmK+fQTd5i+3Ekqrw5WCSpHJXYczQ8Jh057R5oGD6nsMqxiuNzva2L9q6BKpZ7BoE9vV8mmdatpt9qHlII6/PkcpoYsxEC2KkVZYq0hzTJsYvE+4H1krPWLgoX5Lv1BgVKHboV6fHRxddWz8HAb9udwT0n04bqA0Yog0avQy4VOBp1cqeyQ6WWwaogZFNHVEmrtvni2K23UFZPp8LtDp8pwvI/0cIeTfzREjpTmcYZwRG/DovZ9AfM/csuG3zWrF15Qmf6E98EPPaJPBYQ6HAoa2V3OcWD/AbzzjI2NxS/5sJgtcDw241DbKSDW4kVBA85HopG1CfOdDk/umUXwUdvWbvAQ4vkMeQRIoLIwZ2EhA9OIUbI8CElthnmjlDZqam+X6IoxB2rZtR7n+Z8LiBC8N2fV23C0J0W3RXNSnvmVyY82ZkbenVUGK8s4OE8xxKKLlkHhmJ2fY6HbpXQOT2ykjYlc2KNtvg7FxiLtgs1TbJrGHm2honSOJw/sY/f+GZx4ggEnB4dwpQ7hinok6GLEL9Ra2RkoEuincRskQmWie+1IAvqUFNphvMYKWC26ZvYhWCwOfcZl5KhqXgSdAnnrW3+30EH5P4PyLyYzJ1xT6mxBFargMbll4D1P7N/Hvtn9zPe7DLyPmlFWbEYO2lQkMrnq1ya1eCs4AoOy5LEn93BgrksgYJMo4NWy/R31/OrjOwulhUESt9LWgnsc+zgW6kR3LHLWUsNr06QKshA7EE6eneMek4y+HXRyB/Z3vmfmkTfcmf2iGP7UZH48VHgEu9I2PZbf8GRxyHHqx365014BL4rHx/SWoMx3e/SKgnzQp9ls0mzkwz3W/x58i1UWYw6oKvPzCwyKgkFZ4HwgeI9YWSR3htr2XqIOxGo8Wh9isSHfkA1Wc5urFddn4JjcBZBDPhcRNMROn6rgvaeZpbFOcVUt2ryLPztKAufBXzwODImBHnyls65ZX9b0CezjFHDsNCBBt0zFDj47H7/iVisP/bEZGfxHsYHgRBdzzJ4iWP7wSL3wUecpfY9+VZD3s/rDunWTGfbCrH9fE29qVjJlWeJ83c6V2K/MLzvGSp/3sRSnDUOTZOlcbTgewV2B+oFwVd0SyoIxQmYTsiwjaICyWvrumUDduVI9BMfjYy1KOHbnytOF48ph276dEFOWd5b/+pb2b6RZeF7WNjdoV50GrBwlsnKmbbXl+4/VD5d9OHxdK9fSeSrXjy+GRPWarTZ86xAOwVAx1+/5FVP78d4llSikVllc4C0/RFovdbyRRQ5HfYWL17b8ejXoIj8jSxMazQZpmjHSHCGxlrIsWUgXmO8snDEijyqIRTTgUb7CLIMzc6TD47izh6e34id3YKdf2d3z+ttGftTY8DdZu7y67AYHkiwN7rkzh4McbMQvcoCXf2d4I1WXCugM3xt6yWTp78qHb3EaHv5dOY0f4/yOJO0rKzkuvr+8cjrRFIoN/yxihGYzp9Fo0Gq1yfM85v8hqPh4jfVxh+d7ynbw8CRVUEGtxahhoAPufs9LKVSHauHM44RS36cnCZOKfZ90v/KDt6399zKu78lSvdwNvEuCJCLRR+mXGaJnmRxyWE1/0A2Tg/9rlldVX/Hb5Up4ufvsoN2t9BoeYpMuZVogxHmVg/2pgbhgW1mGVOsHzEq0ba0xGIVWo8Foa5RmM8e5Om0qKPQKrFrEWqzCwlyPIErIDK4+sYRTWIeILv7Wm9otmChGGIiyE0G37sBymoqKHAsn9iAKOi2ESVX7JzfuvYO94z9sB/nj+YgkgKtzr59yOMTDcITtbJ2LN4cumFZG04aItE1L1sgZaY+wcc061o1OMJJmJC76jNMAqQPrAiYoVI5qUAAxVy+I4s3hj3uy1+DidagRIek3ZxLXevDU93xiOJlZRHcQbeD3vnLPx+1CY0qC3yNtTUqLCytChCv9qF+vOFbnx6UOkEeHWfH96No6/I0QERIxNBoNxsbHWT0xwUjWoCUJiVekdFgXagHWxRKmTj3znQWMxDlcwomd4xGhQsDisTiI8e2BIVuY+NLmmed24Owt1uAkyz1JTFMNUxrMdtnzR//uH8ceMOPyh2l7cHnRd3ERZ56KOvjsI7rKzFK76JrauJiUGlN7o8urtlEP6rMhQpIkNJpNmmmDYv8cqkKepTW3ItTZ0DEP26EMvKM7GKCmJgqpnjZCytBsMIqaBKOqA6rsjm8p7+yhIttAtx/XuCBsQ2Cqfmc7bENPpHLkqQmYIpPTmOmt4t/0jxuvD2tn/kgTd6UrvQ/+oHu2dMAz/Vye4AGOWbdgGK4/0kL0KOF81YDU9oixgoihrDzUAQ4CVJXQaMQiFVXpD9tyylrLyEibVSNjjJms5vYKoa6Io6H2NQvMd2OV80FZRBNFDl6wHbP81VGaqliF1EdXYiHWMxKsUfYmj4294j2vnPvi8RTRWxTawwiqTtW9BY+j7zCcaqG92gd8w22avPvG3Z/4N7es22omur9rmv0XY1TViVfqxfE3KgSCD1QOUE+eW9IkI7GGxFryRgMrQrfXY77ox4XXMvlyDkLwLHQ68bPWCFaj4BpjaDSbDPp9Zg7M0huUSGIoXYWKovXALy/3L5yK+RajEqJgJIg6KL3eW47OPXJcv64TcmQ7YWqbmtve8b3jABNAd3SNl3//rgVQdkxit04fe9F3eoRKkUkw04L/gdtXXURz5pdsU/6NCC1f4oOP7cTgG0/zat2cOrEGIwZrDa1GzsjICI1GAws475mfm2f/7Gz0O9e+pqGXLChg4j6AyJWQGJRIbIJqoHIO76P5sfyKFr0li6d7jAjbUTTvsCO8KkESJAjloDC/YL81/PaO4Zr3CNP+MMAoKA/98sSl5ejq761M+kpCIgkoppxT33t/zq5bLvsZZnUKcywNfHpKnAo6rdGN9hcy8+hNn9v01vnOgc9Is/rFhpVLggT1lXoNYmQZ1TZIXYRDFku/fd3DGInSVqs455VmM2N8pE272cSaWLcM9fjBAL8sN31o9x4OPoASDnbZKVB4lnIEBKuxANzi+ejp0lDL/OgBtVZMFhrzbmbkIztkrz+ai2yocbdtu80+Prr5TWuSzn9xaefCEpsbG2Prqp604V8zCNz20O/kPyU/VTx4LAE+fdyN6Ebzkzuw73ze7v6ff3vxB65jvzftyt+PVqbXtMZmFtJKfeK1LvtgQPO4YTDo4dO9zyTUHLRprOG8tGmI2yHva73A8osbEhCFzCa00wZjjTYXrlvDhWvWsaE9wbhp0AjQCpB7QxoMuUkIztPvDQghlhhQIzEMV9uxQVhsDmgTg6RmsVO7sbEMQGIhMQcL7uIl1n+j7zheD+EI21FggmCdaKJIUiTY2bWfn7DPeeiow1vbuGJE3zw++aY1jbm351l4Rgg+JZQh+CIEHQShCmhojaZ8V1vcu+/9H42LZDthaAcfDmfEFp1SDNtiWPnnbl013i3sd1Zr+v+5ynrPNEYT79FBQD0p0BSMEcMAidW4Ti1X60TNhhUNSvSQ0pTHf5zY8SdhtN1mvDVCZhIyY0kQbAD1nhBczVyr/aUamB/0mO0u0HcOsbK4wBqGgIdmg0VIUot3nqJUnINWoxbsYeBrhT1wOlPdrRpsZUKWqQimx5MXvfmdr3nwL6LXaYmPtBxD+/X+X28/a2O7939blks6fa3KBKumLvAmkT4aAqGRxIpcxYDfWpXwC/xUjOsczgtxRsr6b5fY3WfyOuxvvHxmDuR9b7yteVvl5S1ZS9/kE3OBpiH1eFxB0GBCQlMMqUlkQDjzZa5OO4wCAUwijOYtWmlOJgkEj7gQe/oCiyRYEVSUfjGgXwzqLGRDKbpI/FnsarkspJ1UgVTjcTQR0HBU7sJpDb4oGKwaNSZ4/ZobffKjEIb83UOeep3CsI3wyG/RHDGDn0rQSwYFHiFJBHEsOZ6NgLVYF3DNFM0bvO6R7tj/d4nM379jEguHmiRnjvIp6PRW/JRiplTNe27sPfF4FX41PDH2svTA6l+Vwtylot2QY6RtrEnVGLxXH5uPLxLev478FJEDJAQNuMrhXIVzvu7pGxWTGsHV5oBD6Qz69Msi1u9NLGHZimflYtJoTKlv2ZQNExNsXruGxNhh5PmMI6gGyYJR3+jLgXW//8fXL+ybmsJMH6kl1c5oxjdKrmnl/rWGaF0lcvC8tdxM1MhylcSY8TJdfQUIk7EEzyGXeMYbqgy18JRitoEXmb//pptvepu55p3vNM68KqTy+qSpz86CG0+Nb5ArLkBwqAYCw/xHGNIAj11S9rS65hbDC4f/eLHfQ9Qe/bLkwNwMYXSEkbzFsCVErPQjmCTBVQW9qqBXlSz0BzhREMGXbtHbYGo+gzGWNE2jW0wsE7ZBblOSRoYTGIyUzHUXFltVnUkhDiaoT4JJ+q2v5J2L/1pEdPIIDa+Xa90k4ceCZ22UBAy6jAE4ZPTpMkLU4sgePSfu7HQDEnQ76DZFJndg3zn5ToewG8K7XvMJ/iaZa144Uo29nKR8nVszd5mT7ihCy+YYY2vbLzDsFRgLUx9pqpRFT9NZTxgPAqTQDyXl3BxzSZfVI2ORM1rfXtfvMKhKBlWFI+DrlNugMVJmQk2RTCzWWtLE0mg0aTVbNMTQdhaCUvmoo1NjakL6wfXkTjc0xDq83oRBGJjf/52tn9i3WsVsP9JTHbVu+Nr/aF2zNut9r1GkqgiZifSLYx6PY6ebndVWVrXR7VWRrTuw03ej/3D93AzMzeyY3LHz9te//T1zbn6NjuiLMDxHA883LblUxLQUEgmSCxgxJlnMkjpI1ShqfGyOUMUWvWfr2oZeAYzgVFHv6RWeTrEfK5DU5p3WHMxQ95YY5qypgHjIg6WdJ4yOjtBsNqMHQgyJJiQK1gfU+fhlI5EiqdFRYE20o88Eu0AENVaMVnr3XHXgrwXRyWkMW4+sdR989yWN1tyeH3PBrJUQAlIXyDzmwWoFlFTzoPFBOMxDck6aCA6FGEWmtmF2TiNbJ7cGhP3AfuBrk5+k6ds0ze58tOFXX4EkG0XspUakJfAclZBF0uqSgHpTMmjOaki6VxorlzMUFjmjBeYOQqibuKRprMXriip6oYhnapZ9T4lBAx9i5d88Tbhs3QYyDN45jIc8jwLsnCM4T1kHKNQYgiiDqkSMIZGlyuenAlPvIGCJFd8DEvAmFWPK5oIeaG2b/s4n904px9S6e3/l8WeOTsi/DiCFI6QGgz/UUSO1EtIYFERUqEp2ru8ufPVo53puO2DW5gREf+DWHdFvteVudPsL6QN9GByA3Q+DcNvUR5KPXfcxM+DOZiOtZHbF7jpVYeTippP+gzck4+Y9GsJE5UIQYq6dUWLtg4NCUCvHf/nq4bCL6GWfsXgnhmFYO9QRGoMHts5YlnrXQ1eqQvQJGUtZVeSNhA3r1pOZDOs8xiZoCIt2sEHwWUI/OEKdCd0dDOj2B5Grm8RLORXZNUQCTzRIcpwkSKjU2gBixS6s+sDFD7zqo+g7h2uQQw6ndR+Tfb+9eizzs1NGk7XOGW8kmOXOtEWG25DoA1SguRUJIem6Ab878QsL+4f7O9z5PmXaty5qYwBFpsDsvA5hEragyjblxm03xmrMssjpXrGT+NvJHVtuseax90ir/9NiAupjE4oTjuGJciJEAGGZVqnnx8UAQf2FlbtTaoaZQlmUuMzGslHWYBJbG/lxDSoWaOQMqiJ2++n18XXUbck9fWpTS0AICE4SVCxKFZJUbKj0Ie/827a/5Z29yVXY7YeJpi2FgEV3DbIXjzTlpUFVXTAiiZGwWPX70NPUgFoDgpWea36cxvoPCvcNv37YZ/IpI7wHYZlGXnonvrFtG8JRFtW7P4995/N3lj9466p3hIa+NMt5rhvgPWo5TPTpnEKV4B2JQPCO2bk5kryilSSkWUaapcOoL6B4hV5/wHyvQ7fboywDiR0+s6eOaCpEjeusJQQf8swLwQ9CaX7tvS97/F+Oai5MIWY7Yd9vrxrL/OxPWNWRfpAQjBHFYI/ws3p+04ZFRHW+P2j93kU/d/98rXWPeGlPTeE9FIu9WgA9Sg9DqInyf/LymUd+8KNrfzpd3Z3WvL/OD+pU/bNwsieCYWciVaUYlOwbVLSyhGazRe7q3nJEN5JTZf/cDANfISKkmVlywZyOc8HUGteg6lWTSkOiNixkfxP6I3+G7j2iubC0D8gGB57TbJoXQORkGBskusdipbXlfl2BGNwxYBQJpd5xYaO8Q1GZ3olsPQrp5al2L08Lhm1mt4nqD3/sgp/xY/vfpvg0VIraYJavGFY6jQ8RhBPkDx6zW2ztuhx+TZfxCUQjZ3Y4q4rKQXdIBbzUrQWGIeSVuz8FfpOKIZARVFCpnIyQFKV+Mcy2X/cP1889EEvfHl6YahKN6hR2YTT7eZvw31RI1DkyENE47EIgmEBVpyUJBh/weRaMVRb63ez14z9XfkCnMGY7R/WqPS2LZw7j4DIl4orrbrbz69+bhnFjEqOqRxj8w9ijZxO1sbhYbsoDlQQqAl7j5nSYhsFicevTD8XgfbMRkqyXPNJcWPUT/3D93AOTO7Dbj3LIbSytvRRNgo1esQTUakBwIP6QeEbQOuFDRbouvbNqjNyhi4bS0fG0FF6Ikb3J65A/feWtXTu3+b/Ra3/MZKkVo2Gl83vR38qZEohDsZIEqsu2YU2zRWZZvZ2VuxXwaS7WeHOgOdP+zzteuO/OScVOTx4UuT4yNqMudVqZEjWBYeHIfg79XA+qNSxE4U0sgjA/60d+b+1bZ+aZQo5m6w7xtBVeWKo18Uev/fSTFLy57Pk70kySxODFo0P65dCpcFo072mo8rkoxJz+TGeD1r5cgxLt22EKaPDiNTOGqt2x+9b//B9+x94dkzvUbtmGHktwt22rP19F8KpzqQkqxILO3gynQhbNoCCxNa2tbd2i0A9eum7m9uWNwo59LU9zTG/F33Abybte/sgDpfBG35M78oQkMXjrUWp+btDIyj3xVYA5aAuE2OG93o7IDx7yalcgGD14k6UHK5oTusQlPsx29DONflxRQTXH0SSQoqQEn3rTyARSFxYmfvMF9/7tu0RFtkyi248jp0wEZRIjW/Fln4+lwlxilMK4UCVK5qFRLSPHR9PIJUkQsezpVPx3+SG6TB47g2L5yD/tcfuNuBtuI3n/txYPaBneWAy4QxokzuJDMEGlVphP0eXrcm27zK9/cvs6yI9rCBiCqre52LRq+3Ru3R93Zzb85ltuer6bnI4NJY9751ui86TXumLnQj/9P4CkDaRQXE2yCh5CBaEMuEYaW37PF/mfbr5sy12qCDuO/3jfEMILSwL8Z9fzQE9440KR3lG1W0mRp1piwlOy/u1pRsDiaFLKCM5avARVnEubzqYaOtmBxtsuOLDlZ//uez+5ELPCT4zmI9sJbEOueut9xay376g8H7MqtpWSmBTBImIQkxhpZUli1NrK8bHZoP9Ttu4s2Ra9hsd9vBMfgq9v3HAbye034r7v1osvb7TNH/n2wkudzGgIIViwSVgRez+mIbyyROrBiuNYiR2HlOU/Rg7U8NMjntVRzldJcDRRMTgJGozzeaNKGmV2IN/T+IVvnbj0j9/y/M9Xx5PCftRzrF3Xj/5688JGov9pVavcSgjj3pEBWGtKTDI302vsGPjkNy/6LwceG/7mRI7zDSe8sCTAP3rLt68fZI/+crV6zxtJqjwM9NCCKScovCeaSHqywnskyNGEt/bj+iDBJE61obYMPJLNrv656Rc98Reiwslo3MNhagqzfTvha799Rb5hcN/FGVyP5RIAPA+XRfaJJ8cvfuSqt95XDL97osf4hhReWBLgqb/7rtYjI1/4MVkz83NVOljnCg3BwTBV/2kjvAIhGFWTepOQGCpCmXyy7I/95/e/ZO+dKGZqW8w7PO6TPwZqauRicRGdippXtkduymJy5kke8xtWeAEmFTtt8KoqP/TRTS9xEzPvMLb6JgiEiprOc6yY2ZE+PkkZOIadcVLCq5FGQWKQPDPGaycMivfl/fyX331D8eiUqtnGiZVaOl7oFIbrEO5GF323U8jwvZMVXPgGF16oM52pgxq3bro4a838dDJWvAnRVa4iaIWi1qitl3TLynwCoJaAiQq6Tn2POJPCu3TbBF3KtlZZ4uMOi2cHgrGq1mKDWBzZfVU3nbLM//X0C+lP7jiBAMQpYKk2GSdck+xI+IYXXqi5xLWtN7VjS/bAxp2vkBH+XxHzbIO1zotW6oPiTWKQg0rwhxQvKZUNBKnqjIklwT0SCX4FHXgJx1rh1aXelRRRT6pV3VhweAAdBgACgpoUY4xIArNVV6e7Lv+Nv3lxcT/AqS7MzjXOC+8yTO7A7pgkiKBvvK21MdWxt0h78CZnBxf61CcuVBoJtLEPN2LAZ6gYKusAjyEcJH9nSnjRNJLfKepaZAlo0IBXEpQEiwWH9M2g8TnbafxGrzHz0ekX0l8+25zsWD0VcF54V2BqKpLgp7fib5uaSt77Lf/7Yje+/4dsS3/Ii1ykqSZB0arIFE3UaDDWOBHxcY5eMaLHEt6VOOpsqhIT80K9mlQDqGowKoraBLFJZYwqFnpVFe7rVOb3Gmn7/X/ybZ39oDK5o05Vf0q1wTk5nBfew0OmFNkeecQ6dRvJvd3xi/Nm64fcxPwPVelgYyBrihW0LFW8DxIUg4jG5kKL43pahZfI2FGNwiqgwYrYRIw1Qqg8Jg2zaSe7J1to/1Ev6/3De17ae5LYzfRpoW2X47zwHgVDW3hoStx0801pcdXfXtBp7H15kusb0wZXuVJWkxobDIRKSaoQjDsoliDDxixSk4cVParwCrF6d/zioodBUVERA2KMpIhJBC0Uk4auWmbLjr9VAu8b74984Q9u7O5TFKZqF9jTSGiHOC+8x4HFBd1wulVk8m5Wtfa2Lk5Z82/Lhn9lMdFd77Q3mpWumdWNAtUrGtAQ6/QNm/NERO/AweMvS8waiQysKPwGbEIscx4MvgRyFjJtztsDo59OCvv3M+neT8yuKnbf+ly6sMz8eZqYCIfDN6Tw6nB2luOj3g0xFIihJgb47Q/8ZH6PvX2809q9qRibe6kZlNdnOc+RRMbxkgcvTVFJ1QomifIXGfG+rjIZM9AEECMYsYgKIWgt/ApCKZn2REKv7PEogS875dakM/b59cU1e3/vOz83P+TYT2ksJfB0FtohvqGE9xCH+RTCToQt6An5Hut2Blsm0eXT8ZRi7vs0I72C9mg1sS6Vsaut2mchXKnKunw0uQIJ1kmffjbbrGzfurrVVaKBLORlo5woE9dS13ezPoTHRdgF5hHv3ac7Zu+9xUgxu/5C+u+8gN7iceuHqj6fUyWefd3gG0J4FYSpg8OQejOpvGWpBbBOYaavQ+6++/j4q0MMBQdin7qDtZ0wteOXsl72z3lLxT5RPdnObJBZ3zFu1e4LypGZiUHaCiFgRpzXZm98l9m7biZxbR1v2TIZaxdu90Z3Vf/68i1v+dFquUweJLAcmyz+dMTTXniXC+7f3fxdrUu7t27cmBTXJlXyTZTuS0nC/bOGJy7+T3IAFFVkeitmcstJhC5jvQnZCcJ0bOt0WgRruN9YSvT07ffrHE934RWtBfeht2/Z4vKF/7R2dPerkuBari/NlpG+kTDoFnLXgm/+WZrzwfVpb/9QIy+aGcts3BNCLGclbIsvd05PCpPA9PRh+5XtnKb+fBJY9p1tsP04UnG+0fC0Ft5hT4M9v9Z4SXs0+YNgw1Vi+ogqwaGJIAkgAbyRbqX6QFHx/tlq4v0L8i33P/dn/7E71MZsxbDjJIX4iCe4YvzPC+cJ4WkrvDqJlWn87rePXzbRnP+AbaTXLHSNT6tApk7UBjzgBDViJDeYmFelFUlj//7+mg/1Sd5nzUNf+vxm9m3dij+c7Xwe5w5PS+HV6Ofn8zffnKzpve0X12eP/rcSCVWVyUgQm3oHUhGs0k8gBNT6JKayJZjUilSVYDM/2xX/iCt5z/j8+F833HMfle23u+PtE3YeZxZPzxy26UkjoMX8X64iz/61aiJUXlLjbD8JdFODJ0Xrpg+aIJp6g/XW+6C9gXgvqkGYaMOzJ4S3Ja3io3PNf/7Fx//HyNqt0/ijdak5j7ODp/UNKLO5LM3NapOJDJsaBAl193NzUIhWRQmiGDDWYJ0aBoUE1yeYQJbY6tJWc+GX2llnxz3vyC89Vpul8zjzeJoPfpNgUW8il8AESEMgDSXBlIS6oK0JcdE2JNFYDWTqpanBJGAqjw6cOkBbKTeutf7X9v7hmlFiba6n+Rg+dfH0H3hvROvaeiIOg6vrZUX6otElwRWtB0QCiQ55uQYjxoghGThRHwijifvOMLf/RcPQ8smUKjmPU8fTU3jv3qIAo431C76T3G1KS2pYYhKsKJlkOJQDvrKskgIiWB/AO9q58Er9APlimPk8zjqensK7fbuqIs9/y1/NGef/CHW9PMV6pQo1G3FYQmmxvPxxQIj1ZsVgRbhm9qs0z1ixxvM4Jp6WwiugbEOUIFnY+YEqlO+tVEKekxpD8AEfjlDq9HhQ98a2x/7meZxJPC2FF+rSQ1PI5p+lq339L90y+5+JNzOJYPIMm1oEjUKsR+aGHwIj4APBCDOuPO/rPZd42ttqwxDxI795YXOs2H29ycPr8xavqrxZY0VSCZ7S1zV7BZNgJDJsI4YeCAFKCCYNWEPZ6/PW1Qv8IXDaUrnP48TwtBdeWBJggN1vp12Z9Zf3k9HXjSSD75vQucuTMGhjwDkNLsTObYa6KFws2FFXKA1+dJS04+x9u2aTl1/788VDugMrX8fp41/P+IYQXoj8123U5gRw8803py+q/nDNRH/Pq8fY//pGyz974FmfWidePZVfat5tDGIMNBtqKmTfrkHzJ6/4yd6f65Qath+2NcR5nAV8wwgvLHF7p3cik9N1WwdV0d9YPfaQGbvM5/z42mT/KzLtrVNoJfWSrHJgLUVl7SN7yuyXrvjJ3p9PoWabnjcXziW+oYR3OaamMNddh0wu4+r+3dR3ta5ufGLj+mzuRiNMNjKuUEULxwMh8MG5kP/tpT9bPqiqcqL5b+dx+vENK7xDLNfGPzCNH0rjzDuYqLo0Ada16TPL/CKf4fwC7TyeatApzI5J7NRh+AqqiE5h9CjdN8/jPM45FgV1B1Zj/TJ7Xmifevj/A3i5rxuruopAAAAAAElFTkSuQmCC';
  const colors = ['#58CC02', '#A4F842', '#20D9EF', '#9270FF', '#CF79FF'];
  // calm-canvas-grayscale: copia en grises del sprite de Duo, centrada en el
  // anchor del ramp de super. Devuelve canvas (fuente valida para drawImage,
  // sin async: el sprite ya esta cargado cuando se llama desde burst()).
  // Cada pixel conserva su alfa y su sombreado RELATIVO a la media del sprite:
  // los claros quedan sobre el anchor y los oscuros debajo, asi la media de lo
  // pintado cae EN el anchor (la presentacion lleva el valor del ramp, no uno
  // derivado del contenido del sprite). Ningun pixel resultante tiene tono.
  function greySprite(img, anchor) {
    const m = /^#([0-9a-fA-F]{2})/.exec(anchor || '');
    const A = m ? parseInt(m[1], 16) : 160;
    const cv = document.createElement('canvas');
    cv.width = img.naturalWidth || img.width; cv.height = img.naturalHeight || img.height;
    const g = cv.getContext('2d'); g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, cv.width, cv.height), px = d.data;
    let sum = 0, n = 0, i;
    for (i = 0; i < px.length; i += 4) {
      if (!px[i + 3]) continue;
      sum += (0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]) / 255;
      n++;
    }
    const media = n ? sum / n : 1;   // sprite sin pixeles opacos: mapping neutro
    for (i = 0; i < px.length; i += 4) {
      if (!px[i + 3]) continue;
      const L = (0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]) / 255;
      const v = Math.max(0, Math.min(255, Math.round(A * (media > 0 ? L / media : 1))));
      px[i] = px[i + 1] = px[i + 2] = v;
    }
    g.putImageData(d, 0, 0);
    return cv;
  }
  const rand = (a,b) => a + Math.random()*(b-a);
  const clamp = (x,a=0,b=1) => Math.max(a,Math.min(b,x));
  const ease = t => 1-Math.pow(1-t,3);
  class DuoReward {
    constructor({canvas, duration=3000, count=100, reduced=false}={}) {
      this.owned = !canvas;
      this.canvas = canvas || document.createElement('canvas');
      if (this.owned) {
        Object.assign(this.canvas.style,{position:'fixed',inset:'0',width:'100%',height:'100%',pointerEvents:'none',zIndex:'9999',background:'transparent'});
        this.canvas.setAttribute('aria-hidden','true');
        document.body.appendChild(this.canvas);
      }
      this.ctx = this.canvas.getContext('2d',{alpha:true});
      this.duration=duration; this.count=count;
      this.reduced=reduced===true;   // fix-reward-fx-static-and-duo-crash: la decision llega del script
      this.image=new Image();
      this.ready=new Promise((resolve,reject)=>{this.image.onload=resolve;this.image.onerror=reject;});
      this.image.src=SPRITE;
      this.runs=[]; this.frame=0; this.dead=false;
      this.resize=()=>{
        const rect=this.canvas.getBoundingClientRect();
        this.w=rect.width; this.h=rect.height;
        this.dpr=Math.min(window.devicePixelRatio||1,2);
        this.canvas.width=Math.round(this.w*this.dpr);
        this.canvas.height=Math.round(this.h*this.dpr);
        this.ctx.setTransform(this.dpr,0,0,this.dpr,0,0);
      };
      this.observer=new ResizeObserver(this.resize);this.observer.observe(this.canvas);this.resize();
      this.tick=this.tick.bind(this);
    }
    async burst({x=this.w/2,y=this.h*.49,count=this.count,duration=this.duration}={}) {
      await this.ready;
      if(this.dead) return;
      // calm-canvas-grayscale: este efecto sirve al peldano super (5) y nada
      // mas (FX_BY_RUNG). En calma: sprite en grises + particulas en dos tonos
      // del anchor. Sin calma, los colores de siempre.
      const reduced=this.reduced;
      const G5 = reduced ? calmGreyFor(5) : null;
      if (reduced && !this.greyCanvas && G5) this.greyCanvas = greySprite(this.image, G5);
      const scale=clamp(Math.min(this.w/850,this.h/620),.45,1.2);
      const life=reduced?700:Math.max(500,duration);
      const run={x,y,start:performance.now(),life,particles:[],scale};
      const add=(type,n)=>{
        // Stratified screen-space targets: one owl per jittered cell.
        // This guarantees broad coverage instead of random central clumps.
        const cols=Math.ceil(Math.sqrt(n*this.w/this.h));
        const rows=Math.ceil(n/cols);
        const marginX=Math.max(22,this.w*.045),marginY=Math.max(35,this.h*.10);
        const areaW=this.w-2*marginX,areaH=this.h-2*marginY;
        const cellW=areaW/cols,cellH=areaH/rows;
        for(let i=0;i<n;i++) {
          const row=Math.floor(i/cols),col=i%cols;
          const rowCount=Math.min(cols,n-row*cols);
          const tx=marginX+(col+.5+(cols-rowCount)/2+rand(-.18,.18))*cellW;
          const ty=marginY+(row+.5+rand(-.18,.18))*cellH;
          const owlSize=Math.min(rand(30,49)*scale,Math.min(cellW,cellH)*.70);
          run.particles.push({type,delay:reduced?0:rand(0,.13),tx,ty,
            size:type==='owl'?owlSize:rand(3,8)*scale,
            angle:rand(-.55,.55),spin:rand(-1.5,1.5),phase:rand(0,Math.PI*2),
            color:reduced ? (G5 && Math.random() < .5 ? G5 : shadeGrey(G5 || '#888888', .85)) : colors[Math.floor(rand(0,colors.length))],
            end:rand(.86,1),spread:rand(.48,.72)});
        }
      };
      add('owl',reduced?5:count);add('star',reduced?4:40);if(!reduced)add('dot',60);
      this.runs.push(run);
      // Bound concurrent bursts so repeated clicks cannot grow work indefinitely.
      if(this.runs.length>4)this.runs.shift();
      if(!this.frame)this.frame=requestAnimationFrame(this.tick);
      return life;
    }
    point(p,t,r) {
      if(this.reduced) return {x:p.tx,y:p.ty};
      // Start on a broad footprint and rapidly expand to the whole viewport.
      const expansion=.30+.70*ease(clamp(t/p.spread));
      const settled=clamp((t-.35)/.65);
      return {
        x:r.x+(p.tx-r.x)*expansion+Math.sin(t*2+p.phase)*7*r.scale*settled,
        y:r.y+(p.ty-r.y)*expansion+(Math.sin(t*1.7+p.phase)*5+Math.max(0,t-.7)*12)*r.scale*settled
      };
    }

    star(c,size) {
      c.beginPath();
      for(let i=0;i<8;i++) {const a=i*Math.PI/4,rr=i%2?size*.24:size; const x=Math.cos(a)*rr,y=Math.sin(a)*rr;i?c.lineTo(x,y):c.moveTo(x,y);}
      c.closePath();c.fill();
    }
    drawRun(r,now) {
      // fix-reward-fx-static-and-duo-crash (parche local): sin este clamp, un ms
      // negativo hacia que ease() devolviera negativo y el radio de la onda de
      // choque fuera negativo -> Chromium tira IndexSizeError DENTRO del callback
      // y la reposicion del siguiente frame nunca ocurria.
      const c=this.ctx,ms=Math.max(0,now-r.start),u=ms/r.life;
      if(u>=1)return;
      const seconds=ms/1000;
      // A brief outlined shockwave; never paint a background rectangle.
      if(!this.reduced && ms<480) {
        const q=ms/480, radius=(12+ease(q)*124)*r.scale;
        c.save();c.translate(r.x,r.y);c.scale(1,.58);c.globalAlpha=(1-q)*.72;
        c.lineWidth=(1-q)*4+1;c.strokeStyle='#9C72FF';c.beginPath();c.arc(0,0,radius,0,Math.PI*2);c.stroke();
        c.globalAlpha=(1-q)*.5;c.strokeStyle='#38DAE9';c.beginPath();c.arc(0,0,radius*.78,0,Math.PI*2);c.stroke();c.restore();
      }
      for(const p of r.particles) {
        const t=seconds-p.delay;if(t<0)continue;
        const progress=t/(r.life/1000-p.delay);
        const enter=clamp(t/.13),exit=1-clamp((progress-(p.end-.24))/.24);
        if(exit<=0)continue;
        const alpha=ease(enter)*exit;
        const pos=this.point(p,t,r);
        if(p.type==='owl' && !this.reduced && t<.65) {
          // Colored motion echoes, kept short so the mascot stays readable.
          c.save();c.strokeStyle=p.color;c.lineWidth=p.size*.10;c.lineCap='round';
          c.globalAlpha=alpha*.28*(1-t/.65);c.beginPath();
          for(let k=5;k>=0;k--) {const prev=this.point(p,Math.max(0,t-k*.018),r);k===5?c.moveTo(prev.x,prev.y):c.lineTo(prev.x,prev.y);}
          c.stroke();c.restore();
        }
        c.save();c.translate(pos.x,pos.y);c.rotate(p.angle+(this.reduced?0:p.spin*t));
        c.globalAlpha=alpha;
        const size=p.size*(.35+.65*ease(enter))*(.72+.28*exit);
        if(p.type==='owl') {
          const spring=this.reduced?0:Math.sin(t*19+p.phase)*Math.exp(-t*5)*.20;
          c.scale(1+spring,1-spring);
          c.shadowColor=p.color;c.shadowBlur=7*r.scale*(1-clamp(t/1.25));
          // En calma el sprite es la copia en grises (shadowColor y particulas
          // ya vienen grises del burst). Sin calma, el sprite a color.
          c.drawImage((this.reduced && this.greyCanvas) ? this.greyCanvas : this.image,-size/2,-size*.858/2,size,size*.858);
        } else {
          c.fillStyle=p.color;
          if(p.type==='star') {if(!this.reduced)c.globalAlpha*=.65+.35*Math.sin(t*13+p.phase)**2;this.star(c,size);}
          else {c.beginPath();c.ellipse(0,0,size*.5,size*.28,0,0,Math.PI*2);c.fill();}
        }
        c.restore();
      }
      // One short hero pop, followed by the outward cascade of mini Duos.
      if(ms<550 && !this.reduced) {
        const q=ms/550,fade=1-clamp((q-.42)/.58);
        const pop=1-Math.pow(1-clamp(q/.42),3);
        const s=(35+52*pop)*r.scale;
        c.save();c.globalAlpha=fade;c.translate(r.x,r.y-18*ease(q)*r.scale);
        c.rotate(Math.sin(q*9)*.12);c.shadowColor='#80F03B';c.shadowBlur=14*fade;
        c.drawImage(this.image,-s/2,-s*.858/2,s,s*.858);c.restore();
      }
    }
    tick(now) {
      this.ctx.clearRect(0,0,this.w,this.h);
      // fix-reward-fx-static-and-duo-crash (parche local): ver StreakFlames.tick.
      this.runs=this.runs.filter(r=>Math.max(0,now-r.start)<r.life);
      try{for(const r of this.runs)this.drawRun(r,now);}
      finally{this.frame=this.runs.length?requestAnimationFrame(this.tick):0;}
    }
    clear() {cancelAnimationFrame(this.frame);this.frame=0;this.runs=[];this.ctx.clearRect(0,0,this.w,this.h);}
    destroy() {this.dead=true;this.clear();this.observer.disconnect();if(this.owned)this.canvas.remove();}
  }
  window.DuoReward=DuoReward;
})();
/* <<< fin duo-reward.js <<< */
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  (function () {
    const stored = GM_getValue('adhd_config', {});
    const cfg = Object.assign({}, DEFAULTS, stored, { lang: stored.lang || detectLang(navigator.language) });
    // reminder-desktop-notification: un valor corrupto o editado a mano del
    // toggle de notificación cae al default — nunca queda en estado
    // indefinido (con basura, la decisión `=== true` leería "apagada"
    // mientras el panel mostrara otra cosa).
    if (typeof cfg.reminderNotifEnabled !== 'boolean') cfg.reminderNotifEnabled = DEFAULTS.reminderNotifEnabled;
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

    // =====================================================================
    // audio-cues: fuentes conmutables, reproductor y recordatorio periódico
    // =====================================================================
    // Dos fuentes por cue, en orden de prioridad:
    //   1) la muestra embebida (ElevenLabs -> mp3 mono -> base64 en data URI);
    //   2) el sintetizador de reemplazo, que SIEMPRE existe para los 7 cues.
    // Cambiar de fuente no toca los disparos: solo se llena o se vacia dataUri.
    const SOUND_SAMPLES = {
      reminder: 'data:audio/mpeg;base64,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',
      madera:   'data:audio/mpeg;base64,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',
      bronce:   'data:audio/mpeg;base64,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',
      plata:    'data:audio/mpeg;base64,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HqyTf/WbfNb+uwSgGhmNec5pSspS6lR8svqymcKJpLm5jPylR9TGVvmMYwEKMYxSlp///6G0M/o/mLqWb0f/QxjClhpYKnQ6GvK1TEFNRTMuMTAwVVVVVVVVVVVV//NSxOkdwdZc8MDanFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuMTAwVVVVVVVVVVVVVVX/81DE6BfbgkGQaoS8VVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV//NSxIkAAANIAAAAAFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVU=',
      racha:    'data:audio/mpeg;base64,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z/bvtj5PsSGL/Pv0c/z5vucp/f5VgufpVCjVUeJQfNLgkkiV//NSxPscaf40FEvHRDAMTCXzksk0sAyRNw2tY0HlIVZAJwwZdhK6rI2sHzsDCgvGWQ5Sux5Gh2ltDXNcimecY9OrldNpfMMomGQUvdi9Rxm2SfcimqlSpkahrNc/khl5/o8nkWrv9JYebnSBNBT5qZcYUUlaEKCdxRpbLJVMQU1FMy7/81DE/x5JviAAYYdhMTAwVVVVVVVVVVVpJturpuEIFJAyhTSqnpWOLDRqVmGCVc1OlQWzpFcmRmsGSxY7LFflVPaWULZAskyVS4KlViu8SqPSD1W3owdJJMoOnSIUCaSMi6aOlfO12jY5O9ryTVqATgKkGFGGAjoUSzAUYMYVVZlg//NSxPofk3YYAmGGdRNhRMYKTMyqsVdm6pKpRmqrqvG4c1iy////55Cw9XjdY1VYx4ZtV4xszVVjNsxqJWBlgYVhRJBgpQCahRMCiSYCMKJVQFYBCsKA6gJMGFVWcBUgwowoEdAVjCqFJRQU0FYmhWQ0FJBOT4vysFBAwQcI9lllRz//81LE4BWoBhz0CEYA/82WWWWMssssllljyWWWWf///////2WWWVWWWWWxZZUeyyywzWWfWYKGBggYQGCDBQwUEDCBwgIKGCggYQOEllljoTWX4qhgoIGCcIDChgoIGCDhA4MEFDAwQdC9NNMv//8qqqqVTEFNRTMuMTAwVVVVVVVVVf/zUMT/HzuF5AAYR4lVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuMTAwVVVVVVVVVVVVVVX/81LE9xxTpQACGAeFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy4xMDBVVVVVVVVVVVVVVf/zUMSKAAADSAAAAABVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVX/81LEiQAAA0gAAAAAVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVQ==',
      diamante: 'data:audio/mpeg;base64,SUQzBAAAAAAAIlRTU0UAAAAOAAADTGF2ZjYxLjcuMTAzAAAAAAAAAAAAAAD/83DAAAAAAAAAAAAASW5mbwAAAA8AAAApAAAVoQAODhQUGhoaICAmJiYsLDIyMjg4Pj5ERERKSlBQUFZWXFxcYmJpaWlvb3V1e3t7gYGHh4eNjZOTk5mZn5+lpaWrq7Gxsbe3vb29w8PJycnPz9XV29vb4eHn5+ft7fPz8/n5//8AAAAATGF2YzYxLjE5AAAAAAAAAAAAAAAAJAPeAAAAAAAAFaG9RZ4JAAAAAAAAAAAAAAAAAP/zUMQAFTEGkgFBGACNIhCnkAHBmNxj/Gn/ESon8ROIhVw7wDFvxEJwAQAxwIDAQOCd4Pv/nKgQKBjUD9YPlw/EBcEMh8/y74Ph8uD5QECgIROoH3//KZRwIcu+J3g/xI6p383W8vdYMCoKDxQAbYgTigvHES13OpW3zY1N2dF0aZj/81LEICH0CuZdiWgBGbIDHrJppTKC3IotgzOJYIIZqNjQ3NkVoSVVas4w5FurMw571ZgF8fZ+mq1daKNSTUnYkkKnQUukgmtTN9HWtlf9X/UubmCJ5NB2/mI/i0WlR/8xF5v/umqz66SFf//6O1f/9aZiaRm62/ao1DR8twZVKWiKLP/zUsQOHePm7l/JUAOLnKmvJAuajMPapLWE9nrVAvROf6BLHrD0eziViA1v/zuJ5v/kDudVWYUmJKGCuSm/nt///55bVOOORBfAVWLExY4mIh4UFQKFlFkmQmESCo0KvoMgbSQ3///0///////qxCWLFBfHk8l1bUUbgAIjMAJwWpDH//NQxAwcu97KXjDaq9JcpAflYVe1gUleUdmYhFBQYDb5maAF0St3//7v1mcyALVaD/zc3TRTRUgpz7OicQJU3ZbedZf6//60UEqTdkUEUU3uhRUmbF5OxgixNLg4iW1rUSQUxm3//7f//////+tSUmkwrmRVpSNkECJQhdtK4gywlv/zUsQOHLPqyl5LVPZcoxaxvvm8YHF8utav1Hwv42v506HIDMfNv9X7fMFGwAaixbf2MPPWccxGeduaRP+jN//9UrNdSBC6VlShMLZYoyuzqeY7uYZPKmqXMUqYYEsWjz6TW/1////////v7kJYnWNSVpK45IAiI1S2uKBtaB5IAYvi//NSxBEeQ+bKXkyVExg5EtKp4Z11XfN7dd09AU1P7GIJQcNzA8rdPX9V7abGoWWov/syG9ppy6nD1P0PdX///a5pdDDupMYaF+JI3Hg/JDyo9MG43HzDYbECKQKUuYUcMQvF9W2//nP//////X7MpUaH1DPYdtkliDIjdLmDiQXJROT/81DEDh0T7tJeS1T3hoVtgbQnaM529duH4SVJmqoJUS+CsCdL6zA3CfCsfKK1Oy7sr9T+1YaP/vRaWNdWziZ/6t//R/2RDTT2dUMUfkAVSRWfZFY52PHhvGQTTWQ11BL///6t//////bdDcXjIWzx6y3F6tdtb6gmdZ2KHiN7MTRM//NSxA4dO+bmXkmabppLgydFiFZFFYeoJHEy0O6eo6FEPBvqFmWW//p/e+IP/6Jx2RdazRNOmg5PJ5Db9J1////SY3PKXMDwn4nYwYxzhmZGbOmYHkzBNqS1pycnSRUTA87v9/////////etTLdNE6cLtFONxxRgFCNUh0CPm6Ocutj/81DEDxnr7s5eZBR6/tG6uuVFIuau1fpizz3XMzwQY59e/uvN0NoptADH/5Oamca6Op9XLCw7p6Id/T//xXW3UdFseFRMGM+1VJUJipgwdZxotIs6cFOSfon/////////pkNjnLKuSeWAAjJchlhS/EtSHw42VPScOXtT9jde82mT//NSxBwZo+6+XjQPEIHIkn1yyTIkoO0Vf/1Wq2SoBf9bq/paUzVPOc9D3Lv/////upMkj7MOmioweJflRu7GoXPWo+qSx4kAHKm/nfrR////////9XeWWrbZboA0LHlaSjjZCI2BqiTqhxn24GbGRS9Z7cKh38EQ7SdNd0en3dfoDZ//81LEKxmT7t5eQZQ2+Wexxuqi84oaSHCBKEr/+v//6uMCck9GNIVFmi+p04iOU8lJBFFRZ1oBok/0//1Ob//////75MRI5YhqudklqMQjfQudgbRenLWupOmVUTV1CLWfMVXXB8NiN/8QKRMeJNDcrJfX9kwB3/96qnVy9XMGjs/////zUMQ6GTvm4l5Yz0L/7KcJnb3HTXDYkkzjGPMdhq9VcbuQJEAAfgcP///////////bqYeaNQ1dbSckQCEqgOtos1E090rqEZHEKrRG2VLf2euKFNfqOCbx5e+r1L7I9CsuqLoBQXuv/RX1ydJQkcn//0/mmTEZRGYv5hooFIRE2OT/81LEShlr5sJWNA73OnVNk3NJuWPEVAl9QOFX//////////+844dYqrJJbWzJz5EMFC8YcGHZYIQdZNQtDDllYHe+s8Fkg0kfmgpHNVt7em/Q5UAvLf+Z+YphdOVN/r/9utDdUdyMscbwvy8hmbOeiDEWh4TFx+ePBUMGAkEXxGE3///zUMRaGEK+1lZEFOb///+C7zvtQpVcQEADAPEzvq7QTy3iYUYT9lRXfQz3ZmWgTwIMMA9S6RoAP4KhkkkEEa7m17ptV3RYngpBImV1Oq07+8odREIf////+imWXOOQ5l/19kNc8qNkzxccCQ/oAhE96P///1MUytOXS22Ede+nYm3/81LEbhk6wq5WM1T0eA2REJZBih0Gy7hsZJQzLoY1TG6B633MB9/rWzf2893BpO/5rf6a53////tXU4xEfJ7jwqLZHYiehGIsiLE5ANHE8mKiuMvkIUifon///p////7aT+o/KspxRZNK7a25I0gr7xcIoHB6iy1F62rJg9BN3UvZe//zUsR/GbPy3lZJlG+iv+59ENCGr+JoSjLZq3//13QYrCyN2/zujd6JMUh/799E7+l5080bkVNNliQ4XHwGscrsh5gwEo+YaaXNE45B50dgR////690////7fnPYdSmb+tYqpfZraxEa5lLR7tsUiNMh6jYB+Y+6sUaTcBr1muoG8+1//NQxI4bS+LOVltPS3ePTBIps/1CsTUNQjZeav9OfMBBf/y1VV1SSoclD3///rfWjs2xphc97VMVVToQqVJw55t6Zltf9gyI7f/9n/9niI0wJ4SqcjUjSTIjeLjlsyHAFmPcdqDj+6knMTJFJbJMy1H/PcyApx4r1rKiSC5h5LVn2f/zUsSVGZLC3l56kToloc29ey16pkFqf/sRinVDOImM8hAwXRNvVqfzJ+hnNGFcyW1lE2WIUHRHUHkKwygWtNiJpksWI//6iEn3//Yp3/9/i7hrq0m4/UQlUB/NtbLTqZHcURun93WK5ZjY26rz7Uz1LOhVR5ov3MAYSXZNt+tldX31//NSxKQdQr7GXmlTqpWDpRt/27rshiKeNnv/pT9O3vo46aQRrC48qQHTNy7uhIRVOG5hhIwkUHAddDhMGv/////////397tc800nNLFzI7pKmutBSjCk90vExRzYFeRtGKlakJ3RijoY/qamekopypv6esscnhT+qHt2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sjt6PX921VQRFRyMQMLnWcYFb1uzBsooq5RZVbeV7J6v/pqV//NSxNQcAk6fHnsPJACTCoghvJrQ5NscfSWvZ4JkRg1HBi2mSfpKRtjoshOSaOhuzakC0dlHa4o+A3XrG3/PyIxgyw3NjNeykTWkd9s6gWFbvQMLEjciBv+dL/XM5HLybYmYMZeeW0NPw0v7ZBBCRF7ECjmvO9Y3bja1PL1oM6e5NFb/81DE2hjSTnWySwTs9seZCaUgHtW3P0hdDdc7jCqp2oQjVstPdqLMg1eYYQrVhYCF2qnkm61Sk2NdLt1cRendu6rnuksYZa01ZLnEVbdLDlBAYSGNtK6bnmlOj2RzJevb1l8/ZavsUMJSEwM0jQcDLEPlgqoTxRtxl+4DNixDd7E7//NSxOseQpZmSGPHJNySSqk6mAGf9tl2lfiapoOsp/nGHNa0xNNB4QnRw8CPVmyMhe/PAVayl2QzlhGFFiAIGRGynmv311bOGhectmqm3Yx7Z/VEsdlMv7KR+urkaKAbwoaNGkX1C+jPNbHurXRz0VjXHmgY7dzNUg+GscBKqdmqkqv/81LE6B0anmmySgT4XNV6p2VeqprByJR4ScVualqX9XUTw+qqqUZUcBKgNJqpUSW2qqqrYwUqoVI2pGFE8ar1en+uq8alqWv+vV4Zao4CGBCgGlk2XHoLxKqC9O/Fwv8WSUpKLjxbFkVlF6bGmxiuKohU0b/FRUxBTUUzLjEwMFVVVf/zUMTpGeqaXFRAxXBVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuMTAwVVVVVVVVVVVVVVX/81LE9h1CliTIGYchVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy4xMDBVVVVVVVVVVVVVVf/zUMSKAAADSAAAAABVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVX/81LEiQAAA0gAAAAAVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVQ==',
      super:    'data:audio/mpeg;base64,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RLI2c//kfnLwT9f8+apoyLQHHiINhQGvJ9LViEqJTHRVW1LA//NSxOkcY+JptFhVzQ6LWx9S7kG18O+bvubjVl6kR+FsWhaxwnJoCDYMaqgNBYZQTrszZz81vKeWpGYlIYUi2lThDNrpke5mnVFymnQqHJ2NUjN2WZL4zQv20yeu//KjL3hWSUxS3BjXrK3xdXqaIhJj1seqJQdj2awAaWtVoU1ru1b/81DE7RzLXlRSWE3M1rucu+lYvfUOpQlGEIsY8ETOTFwdpCk00jCUCY9ak/ZecWb6hgwFavAwbFUrIqRfLLpqXm3QKn8rQy5p0SD4oY8tbwiP6VxMlSMGeKWYUj/lG/7U+dM/s7jaPDgYnVZbcM0LL/i/ky/p9+NinqXqTEFNRaqE//NSxO4ai1pMNDDE+AQdZrD6suGAnUMWQmixcTC0MVj23YoooKhxYx6/rCXJK7JLxK7mUXqLjE1vuSf1jYrX4u//7lF4cd///RXhJv5NtivBTQVj4r//rscgrJwV+XxXeFCsf+3gqJ8L7eDPxlyqCowKBHoLRJGnFHmXC5Od2dnbe7z/81LE+R9D5jQQYgbVbNScaUUegtFIicJAzCaC0SRpxR5lqWicW7O15v/+5Us7FXGzRpxZZloLRo0oo8xNSSJxZbXF5st/2WWSoZMrAwaORqyggVRyNWtlzI////////////6bsZUVUOzlMFBAjkOximBrSJVJVUxBTUUzLjEwMFVVVf/zUMTtGJCWLWwYRHFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuMTAwVVVVVVVVVVVVVVX/81LE/x9L9YQMMMXlVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy4xMDBVVVVVVVVVVVVVVf/zUMSKAAADSAAAAABVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVX/81LEiQAAA0gAAAAAVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVQ==',
    };

    // Recetas del sintetizador: es el fallback de todos los cues y suena aunque
    // no haya muestra decodificada todavia. len es la vida total de la secuencia.
    const SOUND_SYNTH = {
      reminder: { wave: 'triangle', seq: [880, 880],            step: 0.16, len: 0.50, gain: 0.55 },  // toc-toc
      madera:   { wave: 'sawtooth', seq: [196, 165, 130],       step: 0.16, len: 0.55, gain: 0.45, slide: true }, // feo, grave
      bronce:   { wave: 'square',   seq: [147, 110],            step: 0.18, len: 0.40, gain: 0.35, noise: true },  // sordo
      plata:    { wave: 'sawtooth', seq: [440, 415],            step: 0.20, len: 0.45, gain: 0.35, detune: 16 },   // meh
      racha:    { wave: 'square',   seq: [659, 880, 1175],      step: 0.07, len: 0.35, gain: 0.30 },  // blip ascendente
      diamante: { wave: 'sine',     seq: [1319, 1976],          step: 0.10, len: 0.55, gain: 0.50 },  // campana
      super:    { wave: 'triangle', seq: [523, 659, 784, 1047], step: 0.10, len: 0.65, gain: 0.45 },  // arpegio
    };

    let audioCtx = null, audioMaster = null, audioUnlockBound = false;
    const audioBuffers = new Map();          // id -> AudioBuffer (null = en vuelo)
    let lastTierCueAt = 0;
    const TIER_CUE_MIN_GAP_MS = 150;

    // Un solo AudioContext, perezoso: se crea en el primer gesto y se intenta
    // reanudar en cada uso. Devuelve null si el navegador todavia no dejo
    // reproducir (politica de autoplay) — el caller nunca reintenta en bucle.
    function ensureAudio() {
      try {
        if (!audioCtx) {
          const AC = window.AudioContext || window.webkitAudioContext;
          if (!AC) return null;
          audioCtx = new AC();
          audioMaster = audioCtx.createGain();
          audioMaster.gain.value = 0.7;       // gain master: volumen en un solo numero
          audioMaster.connect(audioCtx.destination);
        }
        if (audioCtx.state === 'suspended') {
          const p = audioCtx.resume();
          if (p && typeof p.catch === 'function') p.catch(() => {});
        }
        return audioCtx.state === 'running' ? audioCtx : null;
      } catch (e) { return null; }
    }

    // Desbloqueo de autoplay: el primer gesto del usuario (el que sea) crea y
    // reanuda el contexto, y adelanta la decodificacion de las muestras.
    function bindAudioUnlock() {
      if (audioUnlockBound) return;
      audioUnlockBound = true;
      const on = () => { if (ensureAudio()) preloadSamples(); };
      window.addEventListener('pointerdown', on, { passive: true });
      window.addEventListener('keydown', on, { passive: true });
    }
    function preloadSamples() { SOUND_CUE_IDS.forEach((id) => decodeSample(id)); }

    function dataUriBuffer(uri) {
      const bin = atob(uri.slice(uri.indexOf(',') + 1));
      const out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out.buffer;
    }

    function decodeSample(id) {
      const uri = SOUND_SAMPLES[id];
      if (!audioCtx || !uri || audioBuffers.has(id)) return;
      audioBuffers.set(id, null);             // marca "en vuelo": no relanzar el decode
      try {
        audioCtx.decodeAudioData(dataUriBuffer(uri),
          (buf) => audioBuffers.set(id, buf),
          () => audioBuffers.delete(id));     // muestra ilegible -> sintetizador
      } catch (e) { audioBuffers.delete(id); }
    }

    function playSample(ctx, buf) {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(audioMaster);
      src.start();
    }

    // Sintetizador: secuencia de notas cortas con envolvente + ruido opcional.
    function playSynth(ctx, r) {
      const noteLen = r.len / Math.max(1, r.seq.length);
      const t0 = ctx.currentTime + 0.02;
      const master = ctx.createGain();
      master.gain.value = (r.gain || 0.45) * 0.5;
      master.connect(audioMaster);
      r.seq.forEach((freq, i) => {
        const t = t0 + i * r.step;
        const osc = ctx.createOscillator();
        osc.type = r.wave;
        osc.frequency.setValueAtTime(freq, t);
        if (r.slide) osc.frequency.exponentialRampToValueAtTime(Math.max(40, freq * 0.65), t + noteLen);
        if (r.detune) osc.detune.value = r.detune;
        const env = ctx.createGain();
        env.gain.setValueAtTime(0.0001, t);
        env.gain.exponentialRampToValueAtTime(0.9, t + 0.012);
        env.gain.exponentialRampToValueAtTime(0.0001, t + noteLen);
        osc.connect(env);
        env.connect(master);
        osc.start(t);
        osc.stop(t + noteLen + 0.03);
      });
      if (r.noise) {
        const n = Math.floor(ctx.sampleRate * 0.12);
        const b = ctx.createBuffer(1, n, ctx.sampleRate);
        const d = b.getChannelData(0);
        for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
        const s = ctx.createBufferSource();
        s.buffer = b;
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 700;
        s.connect(lp);
        lp.connect(master);
        s.start(t0);
      }
    }

    // Punto unico de reproduccion. NUNCA lanza: si el navegador retiene el
    // audio, el cue se descarta en silencio y la leccion sigue igual (spec:
    // "Sound never blocks or breaks the lesson").
    function playCue(id) {
      try {
        if (!SOUND_SYNTH[id]) return;
        const ctx = ensureAudio();
        if (!ctx) return;
        if (SOUND_SAMPLES[id] && !audioBuffers.has(id)) decodeSample(id);
        const buf = audioBuffers.get(id);
        if (buf) playSample(ctx, buf);
        else playSynth(ctx, SOUND_SYNTH[id]);
      } catch (e) { /* audio bloqueado: jamas rompe la leccion */ }
    }

    // Fanfarria del peldaño cerrado. Un cierre = un cue; si dos caen con menos
    // de 150ms se ATRASA, nunca se descarta (spec: suena en cada cierre).
    function playTierCue(rung) {
      if (!cfg.soundCues) return;
      const id = cueForRung(rung);
      if (!id) return;
      const now = Date.now();
      const wait = TIER_CUE_MIN_GAP_MS - (now - lastTierCueAt);
      if (wait > 0) {
        setTimeout(() => { lastTierCueAt = Date.now(); playCue(id); }, wait);
      } else {
        lastTierCueAt = now;
        playCue(id);
      }
    }

    // ---- recordatorio periódico ------------------------------------------
    // remind-only-when-idle: suena SOLO cuando NO estás enfocado — 45 s sin
    // interacción o pestaña oculta (spec: "solo en idle"). Vivo SOLO cuando
    // cfg.reminderEnabled: apagado no queda ni timer ni listeners de
    // interacción ni audio preparado (spec: "todo apagado no cuesta nada").
    // No depende de la barra ni de la pantalla: suena en cualquier screen.
    let reminderTimer = 0, reminderNextAt = 0, reminderPending = false;
    let lastInteractionAt = 0, pendingReturnAt = 0;
    // reminder-desktop-notification: último resultado del canal de escritorio
    // ('blocked' | 'unsupported' | null = entregada). El panel lo muestra
    // (3.x): un toggle que dice "on" mientras nada llega es peor que no tener
    // toggle. Se limpia en el próximo intento que SÍ se entrega (spec).
    let notifDeliveryState = null;
    const REMINDER_TICK_MS = 1000;
    const REMINDER_RETURN_GRACE_MS = 5000;
    // Los seis gestos que cuentan como "estás usando la página". Capture para
    // verlos también cuando no burbujean (p. ej. scroll de un contenedor).
    const REMINDER_IDLE_EVENTS = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'scroll', 'touchstart'];
    function stampInteraction() { lastInteractionAt = Date.now(); }

    function stopReminder() {
      if (reminderTimer) { clearInterval(reminderTimer); reminderTimer = 0; }
      REMINDER_IDLE_EVENTS.forEach((ev) => document.removeEventListener(ev, stampInteraction, true));
    }
    function startReminder() {
      stopReminder();
      // Encender cuenta como interacción: nada suena en los primeros 45 s de
      // un recordatorio recién armado. Los listeners viven con el toggle.
      lastInteractionAt = Date.now();
      REMINDER_IDLE_EVENTS.forEach((ev) =>
        document.addEventListener(ev, stampInteraction, { capture: true, passive: true }));
      reminderNextAt = Date.now() + clampReminderSeconds(cfg.reminderSeconds) * 1000;
      reminderPending = false;
      pendingReturnAt = 0;
      reminderTimer = setInterval(reminderTick, REMINDER_TICK_MS);
    }
    function syncReminder() { if (cfg.reminderEnabled) startReminder(); else stopReminder(); }

    // reminder-desktop-notification: el panel dice lo que pasó con el último
    // intento del canal de escritorio. Un toggle que lee "prendido" mientras
    // nada llega es peor que no tener toggle (spec: el panel distingue
    // entregando de bloqueado). Se limpia solo: el próximo intento que SÍ se
    // entrega esconde el aviso, sin recargar nada.
    function renderNotifStatus() {
      const el = document.querySelector('#adhd-reminder-notif-status');
      if (!el) return;
      if (!notifDeliveryState) { el.style.display = 'none'; el.textContent = ''; return; }
      el.style.display = '';
      el.style.color = '#b41e1e';
      el.textContent = tr(cfg.lang, notifDeliveryState === 'blocked' ? 'notifBlocked' : 'notifUnsupported');
    }

    // Máquina de estados mínima: la decisión vive en reminderAction (pura,
    // testeable); el tick solo ejecuta lo que ella dicta. Si toca enfocado u
    // oculto queda UNO pendiente (sin mover el vencimiento), así nunca se
    // acumula deuda ni suena una ráfaga al volver; suena cuando el idle lo
    // permite y el próximo intervalo nace de ESE momento (spec: "plays once
    // the user becomes idle", "at most one reminder instead of a burst").
    function reminderTick() {
      try {
        const ms = clampReminderSeconds(cfg.reminderSeconds) * 1000;
        const now = Date.now();
        const action = reminderAction({
          now, nextAt: reminderNextAt, hidden: document.hidden,
          lastInteractionAt, notifEnabled: cfg.reminderNotifEnabled,
        });
        if (action === 'none') return;
        if (action === 'pending') {
          reminderPending = true;
          return;
        }
        if (action === 'notify') {
          // reminder-desktop-notification: la pestaña está oculta — el canal
          // es el escritorio. Entregada: el próximo intervalo nace de AHORA
          // (sin deuda acumulada) y el mismo cue suena junto si el audio está
          // vivo (playCue degrada en silencio si no). No entregada (sin API o
          // con error): el comportamiento de antes — queda UNO pendiente — y
          // el estado queda registrado para que el panel lo diga.
          const r = notifyReminder(tr(cfg.lang, 'notifTitle'), tr(cfg.lang, 'notifBody'));
          if (r === 'sent') {
            playCue('reminder');
            reminderPending = false;
            reminderNextAt = Date.now() + ms;
            notifDeliveryState = null;
          } else {
            notifDeliveryState = r;
            reminderPending = true;
          }
          renderNotifStatus();
          return;
        }
        if (now < pendingReturnAt) return;   // gracia tras volver a la pestaña
        playCue('reminder');
        reminderPending = false;
        reminderNextAt = Date.now() + ms;
      } catch (e) { /* el tick jamas tira */ }
    }

    document.addEventListener('visibilitychange', () => {
      if (!reminderTimer || document.hidden) return;
      // Al volver: ~5 s de gracia antes de que un pendiente pueda sonar, para
      // no gritarle a quien ya volvió a trabajar. Si nada pendía, el vencimiento
      // se resetea como siempre (el tiempo oculto no vence nada).
      pendingReturnAt = Date.now() + REMINDER_RETURN_GRACE_MS;
      if (!reminderPending) {
        reminderNextAt = Date.now() + clampReminderSeconds(cfg.reminderSeconds) * 1000;
      }
    });

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
    // fix-crono-contrast: superficie del contador en urgencia (últimos 20% de la
    // vuelta): rojo SÓLIDO; el dígito blanco lo lee a ~6.7:1.
    const CRONO_URGENT_BG = '#b41e1e';
    let miniCronoInterval = null; // intervalo de actualización del mini cronómetro
    let currentRaceMs = 0;        // tiempo transcurrido en carrera actual
    // Feature 3: diario
    let journal = null;           // diario local (cargado bajo demanda)
    let lessonStartTs = 0;        // timestamp de inicio de lección
    // arena-timer-overhaul: estado del rediseño del timer
    let decayEl = null;           // timeline de decaimiento (riel continuo por vueltas)
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
        /* Respaldo SÓLIDO hasta el primer tick (que pinta el color del peldaño).
           Sin transparencias: una superficie translúcida hacía depender el
           contraste de lo que hubiera detrás (fix-crono-contrast). */
        background: #1c2b3a; color: #fff; white-space: nowrap;
        transition: background-color .4s ease, color .4s ease;
      }

      /* reward-fx-canvas: la etiqueta "⚡ RÁPIDO" se elimina. Vivía en
         top:-30px dentro de .adhd-overlay (overflow:hidden), así que quedaba
         recortada y nunca se veía. La reemplazan los overlays de recompensa. */

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

      /* flash de escalón: overlay remonteado por caída (nunca interrumpe width) */
      .adhd-seg.adhd-blink-hard { animation: adhd-blink-hard 420ms steps(1) infinite; }
      .adhd-loss-flash {
        position:absolute; inset:0; border-radius:9999px; pointer-events:none;
        background:#ff4b4b; animation: adhd-loss-flash 180ms linear forwards;
      }

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
      /* seg-skin-earned-at-close: el sliding shine muere con el tramo dormido —
         era ambientación pura del activo. Sus reglas se retiran; el keyframe
         adhd-sweep2 queda (lo usan los sweeps de ::before de peldaño bajo). */
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
      /* rail-deck-ratchet: wrap. El riel se recarga; el filo de la cabeza hace
         una sola pasada de barrido (mismo lenguaje que el sweep permanente).
         No hay nodo nuevo: se reinicia la animacion del sweep existente. */
      @keyframes adhd-rail-wrap { 0% { opacity: 1; } 100% { opacity: .25; } }
      .adhd-rail-head.adhd-rail-wrap { animation: adhd-rail-wrap 560ms ease-out; }

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
      .adhd-mini-crono.urgent { background: #b41e1e; color: #fff; }
      .adhd-mini-crono .adhd-hourglass { font-size: 14px; vertical-align: 2px; margin-right: 2px; }
      /* rail-deck-ratchet: marcador de vuelta. Secondary al digito (el
         cronometro sigue siendo el resto de la vuelta en curso), asi que va
         atenuado y sin tabular. */
      .adhd-mini-crono .adhd-lap-mark {
        font-size: 12px; font-weight: 700; line-height: 1; opacity: .7;
        margin-left: 4px; vertical-align: 1px;
      }
      .adhd-mini-crono .adhd-lap-mark.spent { opacity: .95; }

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

      /* ===== seg-skin-earned-at-close: el tramo dormido =====
         Mientras un tramo se LLENA es dormido: tono apagado plano (el matiz
         nombra al peldaño; la croma no), cero loops ambientales, cero
         ornamentos. El fondo plano deja que la caída de peldaño transicione
         nativa — el crossfade de pieles de tramo-fx-round2 ya no corre en el
         activo (su span sigue existiendo para otros usos y acá también va
         dormido). El CIERRE quita la clase en el mismo swap que congela: la
         piel viva ES la recompensa. La opacidad del llenado no se toca: es
         progreso, no decoración. */
      .adhd-dormant {
        background: var(--adhd-dormant, #8a8f98) !important;
        transition: background-color .32s ease;
      }
      .adhd-seg.adhd-dormant::before,
      .adhd-seg.adhd-dormant::after { content: none !important; }
      .adhd-seg.adhd-dormant .adhd-sweep,
      .adhd-seg.adhd-dormant .adhd-flash,
      .adhd-seg.adhd-dormant .adhd-rung-deco { display: none !important; }

      /* ===== animations-panel-setting: kill switch (la info nunca depende de la animación) =====
         Antes era una regla @media (prefers-reduced-motion: reduce). Ahora es
         la clase body.adhd-motion-off, que JS alterna según el nivel del usuario
         y la preferencia del sistema (ver aplicarMotion). Motivo: una sola
         fuente de verdad, así el CSS y el JS no pueden discrepar.

         ALCANCE (reescrito por seg-skin-earned-at-close): EFECTOS y MOVIMIENTO
         de piel. La IDENTIDAD es material y sobrevive como frame estático: el
         color, la composición del degradado y las texturas de los peldaños
         congelados no se tocan. Lo que muere bajo calma: los efectos y su
         decoración de apoyo, y desde este change el MOVIMIENTO de las pieles
         — el flicker de racha, el degradado animado de diamante/super y el
         glow del legendario colapsan a frame estático, y los ornamentos
         (embers/sparkles, sweep y flash del legendario, sus franjas blancas)
         no se renderizan. El split explícito: movimiento y ornamento son
         motion; color, degradado y textura son material. Antes las pieles
         enteras quedaban fuera (“material, no animación”) y animaban sus
         degradados para siempre incluso con motion off.

         El barrido de la cabeza del riel (.adhd-rail-head::after) sigue adentro:
         es animación, y era su única señal de vida. El costo perceptual de
         apagarlo está escrito en el requirement de motion-preference.

         Prefijo explícito en vez de anidamiento CSS: el archivo se inyecta en
         cualquier browser y no vale depender de soporte de nesting. */
        body.adhd-motion-off .adhd-loss-flash,
        body.adhd-motion-off .adhd-halo,
        body.adhd-motion-off .adhd-rung-prev,
        body.adhd-motion-off .adhd-rail-head::after,
        body.adhd-motion-off .adhd-rail-head.urgent,
        body.adhd-motion-off .adhd-rail-head.adhd-rail-wrap,
        body.adhd-motion-off .adhd-part2,
        body.adhd-motion-off .adhd-ring,
        body.adhd-motion-off .adhd-seg.adhd-blink,
        body.adhd-motion-off .adhd-seg.adhd-legendary,
        body.adhd-motion-off .adhd-rung-racha,
        body.adhd-motion-off .adhd-rung-diamante,
        body.adhd-motion-off .adhd-rung-super {
          animation-duration: 1ms !important; animation-iteration-count: 1 !important; animation-delay: 0ms !important;
        }
        /* seg-skin-earned-at-close: los ornamentos no se RENDERIZAN bajo calma
           (en el cierre JS ya no los crea — esto cubre el cambio de nivel en
           caliente sobre tramos congelados con motion permitido). */
        body.adhd-motion-off .adhd-rung-deco,
        body.adhd-motion-off .adhd-seg.adhd-legendary .adhd-sweep,
        body.adhd-motion-off .adhd-seg.adhd-legendary .adhd-flash { display:none !important; }
        body.adhd-motion-off .adhd-seg.adhd-legendary::before,
        body.adhd-motion-off .adhd-seg.adhd-legendary::after { display:none !important; }
        body.adhd-motion-off .adhd-part2,
        body.adhd-motion-off .adhd-ring { display:none; }
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

      // rail-fixed-lap-ceiling: marcador de VUELTA. Reusa el cronometro (sin
      // nodos nuevos en el riel): ⟳N desde la segunda vuelta. Se actualiza
      // aparte de renderDigits porque los digitos se saltan frames y el wrap
      // tiene que verse siempre.
      let lapMark = null;
      function renderLapMarker(lap) {
        if (lap < 1) {
          if (lapMark) { lapMark.remove(); lapMark = null; }
          return;
        }
        if (!lapMark) {
          lapMark = document.createElement('span');
          lapMark.className = 'adhd-lap-mark';
          miniCronoEl.appendChild(lapMark);
        }
        const text = '⟳' + (lap + 1);
        if (lapMark.textContent !== text) lapMark.textContent = text;
      }

      // arena-timer-overhaul: proyección por TIEMPO PURO quemado (no por ritmo).
      // rail-fixed-lap-ceiling: contra la escalera en play (vueltas), sin bandas.
      function tick() {
        if (!miniCronoEl || !raceStartTime) return;
        const elapsed = Date.now() - raceStartTime;
        const L = currentLadder(elapsed);
        if (!L) return;
        const projected = L.tier;
        const frac = L.frac;
        // Restante de la VUELTA en curso (se resetea en cada recarga).
        renderDigits(Math.max(0, goalMs - (elapsed % goalMs)));
        renderLapMarker(L.lap);

        const R = RUNGS[projected];

        // Urgencia >80% de la vuelta: blink hard + ⌛ (nunca sólo color). Avisa de
        // que estás por perder el peldaño de la vuelta, el único costo intra-vuelta.
        const urgent = frac > 0.8;

        // fix-crono-contrast: el color del peldaño es la SUPERFICIE del contador
        // (sólida) y el dígito se empareja para leerse sobre ella (blanco o la
        // tinta del peldaño, ≥3:1 en los seis). Antes R.from iba como texto sobre
        // una pill oscura: madera 1.29:1, bronce 1.09:1. El fondo se decide acá
        // (no en .urgent) porque el estilo inline le gana a la regla de clase.
        miniCronoEl.style.background = urgent ? CRONO_URGENT_BG : R.from;
        miniCronoEl.style.color = urgent ? '#ffffff' : cronoTextColor(R.from, R.ink);
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

        updateDecayTimeline(L);
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
      // rail-deck-ratchet: el lap se deriva de raceStartTime, asi que la escalera
      // vuelve a la vuelta 1 sola. Se limpia la firma para que el reinicio de
      // tramo no dispare el sweep de wrap (no hubo wrap: arranco otra carrera).
      lastRailLap = -1;
      stopMiniCrono();
      startMiniCrono();
    }

    // 6.4 feedback: TODO lo anclado a <body> (crono, timeline, labels) muere con la
    // barra. Si no, queda flotando sobre la pantalla de celebración / próxima vista.
    // decay-timeline-visibility (D4): acá SÍ se borra el timeline (fin de vida real:
    // pantalla perdida, SPA fuera de lección, timer OFF).
    // reward-fx-canvas: los overlays de canvas también mueren acá, o quedarían
    // flotando sobre la pantalla de celebración al navegar (mismo bug que el riel).
    function teardownTimerFx() {
      raceStartTime = 0;
      lastProjectedRung = null;
      clearBarMissing();
      stopMiniCrono();
      removeDecayTimeline();
      destroyRewardFx();
    }

    // =====================================================================
    // arena-timer-overhaul: timeline de decaimiento + partículas (el combat text
    // se retiró en tramo-fx-round2; ver la nota de eliminación más abajo).
    // =====================================================================

    // rail-deck-ratchet: firmas de la escalera en play y de la vuelta del riel.
    // Se resetean al (re)construir el timeline para que el marco de referencia se
    // repinte aunque la escalera sea la misma.
    let lastLadderKey = '';
    let lastRailLap = -1;

    // Geometría del riel. GAP = aire entre barra y riel. H = alto total del
    // chrome (20px riel + 2px padding*2 + 2px borde*2); fallback si el
    // elemento todavía no se midió. Espejo de --adhd-rail-h en el CSS.
    const ADHD_TIMELINE_GAP = 8;
    const ADHD_TIMELINE_H  = 28;

    // fix-reward-fx-killed-by-transient-bar-loss: perder la barra un instante NO
    // es un fin de vida. Duolingo re-renderiza la fila de la leccion al responder
    // (boton de salir + barra) y hay un batch de mutaciones en que el detector no
    // la encuentra. Ese solo batch tumbaba el efecto de recompensa en vuelo, el
    // cronometro y el riel, sin que nada hubiera terminado.
    //
    // El periodo de gracia NO puede vivir en el observer: con la pagina quieta no
    // llega ningun batch, asi que "N misses seguidos" no vence nunca y el cronometro
    // no se iría jamás de una pantalla que ya no es leccion. Por eso es un timer que
    // vuelve a preguntar.
    //
    // 250ms: alcanza para el re-render y los batches que ocurren dentro de el, y no
    // deja un overlay a pantalla completa colgando tiempo discernible.
    const BAR_MISSING_GRACE_MS = 250;
    let barMissingSince = 0;
    let barGraceTimer = 0;

    function clearBarMissing() {
      barMissingSince = 0;
      if (barGraceTimer) { clearTimeout(barGraceTimer); barGraceTimer = 0; }
    }

    function onBarMissing() {
      if (barGraceTimer) return;              // ya hay una pregunta agendada
      barMissingSince = Date.now();
      barGraceTimer = setTimeout(function () {
        barGraceTimer = 0;
        // La barra volvio (mismo nodo o equivalente): no era nada.
        if (ensureRoots()) { clearBarMissing(); return; }
        clearBarMissing();
        teardownTimerFx();
      }, BAR_MISSING_GRACE_MS);
    }

    // rail-fixed-lap-ceiling: la escalera en play para una carrera de `elapsed` ms.
    // Una sola fuente de verdad: riel, cronometro, preview del tramo y el cierre
    // del tramo evalúan TODOS contra este objeto, asi que no pueden discrepar.
    function currentLadder(elapsedMs) {
      return ladderAt(elapsedMs, getTimerGoalMs(cfg));
    }

    // Rótulo localizado del peldaño para la etiqueta del riel.
    const RAIL_LABEL_KEYS = ['railMadera','railBronce','railPlata','railRacha','railDiamante','railSuper'];
    function railLabelFor(rung) {
      return tr(cfg.lang, RAIL_LABEL_KEYS[rung]);
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
      const goalMs = getTimerGoalMs(cfg);
      decayEl = document.createElement('div');
      decayEl.className = 'adhd-decay-timeline';
      decayEl.setAttribute('aria-hidden', 'true');
      // Firma de construccion: si cambia el objetivo, ensureDecayTimeline() sabe
      // que debe reconstruir.
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

      // Referencia de la escalera que se esta bajando (se repinta por vuelta).
      paintDescent(ladderAt(0, goalMs), goalMs);

      document.body.appendChild(decayEl);
      attachTimelineSync();
      positionDecayTimeline();
      updateDecayTimeline(ladderAt(0, goalMs));
    }

    // decay-timeline-visibility (D1): crea el timeline solo si falta, si su firma
    // quedó vieja (cambió el objetivo) o si perdió el nodo de la barra.
    // El chequeo `!bar.isConnected` cubre el re-render SPA: el nodo viejo queda
    // desconectado aunque la variable `bar` (cacheada) aún lo apunte.
    function ensureDecayTimeline() {
      const sig = String(getTimerGoalMs(cfg));
      if (decayEl && decayEl.isConnected && decayEl.dataset.goal === sig && bar && bar.isConnected) {
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
      lastLadderKey = '';
      lastRailLap = -1;
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

    // rail-fixed-lap-ceiling: la referencia ya no son muescas de banda (no hay
    // bandas) sino el DESCENSO: en que vuelta estoy y que peldaño trae cada
    // vuelta siguiente. Idempotente por firma: solo escribe al cambiar de vuelta.
    // El piso es Madera, asi que la lista termina y no se agota nunca.
    function paintDescent(L, goalMs) {
      if (!decayEl) return;
      const key = String(L.lap) + '|' + String(goalMs);
      if (key === lastLadderKey) return;
      lastLadderKey = key;
      const track = decayEl.querySelector('.adhd-rail-track');
      if (!track) return;

      // RUNGS es ASCENDENTE (0 = madera ... 5 = super), así que el descenso se
      // arma desde el peldaño en play hacia abajo, no desde el índice de vuelta.
      const steps = [];
      for (let i = L.tier; i >= 0; i--) {
        const R = RUNGS[i];
        steps.push((i === L.tier ? '\u25B6 ' : '') + R.glyph + ' ' + R.label +
                   (i === L.tier ? ' (vuelta ' + (L.lap + 1) + ')' : ''));
      }
      track.title = steps.join('  \u00b7  ');

      // Sin marco en el track: el material del fill, la etiqueta y esta
      // referencia son la escalera completa. Se limpia cualquier gradiente de
      // una versión anterior del script.
      decayEl.style.setProperty('--adhd-notches', 'none');
    }

    // redesign-decay-timeline: riel continuo. L = escalera en play (ladderAt).
    // - el fill RESTANTE se encoge desde la derecha con el material del
    //   peldaño de la vuelta (constante durante toda la vuelta);
    // - el earned GANADO crece desde la izquierda con el peldaño LOGRADO;
    // - la cabeza marca la frontera con un filo duro + sweep (direccion);
    // - la etiqueta dice el peldaño en texto legible (no formas).
    // rail-fixed-lap-ceiling: todo se mide contra la fraccion LOCAL de la vuelta,
    // asi el riel se recarga al 100% en vez de quedar clavado.
    function updateDecayTimeline(L) {
      if (!decayEl || !L) return;
      const projected = L.tier;
      const R = RUNGS[projected];
      const pct = Math.max(0, Math.min(1, L.frac));

      paintDescent(L, getTimerGoalMs(cfg));

      const fill = decayEl.querySelector('.adhd-rail-fill');
      const earned = decayEl.querySelector('.adhd-rail-earned');
      const head = decayEl.querySelector('.adhd-rail-head');
      const label = decayEl.querySelector('.adhd-rail-label');

      if (fill) {
        fill.style.width = ((1 - pct) * 100) + '%';
        // Material del peldaño de la vuelta = el estado, no decoracion.
        fill.style.setProperty('--adhd-fill',
          'linear-gradient(180deg,' + R.to + ' 0%,' + R.from + ' 100%)');
      }

      if (earned) {
        // Lo ganado se dibuja hasta la cabeza. En timer mode el rung ya
        // congelado del tramo en curso solo existe tras cerrarlo, asi que
        // hasta entonces queda neutro (el earned es "presupuesto ya quemado").
        earned.style.width = (pct * 100) + '%';
        const done = currentSegRungEarned();
        const RE = done === null ? null : RUNGS[done];
        earned.style.setProperty('--adhd-earned', RE
          ? 'linear-gradient(180deg,' + RE.to + ' 0%,' + RE.from + ' 100%)'
          : 'linear-gradient(180deg,#e4e7e9 0%,#b8bfc4 100%)');
      }

      if (head) {
        head.style.left = (pct * 100) + '%';
        // 2.4: la urgencia ya no avisa de una frontera de banda (no hay bandas):
        // avisa de que estás por perder el peldaño de la vuelta. Mismo umbral.
        head.classList.toggle('urgent', L.frac > 0.8);
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
        decayEl.dataset.rung = String(projected);
        decayEl.dataset.lap = String(L.lap);
        decayEl.title = R.glyph + ' ' + R.label + ' \u00b7 ' + Math.round(pct * 100) + '% quemado';
      }

      // Wrap: una sola pasada del sweep de la cabeza, sin nodos nuevos. El
      // reflow reinicia la animacion; el fill (120ms) + material (320ms) hacen
      // el rebobinado visual.
      if (L.lap !== lastRailLap) {
        if (lastRailLap >= 0) restartHeadSweep();
        lastRailLap = L.lap;
      }
    }

    // rail-deck-ratchet: reinicio one-shot del sweep de la cabeza (marca de wrap).
    function restartHeadSweep() {
      const head = decayEl && decayEl.querySelector('.adhd-rail-head');
      if (!head) return;
      head.classList.remove('adhd-rail-wrap');
      void head.offsetWidth;          // reflow: rearma la animacion
      head.classList.add('adhd-rail-wrap');
      setTimeout(() => head.classList.remove('adhd-rail-wrap'), 600);
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

    // =====================================================================
    // reward-fx-canvas: efectos de recompensa por jerarquia (pantalla completa)
    // =====================================================================
    // Se disparan al CERRAR un tramo, segun el peldaño logrado:
    //   Racha (3) -> StreakFlames  ·  Diamante (4) -> CrystalReward
    //   Super  (5) -> DuoReward     ·  Perdido (-1) y los bajos (0-2): sin FX
    //
    // Los 3 modulos viven en window (isolated world del sandbox). Son
    // overlays position:fixed;inset:0 con pointer-events:none, asi que ocupan
    // toda la pantalla sin robarle los clicks a la leccion.
    // count medido en el harness: DuoReward a 100 sprites daba p95 47ms (frames
    // perdidos) y a 36 da p95 25ms. Los cristales no tienen ese costo (p95 17.5ms
    // con 24), asi que solo se toca la densidad del Duo.
    // animations-panel-setting: una sola fuente de verdad para "motion off".
    // El CSS usa la clase body.adhd-motion-off; acá se decide y se aplica.
    const REDUCED_MQ = '(prefers-reduced-motion: reduce)';
    let motionMql = null;   // listener activo solo mientras el nivel es 'system'

    function motionOff() {
      const sys = typeof matchMedia === 'function' ? matchMedia(REDUCED_MQ).matches : false;
      return resolveMotion(cfg.motionLevel, sys);
    }

    // fix-reward-fx-static-and-duo-crash: la calma DECIDIDA por el sistema, con
    // el nivel en 'system'. Es lo que el panel explica: sin esta linea una
    // celebracion quieta es indistinguible de un efecto roto, y el usuario no
    // tiene donde mirar. Es estado derivado, no un flag guardado: no puede
    // quedar viejo respecto de la preferencia.
    function motionAskedBySystem() {
      return cfg.motionLevel === 'system' &&
        typeof matchMedia === 'function' && matchMedia(REDUCED_MQ).matches;
    }

    // Aplica el nivel actual. Idempotente: se puede llamar sin miedo.
    // Destruye las instancias cacheadas porque los 3 modulos congelan
    // `this.reduced` en su constructor (design decision 5).
    function aplicarMotion() {
      const off = motionOff();
      document.body.classList.toggle('adhd-motion-off', off);
      if (fxInstances) destroyRewardFx();
      return off;
    }

    // Con 'system' seguimos la preferencia del escritorio en vivo; con un
    // override explicito no tiene sentido seguir escuchando (design decision 6).
    function syncMotionListener() {
      const quiere = cfg.motionLevel === 'system' && typeof matchMedia === 'function';
      if (quiere && !motionMql) {
        motionMql = matchMedia(REDUCED_MQ);
        if (typeof motionMql.addEventListener === 'function') {
          motionMql.addEventListener('change', aplicarMotion);
        } else if (typeof motionMql.addListener === 'function') {
          motionMql.addListener(aplicarMotion);   // Safari viejo
        }
      } else if (!quiere && motionMql) {
        if (typeof motionMql.removeEventListener === 'function') {
          motionMql.removeEventListener('change', aplicarMotion);
        } else if (typeof motionMql.removeListener === 'function') {
          motionMql.removeListener(aplicarMotion);
        }
        motionMql = null;
      }
    }

    // 4.2: el valor efectivo viaja por `reduced`, que los 3 modulos aceptan tal
    // cual (fix-reward-fx-static-and-duo-crash). Antes se pasaba
    // `respectReducedMotion`, que cada modulo combinaba con AND contra su propia
    // consulta a matchMedia: con el nivel 'never' y un sistema sin preferencia,
    // la calma se perdia y el efecto se animaba igual.
    // La variante calmada es ademas chica y corta a proposito (fix del mismo
    // change): una pared de figuras quietas a pantalla completa es indistinguible
    // de un efecto roto. count achica la composicion y duration acorta la vida.
    // OJO con duration: los modulos acotan su duracion por abajo (1500ms en
    // llamas y cristales, 700ms en Duo cuando esta calmado) y playRewardFx
    // destruye la instancia con inst.duration + 400ms. Un duration menor al piso
    // del modulo mataria el efecto a mitad de camino, asi que se pasa el piso.
    // Y por arriba del piso, no en el: la entrada de los cristales dura 700ms y
    // la salida 800, asi que con la duracion minima no queda meseta y la version
    // calmada se ve como un fogonazo en vez de una calma.
    const fxOpts = () => {
      const calm = motionOff();
      return {
        StreakFlames: { reduced: calm, count: calm ? 4 : 18, duration: calm ? 1800 : 6000 },
        CrystalReward: { reduced: calm, count: calm ? 4 : 24, duration: calm ? 2200 : 6800 },
        DuoReward: { reduced: calm, count: calm ? 5 : 36, duration: calm ? 700 : 3000 },
      };
    };
    const FX_BY_RUNG = { 3: 'StreakFlames', 4: 'CrystalReward', 5: 'DuoReward' };
    const fxInstances = {};    // nombre -> instancia viva (larga, se reutiliza)
    const fxLastFire = {};     // nombre -> timestamp del ultimo burst
    const FX_MIN_GAP_MS = 400; // top: cruzar 4 tramos de golpe no apila 4 overlays

    // Instancia perezosa y larga: se crea en el primer uso y se reutiliza, para
    // no crear/destruir un canvas en cada disparo (eso además parpadea).
    function fxInstance(name) {
      if (fxInstances[name]) return fxInstances[name];
      const Ctor = window[name];
      if (typeof Ctor !== 'function') return null;
      fxInstances[name] = new Ctor(fxOpts()[name] || {}); // el modulo crea su overlay
      return fxInstances[name];
    }

    // Aditivo: convive con burstRung()/fireHalo(), que siguen intactos.
    function playRewardFx(rung) {
      if (!cfg.timerShowLabel) return;          // interruptor del panel
      const name = FX_BY_RUNG[rung];
      if (!name) return;                          // peldaños bajos: sin FX
      // tier-motion-per-seg: el eje por peldaño, JUNTO al reduced que ya
      // existe (fxOpts sigue decidiendo la presentación calmada; esto no
      // toca el contrato de resolveMotion ni la clase del body). 'off' =
      // este peldaño no celebra con canvas — solo el burst de CSS de siempre;
      // 'reduced' llega al constructor como reduced=true por fxOpts, igual
      // que antes. Sin reload: cada cierre lee cfg.tierMotionFloor en vivo.
      const sys = typeof matchMedia === 'function' ? matchMedia(REDUCED_MQ).matches : false;
      if (tierMotionFor({ level: cfg.motionLevel, reduce: sys, rung, floor: cfg.tierMotionFloor }) === 'off') return;
      const now = Date.now();
      if (now - (fxLastFire[name] || 0) < FX_MIN_GAP_MS) return;
      fxLastFire[name] = now;
      const inst = fxInstance(name);
      if (!inst) return;
      // clear() previo: nunca quedan dos capas del mismo efecto apiladas
      if (typeof inst.clear === 'function') inst.clear();
      if (typeof inst.burst === 'function') inst.burst();
      // La instancia es larga para no construir un canvas en cada disparo, pero
      // un canvas transparente a pantalla completa queda como capa de
      // composicion mientras exista. Se destruye al terminar el efecto: el
      // siguiente burst la vuelve a crear perezosa.
      const ms = (inst.duration || 3000) + 400;
      setTimeout(() => {
        if (fxInstances[name] !== inst) return; // ya fue reemplazada/destruida
        if (typeof inst.destroy === 'function') inst.destroy();
        delete fxInstances[name];
        delete fxLastFire[name];
      }, ms);
    }

    // Fin de vida real: sin esto los canvas sobreviven a la navegacion de la SPA
    // y quedan flotando (el mismo bug que hacia con el riel antes de v2.7.1).
    function destroyRewardFx() {
      Object.keys(fxInstances).forEach(name => {
        const inst = fxInstances[name];
        if (inst && typeof inst.destroy === 'function') {
          try { inst.destroy(); } catch (e) { /* modulo sin destroy */ }
        }
        delete fxInstances[name];
        delete fxLastFire[name];
      });
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
    const RUNG_CLASSES = RUNGS.map(r => 'adhd-rung-' + r.id);

    function applyProjectedRung(segEl, projected, frac) {
      const cls = rungClass(projected);
      if (cls && !segEl.classList.contains(cls)) {
        segEl.classList.remove('adhd-rarity-verde', 'adhd-blink', ...RUNG_CLASSES);
        segEl.classList.add(cls);
        // Bajar de peldaño dentro del mismo tramo (la vuelta se recargó) es un
        // escalón, no una pérdida: el flash rojo lo marca y el tono dormido
        // transiciona nativo (el crossfade de pieles de tramo-fx-round2 ya no
        // corre acá: el activo es plano, no degradado).
        if (lastProjectedRung !== null && projected < lastProjectedRung) {
          flashLoss(segEl);
        }
        lastProjectedRung = projected;
        // seg-skin-earned-at-close (reversión del 6.4): el tramo activo es a
        // propósito lo más quieto de la barra — el silencio mientras llena es
        // lo que hace que el cierre se lea como ignición. Decoraciones heredadas
        // fuera: el tono dormido nombra al peldaño sin encenderlo.
        segEl.querySelectorAll('.adhd-rung-deco').forEach(d => d.remove());
      }
      // seg-skin-earned-at-close: el tramo que llena es dormido — el matiz
      // apagado del peldaño proyectado, plano y quieto hasta el cierre.
      segEl.classList.add('adhd-dormant');
      const tone = dormantTone(RUNGS[projected].from);
      if (tone && segEl.style.getPropertyValue('--adhd-dormant') !== tone) {
        segEl.style.setProperty('--adhd-dormant', tone);
      }
      // Urgencia por presupuesto quemado (no por avance visual): frac > 0.8
      segEl.classList.toggle('adhd-blink-hard', frac > 0.8 && frac < 1);
    }

    // rail-fixed-lap-ceiling: ya no hay flash de PÉRDIDA (no hay derrota). Este
    // marca un escalón a la baja dentro del tramo, cuando una vuelta se recarga.
    function flashLoss(segEl) {
      if (segEl.querySelector('.adhd-loss-flash')) return; // máx 1 flash vivo
      const f = document.createElement('span');
      f.className = 'adhd-loss-flash';
      f.setAttribute('aria-hidden', 'true');
      segEl.appendChild(f);
      setTimeout(() => f.remove(), 220);
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

    // Efectos del tramo ACTIVO: leading edge siempre (el frente del llenado).
    // seg-skin-earned-at-close: el sliding shine muere — ambientación pura en
    // un tramo que ahora es dormido por diseño.
    function ensureActiveFx(segEl) {
      // leading edge: sólo si hay llenado visible y no existe
      if (!segEl.querySelector('.adhd-edge')) {
        const edge = document.createElement('span');
        edge.className = 'adhd-edge';
        edge.setAttribute('aria-hidden', 'true');
        segEl.appendChild(edge);
      }
      const edge = segEl.querySelector('.adhd-edge');
      if (edge) edge.style.opacity = (parseFloat(segEl.style.width) > 1) ? '1' : '0';
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

        // seg-skin-earned-at-close: el legendario (solo existe en modo barra)
        // también duerme mientras llena — su gradiente épico, glow y sparkles
        // se encienden cuando cierra (la barra al 100%: curIdx pasa a T o el
        // tramo queda lleno). El CSS anima solo lo que la clase dormida no calla.
        if (seg.classList.contains('adhd-legendary')) {
          const full = segProgress(pct, i, T) >= segLength(T) - 1e-9;
          const dormLegacy = i === curIdx && !full;
          seg.classList.toggle('adhd-dormant', dormLegacy);
          if (dormLegacy) {
            const tone = dormantTone(LEGENDARY_ANCHOR);
            if (tone) seg.style.setProperty('--adhd-dormant', tone);
          }
          return;
        }

        // Con timerMode OFF: comportamiento posicional original
        if (!cfg.timerMode) {
          seg.style.boxShadow = i < curIdx ? '0 0 6px rgba(255,255,255,.35)' : 'none';
          if (i === curIdx) {
            // seg-skin-earned-at-close: el activo posicional duerme igual — el
            // matiz apagado de su rareza hasta que la frontera lo pasa.
            seg.classList.add('adhd-dormant');
            const tone = dormantTone(levelColor(i, T) || LEGENDARY_ANCHOR);
            if (tone) seg.style.setProperty('--adhd-dormant', tone);
            const done = Math.min(1, segDone / segLen);
            seg.style.opacity = String(0.25 + 0.75 * done);
          } else {
            seg.classList.remove('adhd-dormant');
            seg.style.opacity = '1';
          }
          return;
        }

        // Con timerMode ON: decaimiento por bandas (arena-timer-overhaul)
        const rarity = completedRarities[i];

        if (rarity !== undefined) {
          // Tramo cerrado: congela el rung ganado (la barra es un registro).
          // Swap quirúrgico — nunca className full-replace (timer-mode-ux 1.1)
          // seg-skin-earned-at-close: el MISMO swap que congela es la ignición —
          // el dormido se va con la clase y la piel viva entra, sin frame de
          // residuo dormido sobre un tramo cerrado.
          const frozenCls = rungClass(rarity);
          if (!seg.classList.contains(frozenCls)) {
            seg.classList.remove('adhd-blink', 'adhd-blink-hard', 'adhd-rarity-verde', 'adhd-dormant', ...RUNG_CLASSES);
            seg.classList.add(frozenCls);
            // Bajo calma no se crean ornamentos (spec seg-reward-skin R3): el
            // kill switch apaga los que hubiera dejado un nivel anterior.
            if (!motionOff()) addRungDecorations(seg, rarity);
          }
          seg.style.opacity = '1';
          seg.style.boxShadow = '0 0 6px rgba(255,255,255,.35)';
        } else if (i === curIdx) {
          // Tramo activo: el color del llenado ES el rung proyectado (tick lo actualiza
          // a 100ms; acá lo aplicamos también para que el primer frame no quede vacío).
          const done = segDone / segLen;
          if (raceStartTime > 0) {
            // rail-fixed-lap-ceiling: misma escalera en play que el riel (una sola
            // fuente de verdad), asi el preview del tramo nunca contradice al riel.
            const L = currentLadder(Date.now() - raceStartTime);
            if (L) {
              applyProjectedRung(seg, L.tier, L.frac);
              ensureActiveFx(seg);
            }
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
            const result = evaluateRace(raceMs, goalMs);
            if (result) {
              // Guardar rung final (número; 0 = madera — ¡no es falsy check!)
              completedRarities[tramoIdx] = result.rung;

              // Congelar el tramo con el skin del rung ganado (registro).
              const segEl = overlay.querySelector(`.adhd-seg[data-seg="${tramoIdx}"]`);
              if (segEl) {
                const frozenCls = rungClass(result.rung);
                segEl.classList.remove('adhd-active', 'adhd-blink', 'adhd-blink-hard', 'adhd-rarity-verde', 'adhd-dormant', ...RUNG_CLASSES);
                segEl.classList.add(frozenCls);
                segEl.style.opacity = '1';
                clearActiveFx(segEl);
                if (!motionOff()) addRungDecorations(segEl, result.rung);
              }

              // Partículas escaladas + reward fx: siempre hay peldaño (el piso es
              // Madera), asi que nunca hay un cierre "sin premio".
              {
                const stagger = (h - lastHitCount) * 250;
                setTimeout(() => burstRung(result.rung, xAt, false), stagger);
                if (result.rung === 5) setTimeout(fireHalo, stagger); // corona con halo
                // reward-fx-canvas: overlay de pantalla completa segun el peldaño
                // logrado (racha -> llamas, diamante -> cristales, super -> Duo).
                // Va DESPUÉS del burst para que el fx sea el remate, no el tapa.
                setTimeout(() => playRewardFx(result.rung), stagger + 180);
                // audio-cues: la fanfarria del peldaño congelado, en el mismo
                // instante que el burst. El gate es explicito aunque el bloque ya
                // esta tras `cfg.timerMode`: fuera del modo tiempo no hay rareza
                // evaluada, y por eso no hay sonido que disparar.
                if (cfg.soundCues && cfg.timerMode) setTimeout(() => playTierCue(result.rung), stagger);
              }

              // Feature 3: registrar en diario
              if (cfg.journalEnabled) {
                recordRaceTime(raceMs);
                recordSeparators(1);
              }

              // reward-fx-canvas: ya no hay etiqueta ⚡ RÁPIDO. El desempate
              // visual de los peldaños altos es el overlay de playRewardFx()
              // (racha -> llamas, diamante -> cristales, super -> Duo).
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
          const result = evaluateRace(raceMs, goalMs);
          if (result) {
            lastRung = result.rung;
            completedRarities[lastSegIdx] = result.rung;
            const lastSegEl = overlay.querySelector(`.adhd-seg[data-seg="${lastSegIdx}"]`);
            if (lastSegEl) {
              const frozenCls = rungClass(result.rung);
              lastSegEl.classList.remove('adhd-active', 'adhd-blink', 'adhd-blink-hard', 'adhd-rarity-verde', 'adhd-dormant', ...RUNG_CLASSES);
              lastSegEl.classList.add(frozenCls);
              lastSegEl.style.opacity = '1';
              clearActiveFx(lastSegEl);
              if (!motionOff()) addRungDecorations(lastSegEl, result.rung);
            }
            {
              burstRung(result.rung, cx, result.rung === 5); // Super cierra con doble oleada
              if (result.rung === 5) fireHalo();
              // reward-fx-canvas: mismo overlay por jerarquia al cerrar la ultima trama
              setTimeout(() => playRewardFx(result.rung), 180);
              // audio-cues: el ultimo tramo suena igual que cualquier otro cierre
              if (cfg.soundCues && cfg.timerMode) playTierCue(result.rung);
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
    // settings-btn-global-spa: idempotente. El observer la re-chequea en cada
    // batch de mutaciones, así que recrear el nodo en cada llamada tiraría el
    // panel abierto y el foco del teclado. Solo se reconstruye si el nodo
    // realmente no está en el documento.
    function injectSettingsBtn() {
      if (settingsBtn && settingsBtn.isConnected) return;
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
    // audio-cues: altavoz dibujado (mismo lenguaje vectorial que el reloj y el
    // libro: trazo actual, sin emoji, igual en todos los SO).
    const SOUND_SVG = '<svg class="adhd-sec-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/></svg>';
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
            <label><input type="checkbox" id="adhd-timer-label" ${cfg.timerShowLabel ? 'checked' : ''}> ${tr(cfg.lang, 'lblTimerLabel')}</label>
            <button id="adhd-test-fx">${tr(cfg.lang, 'btnTestFx')}</button>
            <div class="adhd-hint">${tr(cfg.lang, 'hintTimerGoal')}</div>
            <div style="font-size:11px;color:#666;margin-top:4px;">${isEn ? 'Avg' : 'Promedio'}: ${avgDisplay}</div>
          </div>
          <label for="adhd-motion">${tr(cfg.lang, 'lblMotion')}</label>
          <select id="adhd-motion">
            <option value="system"${cfg.motionLevel === 'system' ? ' selected' : ''}>${tr(cfg.lang, 'motionSystem')}</option>
            <option value="always"${cfg.motionLevel === 'always' ? ' selected' : ''}>${tr(cfg.lang, 'motionAlways')}</option>
            <option value="never"${cfg.motionLevel === 'never' ? ' selected' : ''}>${tr(cfg.lang, 'motionNever')}</option>
          </select>
          <div class="adhd-hint">${tr(cfg.lang, 'hintMotion')}</div>
          ${motionAskedBySystem() ? `<div class="adhd-hint" id="adhd-motion-system-hint">${tr(cfg.lang, 'hintMotionSystem')}</div>` : ''}
          <label for="adhd-tier-motion">${tr(cfg.lang, 'lblTierMotion')}</label>
          <select id="adhd-tier-motion">
            <option value="3"${cfg.tierMotionFloor === 3 ? ' selected' : ''}>${tr(cfg.lang, 'tierMotionRacha')}</option>
            <option value="4"${cfg.tierMotionFloor === 4 ? ' selected' : ''}>${tr(cfg.lang, 'tierMotionDiamante')}</option>
            <option value="5"${cfg.tierMotionFloor === 5 ? ' selected' : ''}>${tr(cfg.lang, 'tierMotionSuper')}</option>
            <option value="6"${cfg.tierMotionFloor === 6 ? ' selected' : ''}>${tr(cfg.lang, 'tierMotionNone')}</option>
          </select>
          <div class="adhd-hint">${tr(cfg.lang, 'hintTierMotion')}</div>
          </div>
        </details>
      `;

      // ===== Sección SONIDO (audio-cues, cerrada) =====
      // Los cuatro controles son funcionales (regla de settings-panel-visuals):
      // los dos toggles y el intervalo persisten via setCfg(), y el boton
      // reproduce un cue al toque — que ademas sirve de desbloqueo del
      // AudioContext. Ver specs/audio-cues/spec.md.
      html += `
        <details>
          <summary>${SOUND_SVG}<span>${tr(cfg.lang, 'secSonido')}</span></summary>
          <div class="adhd-sec-body">
          <label><input type="checkbox" id="adhd-sound-cues" ${cfg.soundCues ? 'checked' : ''}> ${tr(cfg.lang, 'lblSoundCues')}</label>
          <div class="adhd-hint">${tr(cfg.lang, 'hintSoundCues')}</div>
          <label><input type="checkbox" id="adhd-reminder" ${cfg.reminderEnabled ? 'checked' : ''}> ${tr(cfg.lang, 'lblReminder')}</label>
          <div class="adhd-hint">${tr(cfg.lang, 'hintReminder')}</div>
          <label><input type="checkbox" id="adhd-reminder-notif" ${cfg.reminderNotifEnabled ? 'checked' : ''}> ${tr(cfg.lang, 'lblReminderNotif')}</label>
          <div class="adhd-hint">${tr(cfg.lang, 'hintReminderNotif')}</div>
          <div class="adhd-hint" id="adhd-reminder-notif-status" style="display:none;"></div>
          <label for="adhd-reminder-secs">${tr(cfg.lang, 'lblReminderInterval')}: <span class="adhd-val" id="adhd-reminder-secs-val">${formatIntervalLabel(cfg.reminderSeconds)}</span></label>
          <input type="range" id="adhd-reminder-secs" min="${REMINDER_MIN_SECONDS}" max="${REMINDER_MAX_SECONDS}" step="15" value="${clampReminderSeconds(cfg.reminderSeconds)}" aria-label="${tr(cfg.lang, 'lblReminderInterval')}">
          <button id="adhd-test-sound">${tr(cfg.lang, 'btnTestSound')}</button>
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
      panel.querySelector('#adhd-timer-label').addEventListener('change', (e) => {
        setCfg('timerShowLabel', e.target.checked);
      });

      // animations-panel-setting: 3.2 persistir + 4.1/4.4 aplicar en vivo.
      // No se reconstruye el panel: el <select> ya muestra el valor nuevo, y
      // aplicarMotion() sincroniza la clase del <body> y las instancias de FX.
      panel.querySelector('#adhd-motion').addEventListener('change', (e) => {
        const v = e.target.value;
        // Un valor fuera de la lista no se persiste: el select siempre manda
        // uno de los tres, pero el storage podria venir editado a mano.
        if (MOTION_LEVELS.indexOf(v) === -1) { e.target.value = cfg.motionLevel; return; }
        setCfg('motionLevel', v);
        syncMotionListener();
        aplicarMotion();
      });

      // tier-motion-per-seg: el eje por peldaño persiste igual que el nivel.
      // Sin reload y sin tocar instancias: el próximo cierre lee cfg en vivo,
      // y el `reduced` congelado en cada constructor no depende del piso.
      panel.querySelector('#adhd-tier-motion').addEventListener('change', (e) => {
        const v = parseInt(e.target.value, 10);
        // Basura editada a mano no se persiste: el fallback del 1.4
        // (clampTierMotionFloor) es el único juez de qué es un piso válido.
        if (clampTierMotionFloor(v) !== v) {
          e.target.value = String(clampTierMotionFloor(cfg.tierMotionFloor));
          return;
        }
        setCfg('tierMotionFloor', v);
      });

      // audio-cues: los dos toggles y el intervalo persisten via setCfg(); el
      // intervalo reinicia el scheduler para que el proximo vencimiento salga
      // del valor nuevo sin recargar la pagina.
      panel.querySelector('#adhd-sound-cues').addEventListener('change', (e) => {
        setCfg('soundCues', e.target.checked);
      });
      panel.querySelector('#adhd-reminder').addEventListener('change', (e) => {
        setCfg('reminderEnabled', e.target.checked);
        syncReminder();
      });
      // reminder-desktop-notification: el toggle del canal de escritorio.
      // Sin syncReminder: el tick lee cfg en vivo, no hay ciclo de vida que
      // reiniciar (spec: el cambio aplica sin recargar).
      panel.querySelector('#adhd-reminder-notif').addEventListener('change', (e) => {
        setCfg('reminderNotifEnabled', e.target.checked);
      });
      // El panel pinta el estado del último intento tal como esté.
      renderNotifStatus();
      const reminderSecs = panel.querySelector('#adhd-reminder-secs');
      reminderSecs.addEventListener('input', () => {
        panel.querySelector('#adhd-reminder-secs-val').textContent = formatIntervalLabel(reminderSecs.value);
      });
      reminderSecs.addEventListener('change', () => {
        setCfg('reminderSeconds', clampReminderSeconds(parseInt(reminderSecs.value, 10)));
        syncReminder();
      });
      // Un click es un gesto de usuario: ademas de sonar al toque, este boton
      // desbloquea el AudioContext para todos los cues que vengan despues.
      panel.querySelector('#adhd-test-sound').addEventListener('click', () => {
        if (ensureAudio()) preloadSamples();
        playCue('reminder');
      });

      // tramo-fx-round2 (D4): calibración en vivo — cicla los 6 bursts + un escalón
      // SIN esperar cruces. Spacing 1400ms: el burst vive ~1.2s y el cap 44
      // recién libera, así Super nunca se recorta (design D4, riesgo de apilado).
      // reward-fx-canvas: el mismo botón sirve de vista previa de los overlays.
      // El clear() de playRewardFx() evita que dos canvas coexistan en el ciclo.
      panel.querySelector('#adhd-test-fx').addEventListener('click', () => {
        if (!bar || !overlay) return;
        for (let r = 0; r <= 5; r++) {
          setTimeout(() => burstRung(r, 50, r === 5), r * 1400);
          setTimeout(() => playRewardFx(r), r * 1400 + 180);
        }
        setTimeout(() => { // escalón a la baja dentro del tramo: crossfade + flash
          // El guard del click queda viejo a esta altura: 8,4 s de timers
          // después, la navegación (watchPath) pudo haber destruido el overlay.
          // Sin este re-chequeo, un click + navegación rápida revienta el
          // callback con TypeError (lo expuso la ruta tier5 del e2e).
          if (!overlay) return;
          const seg = overlay.querySelector('.adhd-seg.adhd-active') || overlay.querySelector('.adhd-seg');
          if (!seg || seg.querySelector('.adhd-rung-prev')) return;
          const s = document.createElement('span');
          s.className = 'adhd-rung-prev adhd-rung-madera';
          s.setAttribute('aria-hidden', 'true');
          seg.appendChild(s);
          setTimeout(() => s.remove(), 360);
          flashLoss(seg);
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
        // audio-cues: el reset devuelve los defaults (recordatorio encendido,
        // 60s), asi que el scheduler se vuelve a armar con el valor nuevo.
        syncReminder();
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
        // settings-btn-global-spa: el engranaje es de PANTALLA, no de carrera.
        // Se crea en init() y se recupera acá si el nodo se perdió en un remount
        // de la SPA, así nunca hace falta recargar. Una lectura booleana por
        // batch: no agrega timer ni observer nuevo.
        if (!settingsBtn || !settingsBtn.isConnected) injectSettingsBtn();
        ensureRoots();
        const w = bar ? bar.getBoundingClientRect().width : 0;
        const { value } = getProgress();
        if (bar && (w !== lastWidth || value !== lastValue)) render();
        if (bar) clearBarMissing();
        if (!bar) {
          overlay = null;
          // fix-reward-fx-killed-by-transient-bar-loss: antes, un solo batch sin
          // barra llamaba a teardownTimerFx() y mataba el efecto en vuelo, el
          // cronometro y el riel. Ahora la ausencia se re-chequea.
          onBarMissing();
        }
      });
      mo.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['aria-valuenow', 'style', 'aria-valuemax'] });
    }

    function init() {
      // settings-btn-global-spa: el estado persistente y el engranaje NO dependen
      // de que haya barra de lección. Antes vivían dentro del primer éxito del
      // sondeo, así que arrancar en /learn y entrar a una lección por SPA dejaba
      // el diario vacío, el promedio en "—" y el engranaje inexistente hasta
      // recargar.
      raceTimes = loadTimes();
      if (cfg.journalEnabled) journal = getJournal();
      injectSettingsBtn();

      // animations-panel-setting: el nivel de animacion no depende de que haya
      // barra de leccion, asi que se aplica aca y no en el primer render(). Con
      // el default 'system' queda exactamente como antes del cambio.
      syncMotionListener();
      aplicarMotion();

      // audio-cues: el recordatorio y el desbloqueo del AudioContext tampoco
      // dependen de la barra de leccion: el sonido tiene que sonar en cualquier
      // pantalla, y el primer gesto del usuario es lo que lo habilita.
      bindAudioUnlock();
      syncReminder();

      // fix-reward-fx-static-and-duo-crash: el sprite de Duo es lo mas pesado de
      // los tres y se decodifica la primera vez que se dispara, o sea DENTRO de
      // la celebracion que lo necesita. Instanciarlo aqui pone ese decode en
      // paralelo con la leccion. El constructor no dispara nada: solo crea el
      // overlay transparente; el burst sigue pasando por playRewardFx().
      if (cfg.timerShowLabel) {
        try { fxInstance('DuoReward'); } catch (e) { /* sin modulo Duo: se pierde solo ese FX */ }
      }

      // El sondeo queda con su única responsabilidad: encontrar la barra y
      // renderizar. La barra de lección no existe en pantallas que no son
      // lección, y el engranaje no la espera para aparecer.
      const tryIt = setInterval(() => {
        if (ensureRoots()) {
          clearInterval(tryIt);
          render();
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

