// Tests unitarios del núcleo puro del ARCHIVO PUBLICADO (duolingo-adhd.user.js).
// No hay copia dev: el arnés carga el mismo archivo que se instala, vía el
// enganche inerte __ADHD_TEST__. Ver test/harness/core-loader.js.
// Correr: node --test test/core.test.js   (o: npm test)
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const { loadCore, publishedSource, publishedPath, resetGmStore } = require('./harness/core-loader.js');

const C = loadCore();

describe('hexToRgb / lerp / lerpColor', () => {
  test('hexToRgb descompone colores correctamente', () => {
    assert.deepEqual(C.hexToRgb('#ff0000'), [255, 0, 0]);
    assert.deepEqual(C.hexToRgb('#00ff00'), [0, 255, 0]);
    assert.deepEqual(C.hexToRgb('#0000ff'), [0, 0, 255]);
    assert.deepEqual(C.hexToRgb('#ffffff'), [255, 255, 255]);
    assert.deepEqual(C.hexToRgb('#000000'), [0, 0, 0]);
  });

  test('hexToRgb tolera mayúsculas y minúsculas', () => {
    assert.deepEqual(C.hexToRgb('#FFD700'), [255, 215, 0]);
    assert.deepEqual(C.hexToRgb('#ffd700'), [255, 215, 0]);
  });

  test('lerp es lineal y clampa en t=0 y t=1', () => {
    assert.equal(C.lerp(0, 100, 0), 0);
    assert.equal(C.lerp(0, 100, 1), 100);
    assert.equal(C.lerp(0, 100, 0.5), 50);
    assert.equal(C.lerp(10, 20, 0.25), 13);
  });

  test('lerpColor interpola RGB por canal', () => {
    assert.equal(C.lerpColor('#000000', '#ffffff', 0.5), 'rgb(128,128,128)');
    assert.equal(C.lerpColor('#ff0000', '#0000ff', 0), 'rgb(255,0,0)');
    assert.equal(C.lerpColor('#ff0000', '#0000ff', 1), 'rgb(0,0,255)');
  });
});

describe('levelColor — progresión de rarezas', () => {
  test('el último tramo SIEMPRE es legendario (null)', () => {
    assert.equal(C.levelColor(4, 5), null);
    assert.equal(C.levelColor(9, 10), null);
    assert.equal(C.levelColor(1, 2), null);
  });

  test('con 2 tramos: primero = madera, último = legendario', () => {
    assert.equal(C.levelColor(0, 2), C.RARITY[0].color);
    assert.equal(C.levelColor(1, 2), null);
  });

  test('con 5 tramos: madera → bronce → plata → oro → legendario', () => {
    // literales hardcodeados (no RARITY[...].color) — así el test no es tautológico
    const colors = [0, 1, 2, 3].map(i => C.levelColor(i, 5));
    assert.equal(colors[0], '#8d6e63'); // madera
    assert.equal(colors[1], '#b87333'); // bronce
    assert.equal(colors[2], '#c9d1d9'); // plata
    assert.equal(colors[3], '#ffd700'); // oro
    assert.equal(C.levelColor(4, 5), null); // legendario
  });

  test('con 6 tramos: 5 no-legendarios toman directamente los 5 RARITY (límite <=)', () => {
    // T=6 → nNonLegend=5 == RARITY.length. Verifica el branch <= (no <).
    assert.equal(C.levelColor(0, 6), '#8d6e63'); // madera
    assert.equal(C.levelColor(1, 6), '#b87333'); // bronce
    assert.equal(C.levelColor(4, 6), '#7ff4f0'); // platino (5to no-legendario)
    assert.equal(C.levelColor(5, 6), null);       // legendario
  });

  test('con 13 tramos interpola con valores EXACTOS (mata floor→ceil e idx+1)', () => {
    // T=13 → nNonLegend=12 > 5 → interpolación. pos=i*5/12 no entero.
    // i=1: pos=0.4167, floor idx 0, t=0.4167
    assert.equal(C.levelColor(1, 13), 'rgb(159,112,79)');
    // i=2: pos=0.8333, floor idx 0, t=0.8333
    assert.equal(C.levelColor(2, 13), 'rgb(177,114,59)');
    // verifica valores intermedios nunca se salen de madera..platino
    assert.equal(C.levelColor(5, 13), 'rgb(206,210,199)'); // cerca de plata
    assert.equal(C.levelColor(12, 13), null);              // legendario
  });

  test('reachedSeparators con 20 exacto cuenta el hito (>= no >)', () => {
    // sepPos(1,4)=20 exacto tras redondeo float. >= lo cuenta, > no.
    assert.equal(C.reachedSeparators(20, 4), 1);
    assert.equal(C.reachedSeparators(39.9, 4), 1);
    assert.equal(C.reachedSeparators(40, 4), 2);
  });

  test('madera es literalmente #8d6e63 (no se puede reemplazar por negro)', () => {
    assert.equal(C.RARITY[0].color, '#8d6e63');
    assert.equal(C.levelColor(0, 5), '#8d6e63');
  });

  test('progresión tonal es monotónica en luminosidad (madera es la más oscura)', () => {
    const parse = c => {
      if (c === null) return 255;
      if (c.startsWith('#')) return C.hexToRgb(c);
      const m = c.match(/rgb\((\d+),(\d+),(\d+)\)/);
      return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : [0, 0, 0];
    };
    const lum = c => { const [r, g, b] = parse(c); return 0.299 * r + 0.587 * g + 0.114 * b; };
    // madera < bronce < plata en luminosidad percibida
    const m = lum(C.levelColor(0, 5)), b = lum(C.levelColor(1, 5)), p = lum(C.levelColor(2, 5));
    assert.ok(m < b, `madera (${m}) debe ser más oscura que bronce (${b})`);
    assert.ok(b < p, `bronce (${b}) debe ser más oscuro que plata (${p})`);
  });

  test('con 10 tramos interpola sin saltos y el penúltimo se acerca a platino', () => {
    for (let i = 0; i < 8; i++) {
      const c = C.levelColor(i, 10);
      assert.ok(c.startsWith('rgb('), `tramo ${i} debe ser color interpolado, got ${c}`);
    }
    assert.equal(C.levelColor(9, 10), null); // legendario
  });

  test('todos los tramos no-legendarios devuelven colores válidos', () => {
    for (const T of [2, 3, 5, 8, 13]) {
      for (let i = 0; i < T - 1; i++) {
        const c = C.levelColor(i, T);
        assert.ok(typeof c === 'string' && c.length > 0, `T=${T} i=${i} inválido: ${c}`);
      }
      assert.equal(C.levelColor(T - 1, T), null);
    }
  });
});

describe('levelName', () => {
  test('nombres de rareza correctos con 5 tramos', () => {
    assert.equal(C.levelName(0, 5), 'madera');
    assert.equal(C.levelName(1, 5), 'bronce');
    assert.equal(C.levelName(2, 5), 'plata');
    assert.equal(C.levelName(3, 5), 'oro');
    assert.equal(C.levelName(4, 5), 'legendario');
  });

  test('2 tramos: madera + legendario', () => {
    assert.equal(C.levelName(0, 2), 'madera');
    assert.equal(C.levelName(1, 2), 'legendario');
  });
});

describe('Geometría de la barra', () => {
  test('segmentCount = separators + 1', () => {
    assert.equal(C.segmentCount(0), 1);
    assert.equal(C.segmentCount(1), 2);
    assert.equal(C.segmentCount(4), 5);
    assert.equal(C.segmentCount(12), 13);
  });

  test('segLeft posiciona tramos sin solaparse y cubriendo 0-100', () => {
    const T = 5;
    assert.equal(C.segLeft(0, T), 0);
    assert.equal(C.segLeft(4, T), 80);
    assert.equal(C.segLength(T), 20);
    // todos los tramos juntos cubren 100%
    assert.equal(C.segLeft(T - 1, T) + C.segLength(T), 100);
  });

  test('sepPos separadores equiespaciados, ninguno en el borde', () => {
    assert.equal(C.sepPos(1, 4), 20);
    assert.equal(C.sepPos(2, 4), 40);
    assert.equal(C.sepPos(3, 4), 60);
    assert.equal(C.sepPos(4, 4), 80);
    assert.ok(C.sepPos(1, 4) > 0 && C.sepPos(4, 4) < 100);
  });

  test('segProgress: tramo lleno, parcial y vacío', () => {
    const T = 5; // tramos de 20%
    assert.equal(C.segProgress(0, 0, T), 0);           // nada de progreso
    assert.equal(C.segProgress(50, 0, T), 20);         // tramo 0 completo
    assert.equal(C.segProgress(50, 2, T), 10);         // tramo 2 a mitad
    assert.equal(C.segProgress(50, 4, T), 0);          // tramo 4 sin empezar
    assert.equal(C.segProgress(100, 4, T), 20);        // tramo 4 completo al final
    // nunca excede la longitud del tramo
    assert.equal(C.segProgress(100, 2, T), 20);
  });

  test('currentSeg: índice del tramo activo', () => {
    assert.equal(C.currentSeg(0, 5), 0);
    assert.equal(C.currentSeg(19, 5), 0);
    assert.equal(C.currentSeg(20, 5), 1);
    assert.equal(C.currentSeg(50, 5), 2);
    assert.equal(C.currentSeg(99, 5), 4);
    assert.equal(C.currentSeg(100, 5), 5);
    // clampa
    assert.equal(C.currentSeg(-5, 5), 0);
    assert.equal(C.currentSeg(150, 5), 5);
  });

  test('reachedSeparators cuenta hitos superados', () => {
    assert.equal(C.reachedSeparators(0, 4), 0);
    assert.equal(C.reachedSeparators(19.9, 4), 0);
    assert.equal(C.reachedSeparators(20, 4), 1);
    assert.equal(C.reachedSeparators(50, 4), 2); // 50 ≥ 20 y 40
    assert.equal(C.reachedSeparators(100, 4), 4);
    assert.equal(C.reachedSeparators(100, 0), 0); // sin separadores
  });

  test('reachedSeparators respeta equiespaciado para cualquier N', () => {
    for (const N of [1, 2, 5, 12]) {
      for (const pct of [0, 50, 100]) {
        const r = C.reachedSeparators(pct, N);
        assert.ok(r >= 0 && r <= N, `N=${N} pct=${pct} → r=${r} fuera de rango`);
      }
    }
  });
});

describe('DEFAULTS', () => {
  test('config por defecto coherente', () => {
    assert.equal(C.DEFAULTS.separators, 4);
    assert.equal(C.DEFAULTS.lang, 'es');
    // 6.4: hitos visuales eliminados — showNumbers/thickness ya no existen
    assert.equal(C.DEFAULTS.showNumbers, undefined);
    assert.equal(C.DEFAULTS.thickness, undefined);
    assert.equal(C.DEFAULTS.timerMode, true);
    // rail-fixed-lap-ceiling: la clave se conserva para no romper cfgs guardados,
    // pero ya no se lee ni se escribe: no es un dial de dificultad.
    assert.equal('timerHardness' in C.DEFAULTS, true);
    assert.equal(typeof C.tierForLap, 'function');  // la escalera es por vuelta
    assert.equal(C.bandsFor, undefined);
    assert.equal(C.rungAt, undefined);
    assert.equal(C.bandEdges, undefined);
    assert.equal(C.LOST, undefined);              // no hay estado de derrota
  });
});

describe('i18n: detectLang / I18N / tr', () => {
  test('detectLang: en → en, resto → es', () => {
    assert.equal(C.detectLang('en-US'), 'en');
    assert.equal(C.detectLang('en'), 'en');
    assert.equal(C.detectLang('es-AR'), 'es');
    assert.equal(C.detectLang('fr'), 'es');
    assert.equal(C.detectLang(''), 'es');
    assert.equal(C.detectLang(undefined), 'es');
  });

  test('I18N: mismas claves en es y en, sin cadenas vacías', () => {
    const es = Object.keys(C.I18N.es).sort();
    const en = Object.keys(C.I18N.en).sort();
    assert.deepEqual(es, en);
    for (const k of es) {
      assert.ok(C.I18N.es[k].trim().length > 0, 'es.' + k + ' vacía');
      assert.ok(C.I18N.en[k].trim().length > 0, 'en.' + k + ' vacía');
    }
  });

  test('tr: devuelve el idioma pedido y hace fallback a es', () => {
    assert.equal(C.tr('es', 'btnReset'), 'Restablecer valores');
    assert.equal(C.tr('en', 'btnReset'), 'Reset values');
    assert.equal(C.tr('en', 'panelTitle'), 'Progress bar segments (ADHD)');
    assert.equal(C.tr('fr', 'btnReset'), 'Restablecer valores'); // fallback a es
    assert.equal(C.tr('en', 'no-existe'), undefined); // clave inexistente → undefined
  });
});

// ========== Tests Feature 1: Timer ==========
// ---------------------------------------------------------------------
// rail-fixed-lap-ceiling: la escalera son las VUELTAS, no las bandas
// ---------------------------------------------------------------------
describe('rail-fixed-lap-ceiling: escalera por vueltas', () => {
  const GOAL = 60000;
  const nm = (r) => C.RUNGS[r].label;

  test('tierForLap: super -> madera y se clampa en madera', () => {
    const seq = [0, 1, 2, 3, 4, 5, 6, 9, 40].map((l) => C.tierForLap(l));
    assert.deepEqual(seq, [5, 4, 3, 2, 1, 0, 0, 0, 0]);
    assert.deepEqual([0, 1, 2, 3, 4, 5].map((l) => nm(C.tierForLap(l))),
      ['Super', 'Diamante', 'Racha', 'Plata', 'Bronce', 'Madera']);
  });

  test('tierForLap: nunca indice negativo ni fuera de rango', () => {
    for (const l of [-5, -1, 0, 3, 6, 999]) {
      const t = C.tierForLap(l);
      assert.ok(t >= 0 && t < C.RUNGS.length, 'lap ' + l + ' -> ' + t);
    }
  });

  test('ladderAt: la vuelta mantiene SU peldaño de principio a fin', () => {
    for (let lap = 0; lap < 6; lap++) {
      const at = (f) => C.ladderAt((lap + f) * GOAL, GOAL);
      const tier = at(0).tier;
      // el peldaño NO baja mientras se quema la vuelta (no hay bandas)
      for (const f of [0.01, 0.25, 0.5, 0.75, 0.9, 0.999]) {
        assert.equal(at(f).tier, tier, 'lap ' + (lap + 1) + ' en f=' + f);
      }
      assert.equal(tier, 5 - lap);
    }
  });

  test('ladderAt: la recarga es el UNICO cambio de peldaño', () => {
    assert.equal(C.ladderAt(GOAL - 1, GOAL).tier, 5);   // Super hasta el final
    assert.equal(C.ladderAt(GOAL, GOAL).tier, 4);       // arranca Diamante
    assert.equal(C.ladderAt(2 * GOAL - 1, GOAL).tier, 4);
    assert.equal(C.ladderAt(2 * GOAL, GOAL).tier, 3);
  });

  test('ladderAt: frac siempre local a la vuelta, en [0,1)', () => {
    for (const ms of [0, 12345, GOAL, 3.5 * GOAL, 7 * GOAL, 600 * GOAL]) {
      const L = C.ladderAt(ms, GOAL);
      assert.ok(L.frac >= 0 && L.frac < 1, 'frac=' + L.frac);
      assert.ok(Number.isInteger(L.lap));
    }
    assert.equal(C.ladderAt(GOAL - 1, GOAL).frac > 0.99, true);
    assert.equal(C.ladderAt(GOAL, GOAL).frac, 0);
  });

  test('ladderAt: el lap se deriva del elapsed (bordes exactos)', () => {
    assert.equal(C.ladderAt(0, GOAL).lap, 0);
    assert.equal(C.ladderAt(GOAL - 1, GOAL).lap, 0);
    assert.equal(C.ladderAt(GOAL, GOAL).lap, 1);
    assert.equal(C.ladderAt(GOAL + 1, GOAL).lap, 1);
    assert.equal(C.ladderAt(9 * GOAL, GOAL).lap, 9);
  });

  test('ladderAt: nunca hay defeat, ni escalera vacía, ni rung negativo', () => {
    for (const lap of [0, 1, 5, 6, 12, 500]) {
      for (const f of [0, 0.5, 0.9999]) {
        const L = C.ladderAt((lap + f) * GOAL, GOAL);
        assert.ok(L.tier >= 0, 'tier>=0 en lap ' + lap);
        assert.equal('lost' in L, false, 'no hay campo lost');
        assert.equal('exhausted' in L, false, 'no hay estado agotado');
      }
    }
  });

  test('ladderAt: goalMs invalido → null', () => {
    assert.equal(C.ladderAt(1000, 0), null);
    assert.equal(C.ladderAt(1000, null), null);
  });

  test('evaluateRace: graba el peldaño de la vuelta en la que se cerró', () => {
    assert.equal(C.evaluateRace(1000, GOAL).rung, 5);        // vuelta 1
    assert.equal(C.evaluateRace(GOAL - 1, GOAL).rung, 5);    // cierre tardío, vuelta 1
    assert.equal(C.evaluateRace(GOAL, GOAL).rung, 4);        // vuelta 2
    assert.equal(C.evaluateRace(2 * GOAL, GOAL).rung, 3);    // vuelta 3
    // cerrar tarde NUNCA sube el peldaño, aunque antes se rozara Super
    const first = C.evaluateRace(1, GOAL).rung;
    const later = C.evaluateRace(4 * GOAL, GOAL).rung;
    assert.ok(later < first, 'cierre tardio ' + later + ' < primer intento ' + first);
  });

  test('evaluateRace: nunca devuelve lost ni un rung negativo', () => {
    for (const ms of [0, GOAL, 100 * GOAL, 5000 * GOAL]) {
      const r = C.evaluateRace(ms, GOAL);
      assert.equal('lost' in r, false);
      assert.ok(r.rung >= 0);
      assert.equal(r.rung, r.tier);
    }
  });

  test('evaluateRace: el piso es madera, siempre', () => {
    for (const lap of [5, 6, 7, 50, 5000]) {
      const r = C.evaluateRace(lap * GOAL + 1, GOAL);
      assert.equal(r.lap, lap);
      assert.equal(r.rung, 0);
      assert.equal(r.tier, 0);
    }
  });

  test('evaluateRace: isFast = diamante o super', () => {
    assert.equal(C.evaluateRace(1000, GOAL).isFast, true);      // vuelta 1 super
    assert.equal(C.evaluateRace(GOAL + 1, GOAL).isFast, true);  // vuelta 2 diamante
    assert.equal(C.evaluateRace(2 * GOAL + 1, GOAL).isFast, false); // vuelta 3 racha
  });

  test('evaluateRace: goalMs inválido → null', () => {
    assert.equal(C.evaluateRace(1000, 0), null);
    assert.equal(C.evaluateRace(1000, null), null);
  });

  test('rungClass: 6 peldaños, null fuera de rango, sin rama de perdido', () => {
    assert.equal(C.rungClass(0), 'adhd-rung-madera');
    assert.equal(C.rungClass(5), 'adhd-rung-super');
    assert.equal(C.rungClass(6), null);
    assert.equal(C.rungClass(-1), null);
    assert.equal(C.rungClass('x'), null);
  });

  test('rungTextColor: el ink del peldaño, sin caso perdido', () => {
    assert.equal(C.rungTextColor(5), C.RUNGS[5].ink);
    assert.equal(C.rungTextColor(0), C.RUNGS[0].ink);
  });

  test('el modelo de bandas y el de derrota ya no existen en el core', () => {
    for (const k of ['BAND_TABLES', 'bandsFor', 'normalizeBands', 'deckBands',
                     'ceilingRung', 'rungAt', 'bandEdges', 'LOST']) {
      assert.equal(C[k], undefined, k + ' deberia estar eliminado');
    }
  });
});

// ---------------------------------------------------------------------
// test-published-file-ci: el archivo publicado es el sujeto de test, y no
// debe volver a arrastrar scaffolding que solo tenía sentido para una copia dev
// ---------------------------------------------------------------------
describe('el archivo publicado no arrastra scaffolding de build', () => {
  const src = publishedSource();

  test('sin module.exports (el arnés usa el enganche, no un export)', () => {
    assert.equal(/module\.exports/.test(src), false);
  });

  test('sin ramas __adhd_test_store (el storage va por GM_*)', () => {
    assert.equal(/__adhd_test_store/.test(src), false);
  });

  test('sin configuracion demo (se周日 Richie) — no queda en el publicado'.replace('周日 Richie',''), () => {
    assert.equal(/demo:\s*false|demoProgress/.test(src), false);
  });

  test('sin axe-core (@require de desarrollo)', () => {
    assert.equal(/axe-core/.test(src), false);
  });

  test('el enganche de test esta presente y es inerte sin el global', () => {
    assert.ok(/__ADHD_TEST__/.test(src), 'el enganche debe existir en el archivo publicado');
    // Sin el global definido, el archivo se evalua entero sin error.
    let threw = null;
    try {
      new Function('window', 'document', src)(undefined, undefined);
    } catch (e) { threw = e; }
    assert.equal(threw, null, threw && threw.message);
  });

  test('el enganche entrega el nucleo cuando el arnés lo pide', () => {
    let core = null;
    globalThis.__ADHD_TEST__ = (c) => { core = c; };
    try {
      new Function('window', 'document', src)(undefined, undefined);
    } finally {
      delete globalThis.__ADHD_TEST__;
    }
    assert.ok(core, 'el enganche no entrego el nucleo');
    assert.equal(typeof core.tierForLap, 'function');
    assert.equal(core.RUNGS.length, 6);
  });

  test('el archivo publicado es el que se carga (no una copia)', () => {
    assert.ok(publishedPath().endsWith('duolingo-adhd.user.js'), publishedPath());
  });
});

describe('Feature 1: CarreraTimer', () => {
  test('setup', () => {
    resetGmStore();
  });

  test('getAverage: null con array vacío', () => {
    assert.equal(C.getAverage([]), null);
    assert.equal(C.getAverage(null), null);
  });

  test('getAverage: calcula promedio correctamente', () => {
    assert.equal(C.getAverage([1000, 2000, 3000]), 2000);
    assert.equal(C.getAverage([500]), 500);
  });

  test('newRaces: detecta carreras completadas', () => {
    const races = C.newRaces(0, 3);
    assert.equal(races.length, 3);
    assert.equal(races[0].raceIndex, 0);
    assert.equal(races[2].raceIndex, 2);
    assert.equal(C.newRaces(3, 3).length, 0);
  });




























  test('getTimerGoalMs: convierte minutos+segundos a ms', () => {
    assert.equal(C.getTimerGoalMs({ timerMinutes: 10, timerSeconds: 0 }), 600000);
    assert.equal(C.getTimerGoalMs({ timerMinutes: 5, timerSeconds: 30 }), 330000);
    assert.equal(C.getTimerGoalMs({ timerMinutes: 1, timerSeconds: 0 }), 60000);
  });

  test('load/save times via mock', () => {
    C.saveTimes([1000, 2000]);
    assert.deepEqual(C.loadTimes(), [1000, 2000]);
    C.resetTimes();
    assert.deepEqual(C.loadTimes(), []);
  });

  test('teardown', () => {
    resetGmStore();
  });
});

// ========== Tests Feature 3: Diario ==========
describe('Feature 3: Journal', () => {
  // El almacenamiento lo sirve el arnés con forma de GM_* (mismo camino que el
  // usuario), no una rama de test que solo existía en el archivo dev.
  test('setup', () => {
    resetGmStore();
  });

  test('initJournal: estructura correcta', () => {
    const j = C.initJournal();
    assert.equal(typeof j.date, 'string');
    assert.equal(j.lessons, 0);
    assert.equal(j.separators, 0);
    assert.deepEqual(j.raceTimes, []);
    assert.equal(j.totalLessons, 0);
    assert.equal(j.streak, 0);
  });

  test('getJournal: crea uno nuevo si no existe', () => {
    const j = C.getJournal();
    assert.ok(j);
    assert.equal(j.lessons, 0);
    assert.equal(j.date, C.todayKey());
  });

  test('recordLesson: incrementa lecciones', () => {
    C.resetJournal();
    let j = C.recordLesson();
    assert.equal(j.lessons, 1);
    assert.equal(j.totalLessons, 1);
    j = C.recordLesson();
    assert.equal(j.lessons, 2);
    assert.equal(j.totalLessons, 2);
  });

  test('recordSeparators: suma separadores', () => {
    C.resetJournal();
    let j = C.recordSeparators(3);
    assert.equal(j.separators, 3);
    j = C.recordSeparators(2);
    assert.equal(j.separators, 5);
  });

  test('recordRaceTime: agrega tiempos', () => {
    C.resetJournal();
    let j = C.recordRaceTime(5000);
    assert.deepEqual(j.raceTimes, [5000]);
    j = C.recordRaceTime(8000);
    assert.deepEqual(j.raceTimes, [5000, 8000]);
  });

  test('resetJournal: limpia todo', () => {
    C.recordLesson();
    C.recordSeparators(5);
    C.resetJournal();
    const j = C.getJournal();
    assert.equal(j.lessons, 0);
    assert.equal(j.separators, 0);
    assert.deepEqual(j.raceTimes, []);
  });

  test('teardown', () => {
    resetGmStore();
  });
});

// =====================================================================
// lesson-only-overlay: detección por firma (isLessonScreen / isLessonBar)
// Firma validada contra pb-spy-2026-09-16 (1).json (136 eventos reales):
//   lección:  aria-valuemax="1", ancho 801-958px, y<100, SIN _2nasW
//   desafío:  aria-valuemax=3/20/30/35, ancho 208-360px, CON _2nasW
// =====================================================================
describe('lesson-only-overlay: isLessonScreen', () => {
  test('acepta /lesson', () => {
    assert.equal(C.isLessonScreen('/lesson'), true);
  });
  test('acepta /lesson/* anidado (unit/level)', () => {
    assert.equal(C.isLessonScreen('/lesson/unit/102/level/2'), true);
  });
  test('acepta /practice-hub/listen-up', () => {
    assert.equal(C.isLessonScreen('/practice-hub/listen-up'), true);
  });
  test('acepta /practice (pantalla de práctica legacy)', () => {
    assert.equal(C.isLessonScreen('/practice'), true);
  });
  test('acepta /practice/* (subrutas)', () => {
    assert.equal(C.isLessonScreen('/practice/listen-up'), true);
  });
  test('RECHAZA /practice-hub root (solo barras de desafío)', () => {
    assert.equal(C.isLessonScreen('/practice-hub'), false);
  });
  test('RECHAZA /learn', () => {
    assert.equal(C.isLessonScreen('/learn'), false);
  });
  test('RECHAZA /quests', () => {
    assert.equal(C.isLessonScreen('/quests'), false);
  });
  test('RECHAZA /leaderboard', () => {
    assert.equal(C.isLessonScreen('/leaderboard'), false);
  });
  test('RECHAZA prefijos trampa (no empieza con /lesson/)', () => {
    assert.equal(C.isLessonScreen('/lessons'), false);
    assert.equal(C.isLessonScreen('/lessonsfoo'), false);
  });
});

// Fixture builder: un elemento progressbar con firma configurable.
function makeBar(opts) {
  const o = Object.assign({
    role: 'progressbar',
    valuemax: '1',
    classes: [],
    rect: { width: 877, y: 58 },   // firma de barra de lección capturada
    innerWidth: 1280,
  }, opts);
  return {
    getAttribute: (name) => {
      if (name === 'role') return o.role;
      if (name === 'aria-valuemax') return o.valuemax;
      return null;
    },
    classList: { contains: (c) => o.classes.includes(c) },
    _opts: o,
  };
}

describe('lesson-only-overlay: isLessonBar', () => {
  test('detecta barra de lección válida (firma completa)', () => {
    const bar = makeBar({});
    assert.equal(C.isLessonBar(bar, { rect: bar._opts.rect, innerWidth: bar._opts.innerWidth }), true);
  });

  test('RECHAZA barra de desafío: valuemax entero (30)', () => {
    const bar = makeBar({ valuemax: '30', classes: ['_2nasW'], rect: { width: 360, y: 290 } });
    assert.equal(C.isLessonBar(bar, { rect: bar._opts.rect, innerWidth: 1280 }), false);
  });

  test('RECHAZA barra de desafío: valuemax entero (3)', () => {
    const bar = makeBar({ valuemax: '3', classes: ['_2nasW'], rect: { width: 360, y: 444 } });
    assert.equal(C.isLessonBar(bar, { rect: bar._opts.rect, innerWidth: 1280 }), false);
  });

  test('RECHAZA barra de desafío: valuemax entero (20)', () => {
    const bar = makeBar({ valuemax: '20', classes: ['_2nasW'], rect: { width: 360, y: 572 } });
    assert.equal(C.isLessonBar(bar, { rect: bar._opts.rect, innerWidth: 1280 }), false);
  });

  test('RECHAZA aunque valuemax=1 si tiene clase _2nasW (exclusión dura)', () => {
    const bar = makeBar({ classes: ['_2nasW'] });
    assert.equal(C.isLessonBar(bar, { rect: bar._opts.rect }), false);
  });

  test('ACEPTA barra angosta (lesson-bar-container-anchor: width gate REMOVIDO)', () => {
    // El gate de ancho ≥ 50% viewport fue eliminado — causaba falsos negativos
    // en displays virtuales (barra real 880px vs viewport 2166px rechazada).
    // Una barra angosta con firma correcta ya NO se excluye por ancho.
    const bar = makeBar({ rect: { width: 208, y: 58 } });
    assert.equal(C.isLessonBar(bar, { rect: bar._opts.rect }), true);
  });

  test('RECHAZA aunque valuemax=1 si está abajo (no top-anchored)', () => {
    const bar = makeBar({ rect: { width: 877, y: 400 } });
    assert.equal(C.isLessonBar(bar, { rect: bar._opts.rect }), false);
  });

  test('RECHAZA elemento sin role=progressbar', () => {
    const bar = makeBar({ role: 'button' });
    assert.equal(C.isLessonBar(bar, { rect: bar._opts.rect, innerWidth: 1280 }), false);
  });

  test('RECHAZA null sin lanzar', () => {
    assert.equal(C.isLessonBar(null, { rect: null }), false);
  });

  test('RECHAZA barras de celebración completadas (30/30, 3/3, 20/20)', () => {
    // La pantalla de celebración post-lección muestra las barras de desafío
    // en su estado completo: nunca deben recibir overlay.
    for (const max of ['30', '3', '20']) {
      const bar = makeBar({ valuemax: max, classes: ['_2nasW'], rect: { width: 360, y: 290 } });
      assert.equal(C.isLessonBar(bar, { rect: bar._opts.rect }), false);
    }
  });
});

// =====================================================================
// lesson-bar-container-anchor: detección estructural (ancla quit-button)
// Estructura real (captura en vivo del usuario):
//   div.I-Avc._1zcW8 ← fila header
//   ├─ button[data-test="quit-button"]  ← ANCLA SEMÁNTICA
//   ├─ div[role="progressbar"]          ← la barra de lección
//   └─ div._3ww7z (corazones)
// =====================================================================

// Mock DOM builder: replica la fila del header de lección (sin jsdom).
function makeRow(opts) {
  const o = Object.assign({ withQuit: true, withBar: true, barInRow: true, barMax: '1' }, opts);
  const bar = {
    tagName: 'DIV',
    getAttribute: (n) => n === 'role' ? 'progressbar' : (n === 'aria-valuemax' ? o.barMax : null),
    classList: { contains: () => false },
  };
  const row = {
    querySelector: (sel) => {
      if (sel === 'button[data-test="quit-button"]') return o.withQuit ? {} : null;
      if (sel === '[role="progressbar"]') return (o.withBar && o.barInRow) ? bar : null;
      return null;
    },
    querySelectorAll: () => (o.withBar && o.barInRow) ? [bar] : [],
    parentElement: null,
  };
  const btn = {
    // el botón está DENTRO de la fila: querySelector desde el botón sube via parentElement
    querySelector: () => null,   // el botón no contiene la barra
    parentElement: row,
  };
  if (o.withQuit) row.querySelector = (sel) => {
    if (sel === 'button[data-test="quit-button"]') return btn;
    if (sel === '[role="progressbar"]') return (o.withBar && o.barInRow) ? bar : null;
    return null;
  };
  const root = {
    querySelector: (sel) => {
      if (sel === 'button[data-test="quit-button"]') return o.withQuit ? btn : null;
      return null;
    },
  };
  return { root, row, bar, btn };
}

describe('lesson-bar-container-anchor: findLessonBarByAnchor', () => {
  test('encuentra la barra cuando comparte fila con el quit-button', () => {
    const { root, bar } = makeRow({});
    const found = C.findLessonBarByAnchor(root);
    assert.equal(found, bar, 'la barra hermana del botón debe ser seleccionada');
  });

  test('retorna null sin quit-button (ancla ausente)', () => {
    const { root } = makeRow({ withQuit: false });
    assert.equal(C.findLessonBarByAnchor(root), null, 'sin ancla → null (va al fallback)');
  });

  test('retorna null si la barra existe FUERA de la fila del quit-button', () => {
    const { root } = makeRow({ withBar: true, barInRow: false });
    assert.equal(C.findLessonBarByAnchor(root), null, 'barra fuera de la fila → no seleccionada');
  });

  test('retorna null si no hay barra en absoluto', () => {
    const { root } = makeRow({ withBar: false });
    assert.equal(C.findLessonBarByAnchor(root), null);
  });

  test('retorna null con root null (no lanza)', () => {
    assert.equal(C.findLessonBarByAnchor(null), null);
  });
});

describe('lesson-bar-container-anchor: findBarBySignature (fallback)', () => {
  test('fallback encuentra barra con firma correcta cuando el ancla falta', () => {
    // Mock document-like: querySelectorAll devuelve una barra que isLessonBar acepta.
    // findBarBySignature llama isLessonBar(b) SIN opts → necesita getBoundingClientRect.
    const goodBar = makeBar({});
    goodBar.getBoundingClientRect = () => goodBar._opts.rect;
    const doc = { querySelectorAll: () => [goodBar] };
    const found = C.findBarBySignature(doc);
    assert.equal(found, goodBar, 'fallback encuentra la barra con firma válida');
  });

  test('fallback ignora barras de desafío (valuemax entero + _2nasW)', () => {
    const challengeBar = makeBar({ valuemax: '30', classes: ['_2nasW'], rect: { width: 360, y: 290 } });
    const doc = { querySelectorAll: () => [challengeBar] };
    assert.equal(C.findBarBySignature(doc), null, 'ninguna barra válida → null');
  });

  test('el oro de liga y el de racha no coexisten', () => {
    const ids = C.RUNGS.map(r => r.id);
    assert.equal(ids.includes('oro'), false);       // oro de liga fuera
    assert.equal(ids.includes('platino'), false);   // platino fuera
    assert.equal(ids.includes('legendario'), false);
    assert.equal(ids.includes('racha'), true);      // el oro vivo de la racha, dentro
    assert.equal(ids.includes('super'), true);      // el techo es la membresía
  });

  test('super está por encima de diamante (orden del proposal)', () => {
    assert.ok(C.RUNGS.indexOf(C.RUNGS.find(r => r.id === 'super')) >
              C.RUNGS.indexOf(C.RUNGS.find(r => r.id === 'diamante')));
  });
});
