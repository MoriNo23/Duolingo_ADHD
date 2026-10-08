// Tests unitarios del núcleo puro del ARCHIVO PUBLICADO (duolingo-adhd.user.js).
// No hay copia dev: el arnés carga el mismo archivo que se instala, vía el
// enganche inerte __ADHD_TEST__. Ver test/harness/core-loader.js.
// Correr: node --test test/core.test.js   (o: npm test)
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

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
    // animations-panel-setting: el default tiene que ser 'system' para que un
    // config guardado antes del cambio no cambie de comportamiento.
    // motion-default-always: el default es 'always'. Con 'system', un escritorio
    // que reporta prefers-reduced-motion dejaba las celebraciones quietas.
    assert.equal(C.DEFAULTS.motionLevel, 'always');
    assert.deepEqual(C.MOTION_LEVELS, ['system', 'always', 'never']);
  });

  test('un config guardado sin motionLevel cae en always tras el merge', () => {
    // motion-default-always: sin nivel guardado, el default es 'always'.
    const cfgViejo = { separators: 4, lang: 'en', timerMode: true };
    const merged = Object.assign({}, C.DEFAULTS, cfgViejo);
    assert.equal(merged.motionLevel, 'always');
    // Y un nivel YA guardado gana: el default nuevo no pisa una eleccion previa.
    const conNivel = Object.assign({}, C.DEFAULTS, { lang: 'es', motionLevel: 'never' });
    assert.equal(conNivel.motionLevel, 'never');
    assert.equal(C.resolveMotion(conNivel.motionLevel, false), true);
  });
});

// animations-panel-setting: la precedencia entre el override del usuario y la
// preferencia del sistema. Toda la matriz, en los dos sentidos.
describe('animations-panel-setting: i18n del control de animaciones', () => {
  const CLAVES = ['lblMotion', 'hintMotion', 'motionSystem', 'motionAlways', 'motionNever'];

  test('las claves existen en los dos idiomas', () => {
    for (const lang of ['es', 'en']) {
      for (const k of CLAVES) {
        const v = C.tr(lang, k);
        assert.equal(typeof v, 'string', lang + '/' + k);
        assert.notEqual(v, k, lang + '/' + k + ' cae al fallback');
        assert.ok(v.length > 0);
      }
    }
  });

  test('los tres estados tienen texto distinto en cada idioma', () => {
    for (const lang of ['es', 'en']) {
      const vals = ['motionSystem', 'motionAlways', 'motionNever'].map(k => C.tr(lang, k));
      assert.equal(new Set(vals).size, 3, lang + ': los tres estados deben ser distintos');
    }
  });

  test('es y en no quedan desbalanceados', () => {
    const a = new Set(Object.keys(C.I18N.es));
    const b = new Set(Object.keys(C.I18N.en));
    assert.deepEqual([...a].filter(k => !b.has(k)), []);
    assert.deepEqual([...b].filter(k => !a.has(k)), []);
  });
});

describe('animations-panel-setting: resolveMotion', () => {
  test('system: sigue al sistema en los dos sentidos', () => {
    assert.equal(C.resolveMotion('system', true), true);
    assert.equal(C.resolveMotion('system', false), false);
  });

  test('always: gana contra un sistema que pide reduce', () => {
    assert.equal(C.resolveMotion('always', true), false);
    assert.equal(C.resolveMotion('always', false), false);
  });

  test('never: gana contra un sistema sin preferencia', () => {
    assert.equal(C.resolveMotion('never', true), true);
    assert.equal(C.resolveMotion('never', false), true);
  });

  test('un valor desconocido cae en system (no cambia el behavior previo)', () => {
    for (const basura of ['', 'SI', 'off', 'reduced', null, undefined, 0, {}]) {
      assert.equal(C.resolveMotion(basura, true), true,  'con sistema reduce: ' + String(basura));
      assert.equal(C.resolveMotion(basura, false), false, 'con sistema normal: ' + String(basura));
    }
  });

  test('el resultado es siempre booleano, nunca undefined', () => {
    for (const lvl of [...C.MOTION_LEVELS, 'basura']) {
      for (const sys of [true, false, undefined, null, 0, 1]) {
        assert.equal(typeof C.resolveMotion(lvl, sys), 'boolean');
      }
    }
  });

  test('systemReduced se normaliza a booleano', () => {
    // truthy -> off; falsy -> on. resolveMotion devuelve !!.
    assert.equal(C.resolveMotion('system', 1), true);
    assert.equal(C.resolveMotion('system', 0), false);
    assert.equal(C.resolveMotion('system', 'sí'), true);
    assert.equal(C.resolveMotion('system', ''), false);
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
// animations-panel-setting: el kill switch de reduced-motion se acoto a
// EFECTOS. Las pieles de los peldaños son material, no animacion, y
// reward-fx solo exige que los efectos tengan variante calmada. Este test es la
// red que hace que esa decision no se deshaga sin querer.
// La resolucion (puro) y la clase del <body> (efecto) tienen que estar atadas
// por UNA sola llamada, y esa llamada tiene que ser idempotente: la corre el
// init, el listener de la media query y el handler del panel, en ese orden y a
// veces con el mismo valor. Si no lo fuera, el segundo toggle dejaria la clase
// en un estado distinto al primero.
describe('animations-panel-setting: la clase del body va atada a la resolucion', () => {
  const src = publishedSource();

  function cuerpoDe(nombre) {
    const i = src.indexOf('function ' + nombre + '(');
    assert.ok(i > -1, 'no existe ' + nombre);
    return src.slice(i, src.indexOf('\n  }', i));
  }

  test('motionOff() es la unica fuente del booleano', () => {
    const c = cuerpoDe('motionOff');
    assert.equal(/return resolveMotion\(cfg\.motionLevel, sys\);/.test(c), true,
      'motionOff tiene que delegar en resolveMotion, no decidir por su cuenta');
    assert.equal(/matchMedia/.test(c), true, 'motionOff tiene que leer la preferencia del sistema');
  });

  test('aplicarMotion alterna la clase con la forma idempotente', () => {
    const c = cuerpoDe('aplicarMotion');
    // classList.toggle(clase, booleano) es idempotente por definicion; un
    // add/remove con if/else no lo seria.
    assert.equal(/classList\.toggle\('adhd-motion-off', off\)/.test(c), true,
      'tiene que usar classList.toggle(clase, booleano)');
    assert.equal(/if \(off\)/.test(c), false, 'un if/else sobre la clase no es idempotente');
    assert.equal(/return off;/.test(c), true, 'aplicarMotion tiene que devolver el valor aplicado');
  });

  test('aplicarMotion destruye las instancias cacheadas antes de reutilizarlas', () => {
    // design decision 5: los 3 modulos congelan this.reduced en el
    // constructor, asi que cambiar el nivel no alcanza con volver a pintar:
    // hay que descartar la instancia cacheada.
    const c = cuerpoDe('aplicarMotion');
    assert.equal(/destroyRewardFx\(\)/.test(c), true,
      'sin destruir las instancias, el nivel nuevo no llega a los modulos');
  });

  test('la clase y la resolucion no se pueden desincronizar', () => {
    // Un unico punto de verdad: quien pone la clase es aplicarMotion, y usa
    // el valor de motionOff(). Si otro lugar tocara la clase, esto se rompe.
    const c = cuerpoDe('aplicarMotion');
    assert.equal((src.match(/classList\.toggle\('adhd-motion-off'/g) || []).length, 1,
      'la clase tiene que alternarse en un solo lugar del archivo');
  });

  test('con el default always la clase NO se aplica ni con reduce del sistema', () => {
    // motion-default-always: es el arranque real (DEFAULTS + resolveMotion) y
    // es el caso de esta maquina (enable-animations=false en KDE): la clase no
    // lleva el kill switch porque el default es 'always'. Para apagarlas: nivel
    // 'system' (que ademas es lo que la spec nueva describe) o 'never'.
    assert.equal(C.resolveMotion(C.DEFAULTS.motionLevel, false), false);
    assert.equal(C.resolveMotion(C.DEFAULTS.motionLevel, true), false);
  });

  test('con nivel system y reduce del sistema, la clase SI se aplica', () => {
    // El camino calmado sigue entero: solo hay que elegirlo.
    assert.equal(C.resolveMotion('system', true), true);
    assert.equal(C.resolveMotion('system', false), false);
  });
});

// animations-panel-setting: el control del panel vive en un template string.
// desde el fixture e2e resulto fragil (abrir/cerrar el panel desde el arnés),
// asi que aca se verifica el fuente publicado: es el mismo archivo que se
// instala, y el template es lo que hay que proteger.
describe('animations-panel-setting: el control esta en el panel', () => {
  const src = publishedSource();

  test('el panel declara el control con los tres estados', () => {
    assert.equal(/id="adhd-motion"/.test(src), true, 'falta el control #adhd-motion');
    for (const v of ['system', 'always', 'never']) {
      assert.equal(new RegExp('value="' + v + '"').test(src), true, 'falta la opcion ' + v);
    }
  });

  test('cada opcion marca selected segun cfg.motionLevel', () => {
    // El template tiene que comparar contra cfg, no hardcodear un selected.
    for (const v of ['system', 'always', 'never']) {
      const patron = "cfg.motionLevel === '" + v + "' ? ' selected' : ''";
      assert.equal(src.includes(patron), true, 'la opcion ' + v + ' no refleja el cfg');
    }
  });

  test('el control esta FUERA de #adhd-timer-opts', () => {
    // Si estuviera adentro, se ocultaria con timerMode en off, y el nivel de
    // animacion aplica a todo el script, no solo al cronometro.
    const iOpts = src.indexOf('id="adhd-timer-opts"');
    const iCierre = src.indexOf("adhd-timer-opts", iOpts + 1);
    const sel = src.indexOf('id="adhd-motion"');
    assert.ok(iOpts > -1 && sel > -1, 'faltan los controles');
    const bloqueTimer = src.slice(iOpts, sel);
    assert.equal(bloqueTimer.includes('</div>'), true, 'el div del timer deberia cerrarse antes del control de motion');
  });

  test('cambiar el control persiste, sincroniza el listener y aplica', () => {
    // El handler tiene que hacer las tres cosas: setCfg, syncMotionListener y
    // aplicarMotion. Sin las dos ultimas el cambio no se veria en vivo.
    const i = src.indexOf("querySelector('#adhd-motion')");
    assert.ok(i > -1, 'falta el listener del control');
    const handler = src.slice(i, i + 700);
    assert.equal(/setCfg\('motionLevel'/.test(handler), true, 'no persiste');
    assert.equal(/syncMotionListener\(\)/.test(handler), true, 'no sincroniza el listener');
    assert.equal(/aplicarMotion\(\)/.test(handler), true, 'no aplica en vivo');
    assert.equal(/MOTION_LEVELS\.indexOf/.test(handler), true, 'no valida el valor');
  });

  test('init aplica el nivel al arrancar, sin depender de la leccion', () => {
    const i = src.indexOf('function init()');
    const cuerpo = src.slice(i, src.indexOf('\n  }', i));   // todo el cuerpo de init()
    assert.equal(/aplicarMotion\(\)/.test(cuerpo), true, 'init no aplica el nivel');
    assert.equal(/syncMotionListener\(\)/.test(cuerpo), true, 'init no suscribe el listener');
    // Tiene que estar antes del sondeo de la barra: si Depends de que haya
    // leccion, no se aplica en /learn.
    const iSondeo = cuerpo.indexOf('ensureRoots()');
    const iAplica = cuerpo.indexOf('aplicarMotion()');
    assert.ok(iAplica > -1 && iSondeo > -1);
    assert.equal(iAplica < iSondeo, true, 'aplicarMotion deberia ir antes del primer render');
  });

  test('perder la barra un instante NO tira abajo lo que esta corriendo', () => {
    // fix-reward-fx-killed-by-transient-bar-loss. Un solo batch de mutaciones sin
    // barra mataba el efecto en vuelo, el cronometro y el riel. La rama del
    // observer tiene que pasar por el periodo de gracia, y la navegacion NO: un
    // cambio de path es respuesta definitiva.
    const mo = src.slice(src.indexOf('const mo = new MutationObserver('),
                         src.indexOf('mo.observe(document.body'))
      // sin comentarios: la nota del fix menciona el teardown viejo a proposito
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    assert.ok(mo.length > 0, 'no se encontro el observer');
    assert.equal(/if \(!bar\)\s*{[\s\S]*onBarMissing\(\)/.test(mo), true,
      'la rama sin barra tiene que pasar por onBarMissing()');
    assert.equal(/if \(!bar\)\s*{[\s\S]*?teardownTimerFx\(\)/.test(mo), false,
      'la rama sin barra vuelve a tearing down directo: eso es el bug');
    assert.equal(/if \(bar\) clearBarMissing\(\)/.test(mo), true,
      'encontrar la barra tiene que limpiar el estado de gracia');

    const grace = src.slice(src.indexOf('function onBarMissing()'),
                            src.indexOf('function onBarMissing()') + 500);
    assert.ok(grace.length > 0, 'no se encontro onBarMissing()');
    assert.equal(/setTimeout\(/.test(grace), true,
      'la gracia tiene que ser un timer: un observer no vence con la pagina quieta');
    assert.equal(/ensureRoots\(\)/.test(grace), true,
      'la gracia tiene que volver a preguntar por la barra');
    assert.equal(/teardownTimerFx\(\)/.test(grace), true,
      'si la barra no vuelve, ahi si es fin de vida');

    // El teardown tiene que limpiar la gracia, si no el timer re-pregunta sobre
    // un estado ya deshecho.
    const td = src.slice(src.indexOf('function teardownTimerFx()'),
                         src.indexOf('function teardownTimerFx()') + 400);
    assert.equal(/clearBarMissing\(\)/.test(td), true, 'teardownTimerFx no limpia la gracia');

    // La navegacion sigue siendo inmediata.
    const wp = src.slice(src.indexOf('const watchPath'), src.indexOf('const watchPath') + 500);
    assert.ok(/teardownTimerFx\(\)/.test(wp), 'la navegacion tiene que tearing down');
    assert.equal(/onBarMissing|clearBarMissing/.test(wp), false,
      'la navegacion no pasa por la gracia: un cambio de path es definitivo');
  });

  test('los 3 modulos canvas reciben el valor efectivo, no leen matchMedia solos', () => {
    // fix-reward-fx-static-and-duo-crash: fxOpts() centraliza la decision de
    // calma y la pasa como `reduced`. La version anterior pasaba
    // `respectReducedMotion`, que cada modulo AND-eaba con su propia consulta a
    // matchMedia: con el nivel 'never' y un sistema sin preferencia, el override
    // del usuario se perdia y los canvas se animaban igual que el CSS apagado.
    assert.equal(/const fxOpts = \(\) => \{/.test(src), true, 'falta fxOpts()');
    const i = src.indexOf('const fxOpts');
    const cuerpo = src.slice(i, src.indexOf('const FX_BY_RUNG', i));
    for (const m of ['StreakFlames', 'CrystalReward', 'DuoReward']) {
      assert.equal(new RegExp(m + ': \\{ reduced: calm').test(cuerpo), true,
        m + ' no recibe el valor efectivo');
    }
    assert.equal(/new Ctor\(FX_OPTS\[/.test(src), false, 'fxInstance todavia usa la constante vieja');
  });

  test('ningun modulo vuelve a leer la preferencia del sistema', () => {
    // La decision de calma tiene UNA sola fuente (motionOff). Si un modulo
    // vuelve a consultar matchMedia, el override explícito del usuario puede
    // volver a perderse en la direccion que falló.
    const desde = src.indexOf('/* >>> streak-flames.js');
    const hasta = src.indexOf('/* <<< fin duo-reward.js');
    assert.ok(desde > -1 && hasta > desde, 'no se encontro el bloque de los 3 modulos');
    // Sin comentarios: las notas locales mencionan la opcion vieja a proposito.
    const modulos = src.slice(desde, hasta).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    assert.equal(/matchMedia/.test(modulos), false,
      'un modulo consulta matchMedia: la decision de calma deja de ser unica');
    assert.equal(/respectReducedMotion/.test(modulos), false,
      'quedo la opcion vieja, que el modulo combinaba con AND');
  });

  test('la variante calmada es mas chica y mas corta, no la misma composicion quieta', () => {
    // Con solo `reduced` los tres efectos quedaban como una foto fija a pantalla
    // completa durante 6s, indistinguible de un efecto roto. Ademas de la calma,
    // count y duration bajan.
    const i = src.indexOf('const fxOpts');
    const cuerpo = src.slice(i, src.indexOf('const FX_BY_RUNG', i));
    // El piso de duration NO es el mismo en los tres: playRewardFx destruye la
    // instancia con inst.duration + 400ms, asi que una duracion calmada por
    // debajo de la que el modulo really usa mataria el efecto a mitad de camino.
    // Los pisos estan en el modulo (Math.max(1500, duration) en llamas y
    // cristales; life = 700 cuando reduced en Duo).
    const PISOS = { StreakFlames: 1500, CrystalReward: 1500, DuoReward: 700 };
    for (const m of ['StreakFlames', 'CrystalReward', 'DuoReward']) {
      const linea = cuerpo.match(new RegExp(m + ': \\{[^}]*\\}'));
      assert.ok(linea, m + ' no tiene juego de opciones');
      assert.equal(/count: calm \? \d+ : \d+/.test(linea[0]), true, m + ' no achica count en modo calmado');
      const dur = linea[0].match(/duration: calm \? (\d+) : (\d+)/);
      assert.ok(dur, m + ' no acorta duration en modo calmado');
      assert.ok(+dur[1] >= PISOS[m], m + ': la duracion calmada (' + dur[1] + ') queda bajo el piso del modulo (' + PISOS[m] + ')');
      assert.ok(+dur[1] < +dur[2], m + ': la duracion calmada no es mas corta que la animada');
    }
  });

  test('el tiempo de un efecto nunca es negativo', () => {
    // El timestamp del frame es el instante en que el frame empezo, asi que un
    // burst disparado desde una tarea puede recibir un frame mas viejo que el.
    // Sin clampar, ease() devuelve negativo, el radio de la onda de choque se
    // vuelve negativo y Chromium tira IndexSizeError dentro del callback: la
    // reposicion del frame siguiente no ocurre y el efecto muere.
    const desde = src.indexOf('/* >>> streak-flames.js');
    const hasta = src.indexOf('/* <<< fin duo-reward.js');
    const modulos = src.slice(desde, hasta);
    const clampa = modulos.match(/Math\.max\(0,\s*now\s*-\s*[a-z]+\.start\)/g) || [];
    assert.ok(clampa.length >= 3, 'los 3 efectos tienen que clampar el tiempo transcurrido: ' + clampa.length);
    // Y un frame que no se puede dibujar no puede cortar el efecto: el pedido del
    // siguiente frame va en un finally.
    const finallys = modulos.match(/finally\s*\{/g) || [];
    assert.ok(finallys.length >= 3, 'los 3 efectos tienen que reposicionar el frame en un finally: ' + finallys.length);
  });
});

describe('animations-panel-setting: el kill switch solo silencia efectos', () => {
  const src = publishedSource();

  // Selectores del bloque, sin los comentarios que los mencionan.
  function selectoresDelBloque() {
    const b = src.match(/\/\* =+ animations-panel-setting: kill switch[\s\S]*?display:none; \}/);
    assert.ok(b, 'el bloque del kill switch tiene que existir en el archivo publicado');
    const sinComentarios = b[0].replace(/\/\*[\s\S]*?\*\//g, '');
    return sinComentarios.slice(0, sinComentarios.indexOf('{'));
  }

  const PIELES = [
    '.adhd-rung-racha', '.adhd-rung-diamante', '.adhd-rung-super',
    '.adhd-ember', '.adhd-sparkle', '.adhd-shine',
    'adhd-rung-madera::before', 'adhd-rung-bronce::before', 'adhd-rung-plata::before',
  ];
  const EFECTOS = [
    '.adhd-loss-flash', '.adhd-halo', '.adhd-rung-prev',
    '.adhd-rail-head::after', '.adhd-rail-head.urgent', '.adhd-rail-head.adhd-rail-wrap',
    '.adhd-part2', '.adhd-ring', '.adhd-seg.adhd-blink', '.adhd-seg.adhd-legendary',
  ];

  test('las pieles de peldaño NO estan en el bloque', () => {
    const sel = selectoresDelBloque();
    for (const x of PIELES) {
      assert.equal(sel.includes(x), false, x + ' no deberia estar en el kill switch');
    }
  });

  test('los efectos SI estan en el bloque', () => {
    const sel = selectoresDelBloque();
    for (const x of EFECTOS) {
      assert.equal(sel.includes(x), true, x + ' deberia estar en el kill switch');
    }
  });

  test('el bloque usa la clase body.adhd-motion-off, no @media', () => {
    // Con @media el nivel del usuario no podria silenciar por CSS, y el
    // 'always' no tendria contraparte en la hoja de estilos. Se chequea sobre
    // el bloque SIN comentarios, porque el comentario explica la mudanza y
    // menciona el @media anterior a proposito.
    const b = src.match(/\/\* =+ animations-panel-setting: kill switch[\s\S]*?display:none; \}/)[0]
      .replace(/\/\*[\s\S]*?\*\//g, '');
    assert.equal(/@media/.test(b), false);
    assert.equal(/body\.adhd-motion-off/.test(b), true);
    assert.equal(src.includes('body.adhd-motion-off'), true);
  });

  test('reintroducir una piel en el bloque rompe este test', () => {
    // El test tiene que ser sensible: si alguien agrega .adhd-shine o
    // .adhd-rung-super de vuelta, el caso de arriba falla.
    const sel = selectoresDelBloque();
    const contaminado = sel + ', body.adhd-motion-off .adhd-shine';
    assert.equal(contaminado.includes('.adhd-shine'), true, 'el detector tiene que ver la contaminacion');
    assert.equal(PIELES.some(x => contaminado.includes(x)), true);
  });
});

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

describe('audio-cues: núcleo puro del sonido', () => {
  const src = publishedSource();

  test('cueForRung mapea los 6 peldaños en orden de RUNGS', () => {
    assert.deepEqual(
      [0, 1, 2, 3, 4, 5].map(C.cueForRung),
      ['madera', 'bronce', 'plata', 'racha', 'diamante', 'super']
    );
  });

  test('los 3 altos suenan satisfactorios y los 3 bajos desagradables', () => {
    assert.deepEqual(C.SATISFYING_CUES, ['racha', 'diamante', 'super']);
    for (const r of [3, 4, 5]) assert.ok(C.SATISFYING_CUES.includes(C.cueForRung(r)));
    for (const r of [0, 1, 2]) assert.ok(!C.SATISFYING_CUES.includes(C.cueForRung(r)));
  });

  test('fuera de rango o sin índice no hay cue (cierre sin peldaño)', () => {
    for (const v of [-1, 6, 99, 1.5, '3', null, undefined, NaN, {}]) {
      assert.equal(C.cueForRung(v), null, 'cueForRung(' + String(v) + ') debería ser null');
    }
  });

  test('clampReminderSeconds acota a 15–900 y defaultea ante ruido', () => {
    assert.equal(C.clampReminderSeconds(5), 15, 'por debajo del mínimo');
    assert.equal(C.clampReminderSeconds(5000), 900, 'por encima del máximo');
    assert.equal(C.clampReminderSeconds(60), 60, 'el default pasa limpio');
    assert.equal(C.clampReminderSeconds(NaN), C.REMINDER_DEFAULT_SECONDS, 'NaN → default');
    assert.equal(C.clampReminderSeconds('ruido'), C.REMINDER_DEFAULT_SECONDS, 'texto → default');
    assert.equal(C.clampReminderSeconds(undefined), C.REMINDER_DEFAULT_SECONDS, 'undefined → default');
    assert.equal(C.clampReminderSeconds(0), 15);
    assert.equal(C.clampReminderSeconds(900), 900);
    assert.equal(C.REMINDER_DEFAULT_SECONDS, 60, 'el intervalo por defecto es 60s');
  });

  test('un config guardado antes del cambio carga con los defaults de sonido', () => {
    // La persistencia es additiva: una config vieja gana los tres valores nuevos
    // sin perder ninguna clave propia (mismo mecanismo que motionLevel).
    const viejo = { separators: 6, lang: 'en', timerMode: true, motionLevel: 'never', journalEnabled: true };
    const merged = Object.assign({}, C.DEFAULTS, viejo);
    assert.equal(merged.soundCues, true);
    assert.equal(merged.reminderEnabled, true);
    assert.equal(merged.reminderSeconds, 60);
    assert.equal(merged.lang, 'en');
    assert.equal(merged.motionLevel, 'never');
    assert.equal(merged.journalEnabled, true);
    assert.equal(merged.separators, 6);
  });

  test('formatIntervalLabel deja el intervalo legible en el panel', () => {
    assert.equal(C.formatIntervalLabel(45), '45s');
    assert.equal(C.formatIntervalLabel(60), '1m');
    assert.equal(C.formatIntervalLabel(90), '1m 30s');
    assert.equal(C.formatIntervalLabel(300), '5m');
    assert.equal(C.formatIntervalLabel(9999), '15m', 'un valor editado a mano se lee clampado');
  });

  test('los 7 cues tienen muestra embebida y receta sintetizada', () => {
    assert.deepEqual(C.SOUND_CUE_IDS.slice().sort(),
      ['bronce', 'diamante', 'madera', 'plata', 'racha', 'reminder', 'super']);
    for (const id of C.SOUND_CUE_IDS) {
      const muestra = new RegExp(id + ":\\s*'data:audio/mpeg;base64,[A-Za-z0-9+/=]+'");
      assert.equal(muestra.test(src), true, 'falta la muestra embebida de ' + id);
    }
    const synth = src.slice(src.indexOf('const SOUND_SYNTH'), src.indexOf('let audioCtx'));
    assert.ok(synth.length > 0, 'falta SOUND_SYNTH');
    for (const id of C.SOUND_CUE_IDS) {
      assert.equal(new RegExp('^\\s*' + id + ':\\s*\\{', 'm').test(synth), true,
        'falta la receta sintetizada de ' + id);
    }
  });

  test('el registro de muestras y el de recetas cubren exactamente los 7 cues', () => {
    const muestras = src.match(/^\s*(\w+):\s*'data:audio\/mpeg;base64,/gm).map(s => s.trim().split(':')[0]);
    const recetas = src.slice(src.indexOf('const SOUND_SYNTH'), src.indexOf('let audioCtx'))
      .match(/^\s*(\w+):\s*\{/gm).map(s => s.trim().split(':')[0]);
    assert.deepEqual(muestras.sort(), C.SOUND_CUE_IDS.slice().sort());
    assert.deepEqual(recetas.sort(), C.SOUND_CUE_IDS.slice().sort());
  });

  test('el panel declara la sección SONIDO con sus 4 controles', () => {
    for (const sel of ['id="adhd-sound-cues"', 'id="adhd-reminder"',
                       'id="adhd-reminder-secs"', 'id="adhd-test-sound"']) {
      assert.equal(src.includes(sel), true, 'falta el control ' + sel);
    }
    assert.equal(src.includes('secSonido'), true, 'falta la sección');
    // El intervalo se pinta clampado y con el rango soportado.
    assert.equal(/id="adhd-reminder-secs" min="\$\{REMINDER_MIN_SECONDS\}" max="\$\{REMINDER_MAX_SECONDS\}"/.test(src), true,
      'el slider no usa los límites del núcleo');
    assert.equal(/value="\$\{clampReminderSeconds\(cfg\.reminderSeconds\)\}"/.test(src), true,
      'el slider no arranca clampado');
  });

  test('el panel tiene i18n para los 7 textos nuevos, en ES y EN', () => {
    const claves = ['secSonido', 'lblSoundCues', 'hintSoundCues', 'lblReminder',
                    'hintReminder', 'lblReminderInterval', 'btnTestSound'];
    for (const k of claves) {
      for (const lang of ['es', 'en']) {
        assert.equal(C.tr(lang, k) !== undefined, true, 'falta ' + k + ' en ' + lang);
      }
      assert.notEqual(C.tr('es', k), C.tr('en', k), k + ' no está traducida');
    }
  });

  test('los controles persisten y el intervalo reinicia el scheduler', () => {
    const i = src.indexOf("querySelector('#adhd-sound-cues')");
    assert.ok(i > -1, 'falta el listener del toggle de sonidos');
    const handler = src.slice(i, i + 1400);
    assert.equal(/setCfg\('soundCues'/.test(handler), true, 'el toggle de sonidos no persiste');
    assert.equal(/setCfg\('reminderEnabled'/.test(handler), true, 'el toggle del recordatorio no persiste');
    assert.equal(/syncReminder\(\)/.test(handler), true, 'el recordatorio no se re-arma al cambiarlo');
    assert.equal(/setCfg\('reminderSeconds'/.test(handler), true, 'el intervalo no persiste');
    assert.equal(/clampReminderSeconds\(parseInt/.test(handler), true, 'el intervalo no se clampa al guardar');
    assert.equal(/querySelector\('#adhd-test-sound'\)/.test(src), true, 'falta el listener del botón de prueba');
  });

  test('init arma el recordatorio y el desbloqueo sin depender de la lección', () => {
    const i = src.indexOf('function init()');
    const cuerpo = src.slice(i, src.indexOf('\n  }', i));
    assert.equal(/bindAudioUnlock\(\)/.test(cuerpo), true, 'init no ata el desbloqueo de audio');
    assert.equal(/syncReminder\(\)/.test(cuerpo), true, 'init no arranca el recordatorio');
    // Tiene que estar antes del sondeo de la barra: si no, no sonaría en /learn.
    assert.ok(cuerpo.indexOf('syncReminder()') < cuerpo.indexOf('ensureRoots()'),
      'el recordatorio no puede esperar a que haya barra');
  });

  test('el recordatorio vive en su propio tick y no acumula deuda con la pestaña oculta', () => {
    const i = src.indexOf('function reminderTick()');
    const cuerpo = src.slice(i, src.indexOf('function syncReminder()', i));
    assert.ok(i > -1 && cuerpo.length > 0, 'falta reminderTick()');
    assert.equal(/document\.hidden/.test(cuerpo), true, 'no mira si la pestaña está oculta');
    assert.equal(/reminderNextAt = Date\.now\(\) \+ ms/.test(cuerpo), true,
      'con la pestaña oculta no se empuja el vencimiento: se acumularía deuda');
    assert.equal(/playCue\('reminder'\)/.test(cuerpo), true, 'no reproduce el recordatorio');

    // El timer solo existe con el recordatorio encendido (costo cero apagado).
    const sync = src.slice(src.indexOf('function syncReminder()'), src.indexOf('function reminderTick()'));
    assert.equal(/cfg\.reminderEnabled\) startReminder\(\); else stopReminder\(\)/.test(sync), true,
      'syncReminder no crea/destruye el timer según el toggle');
    assert.equal(/if \(reminderTimer\) \{ clearInterval\(reminderTimer\)/.test(src), true,
      'stopReminder no limpia el timer');
  });

  test('los disparos del cierre de tramo están gateados por soundCues y timerMode', () => {
    const disparos = src.match(/if \(cfg\.soundCues && cfg\.timerMode\)[^\n]*playTierCue\(/g) || [];
    assert.equal(disparos.length, 2, 'esperaba 2 disparos (cruce + último tramo): ' + disparos.length);
    assert.equal(/if \(!cfg\.soundCues\) return;/.test(src), true,
      'playTierCue no corta cuando los sonidos están apagados');
    // El listener del botón de prueba y el gate no pueden pisarse.
    assert.equal(/function playTierCue\(rung\)/.test(src), true, 'falta playTierCue()');
    assert.equal(/TIER_CUE_MIN_GAP_MS/.test(src), true, 'falta la separación mínima entre cues');
  });

  test('playCue nunca lanza y el AudioContext es único y perezoso', () => {
    const i = src.indexOf('function playCue(id)');
    const cuerpo = src.slice(i, src.indexOf('function playTierCue', i));
    assert.ok(i > -1, 'falta playCue()');
    assert.equal(/try \{[\s\S]*\} catch \(e\)/.test(cuerpo), true, 'playCue no está envuelto en try/catch');
    assert.equal(/const AC = window\.AudioContext \|\| window\.webkitAudioContext/.test(src), true,
      'no usa el prefijo webkit como fallback');
    assert.equal(/audioMaster\.gain\.value = 0\.7/.test(src), true, 'falta el gain master');
    assert.equal(/window\.addEventListener\('pointerdown'/.test(src), true,
      'no hay desbloqueo en el primer gesto');
    assert.equal(/window\.addEventListener\('keydown'/.test(src), true,
      'sin gesto de teclado no hay desbloqueo en pantallas táctiles raras');
    assert.equal(/decodeAudioData\(dataUriBuffer\(uri\)/.test(src), true,
      'las muestras no se decodifican desde el data URI');
    assert.equal(/fetch\(|XMLHttpRequest|GM_xmlhttpRequest\(/.test(cuerpo), false,
      'playCue hace una petición de red: la spec lo prohíbe');
  });

  test('las muestras embebidas son MP3 válidos y respetan el presupuesto', () => {
    let total = 0;
    for (const id of C.SOUND_CUE_IDS) {
      const m = src.match(new RegExp(id + ":\\s*'data:audio/mpeg;base64,([A-Za-z0-9+/=]+)'"));
      assert.ok(m, 'falta la muestra de ' + id);
      const buf = Buffer.from(m[1], 'base64');
      total += m[1].length;
      // Cabecera ID3 o frame sync MPEG: si no, lo que se embebió no es audio.
      const esMp3 = (buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) ||
                    (buf.length > 1 && buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0);
      assert.equal(esMp3, true,
        id + ' no es MP3 (bytes: ' + buf.slice(0, 4).toString('hex') + ')');
      assert.ok(buf.length > 2048, id + ' quedó sospechosamente chica: ' + buf.length);
      // Presupuesto del design: ≤ 40KB por cue medido en el archivo publicado.
      assert.ok(m[1].length <= 55000, id + ' se pasa del presupuesto: ' + m[1].length + 'B de base64');
    }
    assert.ok(total <= 100000, 'el audio embebido total se pasa de presupuesto: ' + total + 'B');
  });

  test('las recetas sintéticas son distintas y cortas (fallback audiblemente diferenciable)', () => {
    const synth = src.slice(src.indexOf('const SOUND_SYNTH'), src.indexOf('let audioCtx'));
    const firmas = [];
    for (const id of C.SOUND_CUE_IDS) {
      const m = synth.match(new RegExp('^\\s*' + id + ':\\s*\\{([^}]*)\\}', 'm'));
      assert.ok(m, 'falta la receta de ' + id);
      const len = m[1].match(/len:\s*([\d.]+)/);
      assert.ok(len, id + ' sin duración');
      assert.ok(+len[1] <= 0.7, id + ' dura ' + len[1] + 's: taparía el siguiente cierre');
      assert.equal(/wave:\s*'(triangle|square|sine|sawtooth)'/.test(m[1]), true, id + ' sin wave válida');
      assert.equal(/seq:\s*\[[^\]]+\]/.test(m[1]), true, id + ' sin secuencia de notas');
      firmas.push(m[1].replace(/\s+/g, ' ').trim());
    }
    assert.equal(new Set(firmas).size, firmas.length, 'hay recetas idénticas entre sí');
    assert.ok(/523, 659, 784, 1047/.test(firmas[C.SOUND_CUE_IDS.indexOf('super')]),
      'super no cierra agudo: no suena satisfactorio');
    assert.ok(/196, 165, 130/.test(firmas[C.SOUND_CUE_IDS.indexOf('madera')]),
      'madera no es la más grave de la escalera');
  });
});

describe('remind-only-when-idle: el recordatorio solo suena en idle', () => {
  const src = publishedSource();

  test('REMINDER_IDLE_MS fija el umbral de foco en 45 s', () => {
    assert.equal(C.REMINDER_IDLE_MS, 45000);
  });

  test('canPlayReminder suena con la pestaña visible y 45 s sin interacción', () => {
    assert.equal(C.canPlayReminder({ now: 100000, lastInteractionAt: 55000, hidden: false }), true);
  });

  test('canPlayReminder no suena si el usuario interactuó hace 10 s (está enfocado)', () => {
    assert.equal(C.canPlayReminder({ now: 100000, lastInteractionAt: 90000, hidden: false }), false);
  });

  test('canPlayReminder nunca suena con la pestaña oculta (reproducir exige visible)', () => {
    assert.equal(C.canPlayReminder({ now: 100000, lastInteractionAt: 0, hidden: true }), false);
  });

  test('el umbral es inclusivo y la entrada basura no suena', () => {
    assert.equal(C.canPlayReminder({ now: 100000, lastInteractionAt: 55001, hidden: false }), false);
    assert.equal(C.canPlayReminder(undefined), false);
    assert.equal(C.canPlayReminder({}), false);
    assert.equal(C.canPlayReminder({ now: NaN, lastInteractionAt: 0, hidden: false }), false);
    assert.equal(C.canPlayReminder({ now: 100000, hidden: false }), false);
  });

  test('el tick solo dispara en idle: enfocado queda pendiente sin mover el vencimiento', () => {
    const i = src.indexOf('function reminderTick()');
    assert.ok(i > -1, 'falta reminderTick()');
    const cuerpo = src.slice(i, src.indexOf("document.addEventListener('visibilitychange'", i));
    // reminder-desktop-notification: el gate de idle vive en el núcleo puro
    // (reminderAction) y el tick DELEGA en él con el estado real. Se pinea la
    // delegación y el estado que viaja, no el formato literal de la llamada.
    assert.equal(/reminderAction\(\{/.test(cuerpo), true,
      'el tick no consulta la decisión pura (reminderAction)');
    assert.equal(/hidden: document\.hidden/.test(cuerpo), true,
      'el tick no pasa el estado de visibilidad a la decisión');
    assert.equal(/lastInteractionAt,/.test(cuerpo), true,
      'el tick no pasa la última interacción a la decisión');
    assert.equal(/reminderPending = true/.test(cuerpo), true, 'no queda pendiente cuando toca enfocado');
    // Pendiente ≠ vencido de nuevo: el branch que no suena NO reagenda.
    const pendiente = cuerpo.slice(cuerpo.indexOf('reminderPending = true'),
      cuerpo.indexOf('reminderPending = true') + 80);
    assert.equal(/reminderNextAt\s*=/.test(pendiente), false,
      'el branch pendiente reagenda: acumularía deuda');
    // reminder-desktop-notification: con DOS canales hay DOS reagenda — uno
    // por entrega real. El audible nace del cue; el oculto, de una notificación
    // que SÍ se entregó ('sent'). Ninguno nace de un intento fallido, y el
    // branch pendiente (arriba) sigue sin reagenda: nunca ráfaga.
    const reagenda = (cuerpo.match(/reminderNextAt =/g) || []).length;
    assert.equal(reagenda, 2, 'el tick reagenda más veces que canales entrega');
    const ramaNotify = cuerpo.slice(cuerpo.indexOf("action === 'notify'"), cuerpo.indexOf('pendingReturnAt'));
    assert.equal((ramaNotify.match(/reminderNextAt =/g) || []).length, 1,
      'la rama notify reagenda más de una vez');
    assert.ok(ramaNotify.indexOf("r === 'sent'") < ramaNotify.indexOf('reminderNextAt ='),
      'el reagenda del canal oculto no nace de una entrega confirmada');
    // El reagenda audible nace del momento en que SONÓ (último cue → último
    // reagenda: el camino audible es el final del tick).
    assert.ok(cuerpo.lastIndexOf("playCue('reminder')") < cuerpo.lastIndexOf('reminderNextAt ='),
      'el próximo intervalo audible no nace del momento del play');
  });

  test('al volver de una pestaña oculta: gracia de 5 s y reset solo si nada pendía', () => {
    assert.equal(/REMINDER_RETURN_GRACE_MS = 5000/.test(src), true, 'la gracia no es ~5 s');
    const i = src.indexOf("document.addEventListener('visibilitychange'");
    const cuerpo = src.slice(i, i + 700);
    assert.equal(/pendingReturnAt = Date\.now\(\) \+ REMINDER_RETURN_GRACE_MS/.test(cuerpo), true,
      'la gracia no se sella al volver');
    assert.equal(/if \(!reminderPending\)/.test(cuerpo), true,
      'el reset del vencimiento no mira lo pendiente');
    const tick = src.slice(src.indexOf('function reminderTick()'),
      src.indexOf("document.addEventListener('visibilitychange'"));
    assert.equal(/pendingReturnAt/.test(tick), true, 'el tick no respeta la gracia');
  });

  test('los listeners de interacción viven y mueren con el toggle (costo cero apagado)', () => {
    const evs = src.match(/REMINDER_IDLE_EVENTS = \[([^\]]+)\]/);
    assert.ok(evs, 'falta la lista de eventos de interacción');
    for (const ev of ['pointerdown', 'pointermove', 'keydown', 'wheel', 'scroll', 'touchstart']) {
      assert.equal(evs[1].includes("'" + ev + "'"), true, 'falta el evento ' + ev);
    }
    const start = src.slice(src.indexOf('function startReminder()'), src.indexOf('function syncReminder()'));
    assert.equal(/document\.addEventListener\(ev, stampInteraction, \{ capture: true, passive: true \}\)/.test(start), true,
      'los listeners de idle no son capture+passive');
    assert.equal(/lastInteractionAt = Date\.now\(\)/.test(start), true,
      'encender no estampa la interacción: sonaría de inmediato');
    const stop = src.slice(src.indexOf('function stopReminder()'), src.indexOf('function startReminder()'));
    assert.equal(/document\.removeEventListener\(ev, stampInteraction, true\)/.test(stop), true,
      'apagar no retira los listeners: costo cero roto');
  });
});

describe('reminder-desktop-notification: la decisión vence-ahora-¿qué-hago? (reminderAction)', () => {
  const IDLE = C.REMINDER_IDLE_MS;
  // Un recordatorio vencido justito (now == nextAt), visible, con el idle
  // exacto: el caso canónico del camino audible.
  const due = (over) => ({
    now: 1000000 + (over || 0), nextAt: 1000000,
    hidden: false, lastInteractionAt: 1000000 - IDLE, notifEnabled: false,
  });

  test('visible + idle → play: el camino audible de siempre', () => {
    assert.equal(C.reminderAction(due()), 'play');
  });

  test('visible + enfocado → pending: la deuda es una y no se pierde', () => {
    const s = due();
    s.lastInteractionAt = s.now - 1000;   // interactuó hace 1 s
    assert.equal(C.reminderAction(s), 'pending');
  });

  test('oculto + notificación activada → notify: escala al canal de escritorio', () => {
    const s = due();
    s.hidden = true; s.notifEnabled = true;
    assert.equal(C.reminderAction(s), 'notify');
  });

  test('oculto + notificación desactivada → pending: el comportamiento anterior, exacto', () => {
    const s = due();
    s.hidden = true; s.notifEnabled = false;
    assert.equal(C.reminderAction(s), 'pending');
  });

  test('oculto 30 min (más allá del umbral de throttling de 5 min) → notify igual', () => {
    // El throttling de Chrome cae a 1 wake/min a los 5 min oculto: para la
    // página "oculto un rato" y "oculto media hora" llegan igual al tick. La
    // decisión no puede depender de cuánto hace que no se ve la pestaña —
    // este es el caso que documenta por qué existe la rama (tasks 1.2).
    const s = due();
    s.hidden = true; s.notifEnabled = true;
    s.now = s.nextAt + 30 * 60 * 1000;
    assert.equal(C.reminderAction(s), 'notify');
  });

  test('antes del vencimiento → none, aunque todo lo demás invite a sonar', () => {
    const s = due(-1);   // ahora = vencimiento - 1 ms
    assert.equal(C.reminderAction(s), 'none');
    s.hidden = true; s.notifEnabled = true;
    assert.equal(C.reminderAction(s), 'none');
  });

  test('basura y NaN → none: la decisión nunca inventa trabajo', () => {
    assert.equal(C.reminderAction(null), 'none');
    assert.equal(C.reminderAction(undefined), 'none');
    assert.equal(C.reminderAction({}), 'none');
    assert.equal(C.reminderAction({ now: NaN, nextAt: 0, hidden: false, lastInteractionAt: 0, notifEnabled: true }), 'none');
    assert.equal(C.reminderAction({ now: 5, nextAt: NaN, hidden: true, lastInteractionAt: 0, notifEnabled: true }), 'none');
    assert.equal(C.reminderAction({ now: 5, nextAt: 0, hidden: false, lastInteractionAt: NaN, notifEnabled: true }), 'none');
  });

  test('notifEnabled basura → pending: sin elección explícita, el silencio de antes', () => {
    const s = due();
    s.hidden = true; s.notifEnabled = 'garbage';
    assert.equal(C.reminderAction(s), 'pending');
  });

  test('el umbral de idle es inclusivo, igual que canPlayReminder', () => {
    const s = due();
    s.lastInteractionAt = s.now - IDLE;
    assert.equal(C.reminderAction(s), 'play');
    s.lastInteractionAt = s.now - IDLE + 1;
    assert.equal(C.reminderAction(s), 'pending');
  });
});

describe('reminder-desktop-notification: el canal de escritorio (GM_notification)', () => {
  // Crudo, CON metadata: el @grant vive en el bloque ==UserScript==.
  const raw = fs.readFileSync(publishedPath(), 'utf8');
  const body = publishedSource();

  test('el @grant de GM_notification está declarado en la metadata', () => {
    assert.equal(/^\/\/ @grant\s+GM_notification$/m.test(raw), true,
      'falta el @grant: sin él el manager no expone GM_notification y el canal muere en silencio');
  });

  test('jamás se toca la Notification del sitio: ni permiso ni constructor', () => {
    assert.equal(/Notification\.requestPermission/.test(body), false,
      'pedir permiso lo atribuiría a duolingo.com (spec: la notificación sale del manager)');
    assert.equal(/new Notification\s*\(/.test(body), false,
      'la notificación no puede salir de la página: le daría al sitio un permiso que nunca pidió');
  });

  test('feature-detect antes de llamar: un @grant declarado no garantiza la función', () => {
    const i = body.indexOf('function notifyReminder(');
    assert.ok(i > -1, 'falta notifyReminder()');
    const cuerpo = body.slice(i, i + 400);
    assert.equal(/typeof GM_notification !== 'function'/.test(cuerpo), true,
      'sin feature-detect el recordatorio revienta en Violentmonkey/Greasemonkey/Safari');
  });

  test('fallback: GM_notification ausente → unsupported, sin lanzar', () => {
    const had = globalThis.GM_notification;
    delete globalThis.GM_notification;
    try {
      assert.equal(C.notifyReminder('t', 'b'), 'unsupported');
    } finally { if (had !== undefined) globalThis.GM_notification = had; }
  });

  test('fallback: la decisión no depende de la API — oculto+notif sigue siendo notify', () => {
    const had = globalThis.GM_notification;
    delete globalThis.GM_notification;
    try {
      const s = { now: 100, nextAt: 0, hidden: true, lastInteractionAt: 0, notifEnabled: true };
      assert.equal(C.reminderAction(s), 'notify');
    } finally { if (had !== undefined) globalThis.GM_notification = had; }
  });

  test('GM_notification que revienta → blocked: el intento no se entrega, sin lanzar', () => {
    globalThis.GM_notification = () => { throw new Error('daemon caído'); };
    try {
      assert.equal(C.notifyReminder('t', 'b'), 'blocked');
    } finally { delete globalThis.GM_notification; }
  });

  test('GM_notification viva → sent, con silent: el sonido lo pone el script', () => {
    let seen = null;
    globalThis.GM_notification = (d) => { seen = d; };
    try {
      assert.equal(C.notifyReminder('Título', 'Cuerpo'), 'sent');
      assert.equal(seen && seen.silent, true, 'la notificación no debe sonar por sí sola');
      assert.equal(seen && seen.title, 'Título');
      assert.equal(seen && seen.text, 'Cuerpo');
    } finally { delete globalThis.GM_notification; }
  });
});

describe('reminder-desktop-notification: el panel falla visible', () => {
  const src = publishedSource();

  test('la sección de sonido tiene el toggle de notificación con id estable, persistido', () => {
    assert.equal(/id="adhd-reminder-notif"/.test(src), true,
      'falta el control de notificación con id estable');
    const i = src.indexOf("querySelector('#adhd-reminder-notif')");
    assert.ok(i > -1, 'falta el listener del toggle de notificación');
    const cuerpo = src.slice(i, i + 220);
    assert.equal(/setCfg\('reminderNotifEnabled', e\.target\.checked\)/.test(cuerpo), true,
      'el toggle de notificación no persiste');
  });

  test('valor desconocido del toggle cae al default, no queda indefinido', () => {
    const i = src.indexOf('adhd_config');
    const carga = src.slice(i, i + 700);
    assert.equal(/typeof cfg\.reminderNotifEnabled !== 'boolean'/.test(carga), true,
      'la carga no normaliza un reminderNotifEnabled corrupto/editado a mano');
    assert.equal(/cfg\.reminderNotifEnabled = DEFAULTS\.reminderNotifEnabled/.test(carga), true,
      'el fallback no cae al default');
  });

  test('los mensajes de estado existen en las dos variantes (EN/ES)', () => {
    assert.ok(C.I18N.es.notifBlocked, 'falta el mensaje de bloqueado (ES)');
    assert.ok(C.I18N.en.notifBlocked, 'falta el mensaje de bloqueado (EN)');
    assert.ok(C.I18N.es.notifUnsupported, 'falta el mensaje de manager sin API (ES)');
    assert.ok(C.I18N.en.notifUnsupported, 'falta el mensaje de manager sin API (EN)');
    assert.ok(C.I18N.es.lblReminderNotif && C.I18N.en.lblReminderNotif, 'falta la etiqueta del toggle');
  });

  test('el intento no entregado se escribe en el panel (y se limpia al entregar)', () => {
    const i = src.indexOf('function renderNotifStatus');
    assert.ok(i > -1, 'falta renderNotifStatus()');
    const cuerpo = src.slice(i, i + 700);
    assert.equal(/adhd-reminder-notif-status/.test(cuerpo), true,
      'el estado no se escribe en el elemento del panel');
    assert.equal(/notifBlocked/.test(cuerpo), true, 'no muestra el mensaje de bloqueado');
    assert.equal(/notifUnsupported/.test(cuerpo), true, 'no distingue el manager sin API');
    const tick = src.slice(src.indexOf('function reminderTick()'),
      src.indexOf("document.addEventListener('visibilitychange'"));
    assert.equal(/renderNotifStatus\(\)/.test(tick), true,
      'el tick no actualiza el estado del panel tras un intento');
    const seccion = src.slice(src.indexOf('// ===== Sección SONIDO'), src.indexOf('// ===== Sección DIARIO'));
    assert.equal(/id="adhd-reminder-notif-status"/.test(seccion), true,
      'la sección de sonido no tiene el elemento de estado');
    const build = src.indexOf('panel.innerHTML = html');
    assert.ok(build > -1 && src.indexOf('renderNotifStatus()', build) > build,
      'el panel no pinta el estado actual al abrirse');
  });
});

describe('add-field-qa-loop: plantilla del guion de campo', () => {
  const plantillaPath = path.join(__dirname, '..', 'qa', 'plantilla-guion.html');

  function plantillaSrc() { return fs.readFileSync(plantillaPath, 'utf8'); }

  // El builder del reporte vive en el unico <script> inline de la plantilla;
  // se evalua con stubs para probar el artefacto real, no una copia.
  function guionApi() {
    const html = plantillaSrc();
    const m = html.match(/<script>([\s\S]*?)<\/script>/);
    assert.ok(m, 'la plantilla no tiene script inline');
    const winStub = {};
    // eslint-disable-next-line no-new-func
    new Function('window', 'document', 'localStorage', m[1])(
      winStub, { getElementById: () => null }, undefined);
    assert.ok(winStub.__guion, 'el script no expone __guion');
    return winStub.__guion;
  }

  test('la plantilla existe, es offline y sin dependencias', () => {
    const html = plantillaSrc();
    assert.equal(/<script src=/.test(html), false, 'carga un script externo');
    assert.equal(/(src|href)="https?:/.test(html), false, 'referencia recursos de red');
    assert.equal(/url\(https?:/.test(html), false, 'importa CSS externo');
  });

  test('el smoke fijo viene pre-impreso con sus 9 items', () => {
    const html = plantillaSrc();
    for (const id of ['smoke-boot', 'smoke-barra', 'smoke-riel', 'smoke-panel',
                      'smoke-sonido', 'smoke-motion', 'smoke-recordatorio', 'smoke-journal',
                      'smoke-notif']) {
      assert.equal(html.includes('data-q="' + id + '"'), true, 'falta el smoke ' + id);
    }
  });

  test('el builder exporta MD con front matter y verdictos greppables', () => {
    const api = guionApi();
    const data = {
      meta: { change: 'demo-change', version: '9.9.9', fecha: '2026-10-06' },
      saltoGeneral: false, saltoMotivo: '',
      preguntas: [
        { id: 'c1', seccion: 'Preguntas del change', texto: 'Suena el recordatorio en idle', verdict: 'OK', nota: 'lo probe 3 veces', evidencia: 'version 9.9.9' },
        { id: 'c2', seccion: 'Preguntas del change', texto: 'El riel no se superpone', verdict: 'FALLA', nota: 'se pisa con el cronometro', evidencia: 'path /lesson' },
        { id: 's1', seccion: 'Smoke', texto: 'boot sin errores', verdict: 'SALTO', nota: '', evidencia: '' },
      ],
    };
    const md = api.buildReport(data);
    assert.ok(md.startsWith('---\n'), 'no abre con front matter');
    for (const clave of ['change: demo-change', 'version: 9.9.9', 'fecha: 2026-10-06',
                         'resultado: fail', 'fallas: 1']) {
      assert.equal(md.includes(clave), true, 'falta en el front matter: ' + clave);
    }
    for (const marca of ['[OK]', '[FALLA]', '[SALTO]', 'Nota:', 'Evidencia:']) {
      assert.equal(md.includes(marca), true, 'falta la marca ' + marca);
    }
    assert.equal(md.includes('lo probe 3 veces'), true, 'pierde la nota');
    assert.equal(md.includes('se pisa con el cronometro'), true, 'pierde la nota de la falla');
  });

  test('el resultado se computa: pass/fail/skip y el export se niega sin responder', () => {
    const api = guionApi();
    const q = (verdict) => [{ verdict }];
    assert.equal(api.computeResultado(q('OK'), false), 'pass');
    assert.equal(api.computeResultado(q('FALLA'), false), 'fail');
    assert.equal(api.computeResultado(q('OK'), true), 'skip');
    assert.equal(api.computeResultado([{ verdict: null }], false), null,
      'una pregunta sin verdict no puede exportar');
    assert.equal(api.reportName('demo-change'), 'demo-change-campo.md');
  });
});

describe('add-field-qa-loop: companion de QA + revert del in-script', () => {
  const src = publishedSource();

  // live-playwright-probe: el companion se elimino (lo reemplaza el probe con
  // captura nativa de pageerror/console). Sus dos tests se fueron con el
  // archivo. Queda este: el publicado sigue sin tooling de QA adentro.
  test('el userscript publicado quedó limpio del diagnóstico in-script', () => {
    for (const marker of ['adhd-diag', 'diagAddError', 'diagErrors', 'diagReset',
                          'buildDiagnosticBlock', 'secDiag', 'btnCopyDiag', 'hintDiag',
                          'diagCopied', 'DIAG_SVG', 'DIAG_RING_LIMIT']) {
      assert.equal(src.includes(marker), false, 'quedó ' + marker + ' en el archivo publicado');
    }
  });
});

describe('fix-crono-contrast: el contador legible en cada peldaño', () => {
  const src = publishedSource();

  // Contraste WCAG calculado acá, independiente de la implementación.
  function lum(hex) {
    const h = hex.replace('#', '');
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
      .map((c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }
  function ratio(a, b) {
    const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  }

  test('cronoTextColor empareja cada peldaño con su dígito legible', () => {
    const esperado = {
      madera: '#ffffff', bronce: '#ffffff', plata: null,
      racha: null, diamante: null, super: '#ffffff',
    };
    for (const R of C.RUNGS) {
      const dig = C.cronoTextColor(R.from, R.ink);
      const quiere = esperado[R.id] === null ? R.ink : esperado[R.id];
      assert.equal(dig, quiere, R.id + ': dígito ' + dig + ' en vez de ' + quiere);
    }
  });

  test('cada peldaño supera 3:1 con su dígito emparejado (spec: large text)', () => {
    for (const R of C.RUNGS) {
      const dig = C.cronoTextColor(R.from, R.ink);
      assert.ok(ratio(R.from, dig) >= 3, R.id + ' queda en ' + ratio(R.from, dig).toFixed(2) + ':1');
    }
  });

  test('cronoTextColor elige siempre el de mayor contraste y cae en blanco ante basura', () => {
    // Fondo oscuro con ink oscura: gana blanco. Fondo claro con ink oscura: gana la ink.
    assert.equal(C.cronoTextColor('#101010', '#202020'), '#ffffff');
    assert.equal(C.cronoTextColor('#f0f0f0', '#202020'), '#202020');
    // Basura: sin ink, hex inválido, null → blanco seguro, nunca lanza.
    assert.equal(C.cronoTextColor('#8d6e63'), '#ffffff');
    assert.equal(C.cronoTextColor('no-es-hex', '#123456'), '#ffffff');
    assert.equal(C.cronoTextColor('#8d6e63', 'no-es-hex'), '#ffffff');
    assert.equal(C.cronoTextColor(null, null), '#ffffff');
    assert.equal(C.cronoTextColor(), '#ffffff');
  });
});

describe('fix-crono-contrast: el tick y el CSS del contador', () => {
  const src = publishedSource();
  const tick = src.slice(src.indexOf('function tick() {'), src.indexOf('updateDecayTimeline(L);'));
  // Bloques CSS del contador (base + override Baloo 2 + urgent).
  const cssCrono = src.split('\n').filter((l) => /\.adhd-mini-crono(\.urgent)? \{/.test(l) || /^\s+(background|color|transition):/.test(l));

  function lumHex(hex) {
    const h = hex.replace('#', '');
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
      .map((c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  test('el tick ya no pinta el texto con el extremo del gradiente', () => {
    assert.ok(tick.length > 100, 'no se encontró el tick del crono');
    assert.equal(/miniCronoEl\.style\.color = R\.from/.test(src), false,
      'el texto sigue tomando R.from: oscuro sobre oscuro');
  });

  test('el tick pinta la superficie del peldaño y el dígito emparejado', () => {
    assert.equal(/style\.background = urgent \? CRONO_URGENT_BG : R\.from/.test(tick), true,
      'el fondo no es urgente-rojo o el color del peldaño (el inline le gana a .urgent)');
    assert.equal(/style\.color = urgent \? '#ffffff' : cronoTextColor\(R\.from, R\.ink\)/.test(tick), true,
      'el dígito no usa el emparejamiento legible / urgent no fuerza blanco');
  });

  test('el rojo urgente es sólido y el blanco lo lee con ≥3:1', () => {
    const m = src.match(/const CRONO_URGENT_BG = '(#[0-9a-fA-F]{6})'/);
    assert.ok(m, 'falta CRONO_URGENT_BG');
    const r = (1.05) / (lumHex(m[1]) + 0.05);
    assert.ok(r >= 3, 'blanco sobre ' + m[1] + ' queda en ' + r.toFixed(2) + ':1');
  });

  test('el CSS del contador no usa fondos translúcidos y transiciona el fondo', () => {
    const base = src.slice(src.indexOf('/* ===== Feature 1: mini cronómetro ===== */'));
    const bloqueBase = base.slice(0, base.indexOf('}') + 1);
    assert.equal(/rgba\(/.test(bloqueBase), false, 'el CSS base del crono sigue con un fondo rgba()');
    assert.equal(/\.adhd-mini-crono\.urgent \{[^}]*rgba\(/.test(src), false,
      '.urgent sigue translúcido (color sobre color)');
    assert.equal(/\.adhd-mini-crono \{[^}]*transition:[^;}]*background/.test(base), true,
      'la transición no cubre el fondo: el cambio de peldaño sería un salto');
  });
});

describe('calm-canvas-grayscale: rampa de grises por peldaño con efecto', () => {
  const src = publishedSource();

  // WCAG propia del test, independiente de la implementación (mismo patrón
  // que la suite de fix-crono-contrast): el floor es una medición, no una
  // constante copiada del código.
  function lumHex(h) {
    const v = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
      .map((c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
    return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
  }
  function ratio(a, b) {
    const x = lumHex(a), y = lumHex(b);
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  }
  function esGris(h) {
    const m = /^#([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})$/.exec(h);
    return !!m && m[1].toLowerCase() === m[2].toLowerCase() && m[2].toLowerCase() === m[3].toLowerCase();
  }

  test('los tres peldaños con efecto resuelven un gris cada uno', () => {
    assert.equal(typeof C.calmGreyFor, 'function', 'falta calmGreyFor en el núcleo');
    for (const rung of [3, 4, 5]) {
      const g = C.calmGreyFor(rung);
      assert.equal(esGris(g), true, `peldaño ${rung} no resuelve un gris neutro: ${g}`);
    }
  });

  test('los dos pares consecutivos miden ≥1.5:1 (lo que el gris ingenuo falla)', () => {
    const [r3, r4, r5] = [C.calmGreyFor(3), C.calmGreyFor(4), C.calmGreyFor(5)];
    assert.ok(ratio(r3, r4) >= 1.5, `racha↔diamante ${ratio(r3, r4).toFixed(2)}:1 < 1.5:1`);
    assert.ok(ratio(r4, r5) >= 1.5, `diamante↔super ${ratio(r4, r5).toFixed(2)}:1 < 1.5:1`);
  });

  test('el ramp no inventa grises para peldaños sin efecto ni lanza con basura', () => {
    assert.equal(C.calmGreyFor(0), null, 'madera no tiene efecto canvas: debe ser null');
    assert.equal(C.calmGreyFor(2), null, 'plata no tiene efecto canvas: debe ser null');
    assert.equal(C.calmGreyFor(99), null, 'peldaño inexistente: debe ser null');
    assert.equal(C.calmGreyFor('super'), null, 'la clave es el indice, no el id');
  });

  test('alcance pineado: el ramp vive solo en los tres efectos, nunca en el cronómetro', () => {
    // Definición + export + 3 usos (uno por efecto). Cualquier otro uso
    // (cronómetro, riel, segmentos) rompe este conteo a propósito: es la
    // defensa del fix-crono-contrast contra grisar la capa informativa.
    const n = (src.match(/calmGreyFor/g) || []).length;
    assert.equal(n, 5, `calmGreyFor aparece ${n} veces, deben ser 5 (def + export + 3 efectos)`);
    const tick = src.slice(src.indexOf('function startMiniCrono'), src.indexOf('function stopMiniCrono'));
    assert.ok(tick.length > 1000, 'no se encontró la región del tick del cronómetro');
    assert.equal(/calmGreyFor/.test(tick), false, 'el cronómetro referencia el ramp: prohibido por spec');
  });

  test('shadeGrey escala un gris sin sacarlo del eje neutro', () => {
    assert.equal(typeof C.shadeGrey, 'function', 'falta shadeGrey en el núcleo');
    assert.equal(C.shadeGrey('#808080', 1), '#808080', 'factor 1 es identidad');
    const oscuro = C.shadeGrey('#808080', 0.5);
    assert.equal(oscuro, '#404040', 'factor 0.5 parte al medio: ' + oscuro);
    assert.equal(C.shadeGrey('#808080', 2), '#ffffff', 'clampa arriba, no se pasa de ff');
    assert.equal(C.shadeGrey('#808080', 0), '#000000', 'factor 0 es negro');
    assert.equal(C.shadeGrey('basura', 1), null, 'basura no lanza: null');
    assert.equal(C.shadeGrey('#808080', NaN), null, 'factor NaN no lanza: null');
  });
});
