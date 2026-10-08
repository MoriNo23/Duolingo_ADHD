// Check end-to-end de navegador: bootea el ARCHIVO PUBLICADO entero en Chromium.
//
// Por que esto existe y los tests de Node no alcanzan: un fallo de runtime en el
// navegador es invisible desde Node. Lo mas tipico es un stylesheet inyectado que
// no parsea — Firefox/Chromium lanzan SyntaxError desde appendChild — que solo se
// ve cuando el script inserta su CSS de verdad. Los dos arneses anteriores
// (verify-rail-dom.js / verify-settings-dom.js) copiaban regiones del script a un
// DOM sintetico: cazaron bugs reales, pero no cubrian el arranque completo.
//
// Este check inyecta el archivo entero, con stubs de la API de userscript manager
// y un reloj controlable, y afirma el comportamiento por vuelta del riel.
//
// Ver openspec/changes/test-published-file-ci/specs/test-harness/spec.md
'use strict';

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const PUBLISHED = path.join(ROOT, 'duolingo-adhd.user.js');
const FIXTURE = path.join(__dirname, 'fixture.html');
const GOAL_SEC = 6; // objetivo del temporizador: corto, para que las vueltas pasen

// fix-reward-fx-static-and-duo-crash: las rutas que miden los efectos de
// recompensa sobre el canvas. Las dos 'calm' tienen que quedar quietas de verdad:
// una por la preferencia del sistema (el caso real del usuario) y otra por el
// override explicito 'never' (que antes no calmaba los canvas, solo el CSS).
const ROUTES = [
  { path: '/lesson/', expectLesson: true, kind: 'animated' },
  { path: '/lesson/calm-system/', expectLesson: true, kind: 'calm' },
  { path: '/lesson/calm-never/', expectLesson: true, kind: 'calm' },
  // Ruta aparte para el fin de vida real: el cambio de pathname destruye el riel,
  // asi que mezclarlo con el recorrido de vueltas no puede dar una lectura clara.
  { path: '/lesson/navonly/', expectLesson: true, kind: 'animated', navOnly: true },
  { path: '/not-a-lesson/x', expectLesson: false, kind: 'none' },
];

// ---------- browsers disponibles, en orden de preferencia ----------
function findBrowser() {
  const env = process.env.CHROME_BIN || process.env.CHROMIUM_BIN;
  if (env && fs.existsSync(env)) return env;
  const candidates = [
    'google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  ];
  for (const c of candidates) {
    if (c.includes('/')) { if (fs.existsSync(c)) return c; continue; }
    const found = require('node:child_process')
      .execSync(`command -v ${c} 2>/dev/null || true`, { encoding: 'utf8' }).trim();
    if (found) return found;
  }
  return null;
}

// ---------- servidor local ----------
// Sirve por HTTP (no file://) porque el detector de barra gatea por pathname:
// el check tiene que estar en un path de leccion de verdad.
function serve() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const path_ = url.pathname;
    const send = (file, type) => {
      res.writeHead(200, { 'content-type': type });
      res.end(fs.readFileSync(file));
    };
    // El fixture se genera con el script inyectado inline (ver buildFixture).
    // El pathname decide el nivel sembrado y si la preferencia del sistema va
    // simulada, asi que cada ruta se sirve desde su propio path.
    for (const r of ROUTES) {
      if (path_ === r.path || path_ === r.path.replace(/\/$/, '')) {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        return res.end(buildFixture(r.path));
      }
    }
    if (path_ === '/duolingo-adhd.user.js') {
      return send(PUBLISHED, 'text/javascript; charset=utf-8');
    }
    res.writeHead(404); res.end('not found');
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

// ---------- fixture ----------
// El DOM imita SOLO lo que el script usa: el boton de salir + la barra de progreso
// hermana en la misma fila. Es el contrato de deteccion del script, ver la spec
// lesson-bar-detection.
function buildFixture(pathname) {
  const published = fs.readFileSync(PUBLISHED, 'utf8');
  // Reemplazo GLOBAL: __GOAL__ aparece mas de una vez en el fixture y
  // String.replace con patron de string solo cambia la primera (la segunda queda
  // como identificador y revienta con ReferenceError en el fixture).
  // Las funciones de reemplazo evitan que $& / $1 del contenido se interpreten.
  const script = fs.readFileSync(FIXTURE, 'utf8')
    .replace(/\/\*__SCRIPT__\*\//g, () => published)
    .replace(/__PATHNAME__/g, () => pathname)
    .replace(/__GOAL__/g, () => String(GOAL_SEC));
  if (/__(GOAL|PATHNAME)__/.test(script) || script.includes('__SCRIPT__')) {
    throw new Error('el fixture quedo con un marcador sin reemplazar: revisa buildFixture()');
  }
  return script;
}

// ---------- correr el browser y leer el reporte ----------
function runBrowser(bin, url) {
  return new Promise((resolve, reject) => {
    const args = [
      '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
      // fix-reward-fx-static-and-duo-crash: el muestreo de efectos avanza un
      // frame por cada 1ms de tiempo virtual (el boton del panel agenda los tres
      // peldanios cada 1400ms), asi que el presupuesto tiene que holgar.
      '--virtual-time-budget=400000', '--dump-dom', url,
    ];
    const p = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.on('error', (e) => reject(new Error('no se pudo lanzar el browser: ' + e.message)));
    p.on('close', () => resolve(out));
  });
}

function extractReport(dom) {
  const m = dom.match(/<pre id="adhd-e2e-report">([\s\S]*?)<\/pre>/);
  if (!m) return null;
  const txt = m[1]
    .replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&').replace(/&#39;/g, "'");
  try { return JSON.parse(txt); } catch (e) { return { parseError: e.message, raw: txt.slice(0, 400) }; }
}

// ---------- aserciones ----------
function assert(results, name, cond, detail) {
  results.push({ name, pass: !!cond, detail: detail === undefined ? '' : String(detail) });
}

function checkReport(rep, results, { expectLesson, kind = 'none', navOnly = false }) {
  if (!rep || rep.parseError) {
    assert(results, 'el fixture produjo un reporte', false,
      rep ? 'JSON ilegible: ' + rep.parseError : 'no se encontro el <pre id="adhd-e2e-report">');
    return;
  }
  const errs = rep.errors || [];
  assert(results, 'el script bootea sin errores de runtime', errs.length === 0, errs.join(' | '));
  assert(results, 'el enganche de test es INERTE sin el arnés', rep.hookFired === false,
    'hookFired=' + rep.hookFired);
  assert(results, 'el entry point de ajustes existe (no depende de la barra)',
    rep.gear === true);
  assert(results, 'el estilo del script se inyecta y parsea', rep.styleRules > 0,
    'reglas=' + rep.styleRules);

  // --- audio-cues: la seccion SONIDO existe, persiste y no rompe nada.
  // Corre en TODAS las rutas (con y sin barra de leccion) porque el recordatorio
  // y los controles no dependen de la leccion.
  const snd = rep.sound || {};
  assert(results, 'la seccion SONIDO del panel tiene sus 4 controles',
    snd.present === true, JSON.stringify(snd).slice(0, 400));
  assert(results, 'los dos sonidos arrancan encendidos (defaults)',
    snd.cuesChecked === true && snd.reminderChecked === true,
    'soundCues=' + snd.cuesChecked + ' reminder=' + snd.reminderChecked);
  assert(results, 'el intervalo arranca en 60s y dentro del rango soportado',
    snd.range === '60' && snd.rangeMin === '15' && snd.rangeMax === '900',
    'range=' + snd.range + ' [' + snd.rangeMin + '..' + snd.rangeMax + ']');
  assert(results, 'el rotulo del intervalo sigue al slider',
    snd.rangeText === '1m' && snd.rangeTextAfter === '5m',
    'inicial=' + snd.rangeText + ' despues=' + snd.rangeTextAfter);
  assert(results, 'el intervalo persiste y sobrevive a reabrir el panel',
    snd.storedSeconds === 300 && snd.rangeAfterReopen === '300',
    'store=' + snd.storedSeconds + ' reabierto=' + snd.rangeAfterReopen);
  assert(results, 'el intervalo se repone en el valor original',
    snd.storedSecondsRestored === 60, 'store=' + snd.storedSecondsRestored);
  assert(results, 'el toggle del recordatorio persiste en los dos sentidos',
    snd.storedReminderOff === false && snd.storedReminderOn === true,
    'off=' + snd.storedReminderOff + ' on=' + snd.storedReminderOn);
  assert(results, 'el boton de prueba de sonido no rompe nada',
    snd.testBtnErrors === 0, 'errores=' + snd.testBtnErrors);
  assert(results, 'el panel queda cerrado para el resto de la corrida',
    snd.panelLeftOpen === false, 'abierto=' + snd.panelLeftOpen);

  // --- remind-only-when-idle: el recordatorio suena solo cuando NO estás
  // enfocado. Solo la ruta principal ejecuta el escenario (es el más lento).
  const ri = rep.reminderIdle;
  if (ri) {
    assert(results, 'el intervalo quedó en 15 s para el escenario (setup verificado)',
      ri.sliderOk === true, 'store=' + ri.storedSeconds);
    assert(results, 'interactuando con la página no suena ningún recordatorio',
      ri.whileFocused === 0, 'cues=' + ri.whileFocused);
    assert(results, 'al soltar, el recordatorio pendiente suena UNA vez',
      ri.firstWhenIdle === 1, 'cues=' + ri.firstWhenIdle);
    assert(results, 'tras sonar, el próximo cue espera el intervalo completo',
      ri.noSecondRightAfter === 0, 'cues=' + ri.noSecondRightAfter);
    assert(results, 'el segundo cue llega un intervalo después del primero',
      ri.secondAfterInterval === 1, 'cues=' + ri.secondAfterInterval);
    assert(results, 'con la pestaña oculta no suena nada',
      ri.whileHidden === 0, 'cues=' + ri.whileHidden);
    assert(results, 'volver y ponerse a trabajar pospone el recordatorio',
      ri.backToWork === 0, 'cues=' + ri.backToWork);
    assert(results, 'al volver y quedarse idle: UN cue, sin ráfaga',
      ri.idleAfterReturn === 1, 'cues=' + ri.idleAfterReturn);
  }

  if (expectLesson) {
    assert(results, 'la barra de leccion se detecta', rep.barFound === true);
    assert(results, 'el overlay se crea sobre la barra', rep.overlay === true);
    assert(results, 'se crea un segmento por tramo configurado',
      rep.segs === rep.expectedSegs, rep.segs + '/' + rep.expectedSegs);
    assert(results, 'un segmento queda activo', rep.activeSeg === 1, rep.activeSeg);
    assert(results, 'el riel aparece', rep.rail === true);
    assert(results, 'el cronometro aparece', rep.crono === true);
    // animations-panel-setting
    // animations-panel-setting: el override 'always' gana contra el
    // prefers-reduced-motion del harness. El control del panel se prueba en
    // el core contra el fuente publicado; aca se prueba el efecto real.
    assert(results, `con motionLevel '${rep.motionSeeded}' la clase motion-off es la esperada`,
      rep.motionOffClass === (kind === 'animated' ? false : true),
      'sembrado=' + rep.motionSeeded + ' clase=' + rep.motionOffClass + ' rm=' + rep.rmReduce);
    assert(results, 'la etiqueta del riel nombra un peldaño real',
      ['MADERA', 'BRONCE', 'PLATA', 'RACHA', 'DIAMANTE', 'SUPER'].includes(rep.railLabel),
      rep.railLabel);
    assert(results, 'la referencia del riel describe el descenso',
      typeof rep.railTitle === 'string' && rep.railTitle.includes('Madera'),
      rep.railTitle);
    // audio-cues: segunda pulsación del botón de prueba, con la muestra embebida
    // ya decodificada (la primera le tocó al sintetizador: el decode es async).
    if (!navOnly) assert(results, 'la muestra decodificada suena sin errores',
      rep.soundSamplePresent === true && rep.soundSampleErrors === 0,
      'present=' + rep.soundSamplePresent + ' errores=' + rep.soundSampleErrors);

    // --- el reloj de la escalera, la parte que fallo dos veces ---
    const l = navOnly ? [] : (rep.laps || []);
    const first = l[0] || {}, second = l[1] || {}, deep = l[l.length - 1] || {};
    if (!navOnly) assert(results, 'dentro de una vuelta el material del fill NO cambia',
      Array.isArray(first.materials) && first.materials.every((m) => m === first.materials[0]),
      JSON.stringify(first.materials));
    if (!navOnly) assert(results, 'dentro de una vuelta la etiqueta NO cambia',
      Array.isArray(first.labels) && first.labels.every((x) => x === first.labels[0]),
      JSON.stringify(first.labels));
    if (!navOnly) assert(results, 'la recarga baja EXACTAMENTE un peldaño',
      typeof second.label === 'string' && typeof first.label === 'string' &&
      second.label !== first.label,
      first.label + ' -> ' + second.label);
    if (!navOnly) assert(results, 'el piso es MADERA y no se agota',
      deep.label === 'MADERA' && deep.lost === false,
      'laps=' + l.length + ' label=' + deep.label);
    if (!navOnly) assert(results, 'nunca aparece un estado de derrota en ninguna vuelta',
      l.every((x) => x.label !== 'PERDIDO' && x.lost === false && !/perdido|afafaf/i.test(x.material || '')),
      JSON.stringify(l.map((x) => x.label)));
    if (!navOnly) assert(results, 'el marcador de vuelta sigue contando en el piso',
      typeof deep.lapMark === 'number' && deep.lapMark >= 6, 'lapMark=' + deep.lapMark);

    // --- fix-crono-contrast: el contador se lee en cada peldaño y en urgente ---
    // Se mide el color que el tick PINTO (estilo inline serializado a rgb por el
    // CSSOM) con su propia formula WCAG, independiente de la implementacion del
    // script. No se usa getComputedStyle: las transiciones CSS no avanzan de forma
    // determinista bajo el tiempo virtual del arnes (ver fixture.html, snap()).
    if (!navOnly) {
      const parse = (s) => {
        const m = String(s).match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
        return m ? { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] } : null;
      };
      const lum = (c) => {
        const [r, g, b] = [c.r, c.g, c.b].map((v) => v / 255)
          .map((x) => (x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4)));
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      };
      const contrast = (a, b) => {
        const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
        return (hi + 0.05) / (lo + 0.05);
      };
      const medidas = l.map((x) => ({ lap: x.lap, bg: parse(x.cronoBg), fg: parse(x.cronoFg) }));
      const completas = medidas.filter((m) => m.bg && m.fg);
      assert(results, 'el contador pinta superficie y dígito en cada vuelta muestreada',
        completas.length === l.length && l.length >= 9,
        'completas=' + completas.length + '/' + l.length);
      assert(results, 'la superficie del contador es sólida (sin transparencia)',
        completas.length > 0 && completas.every((m) => m.bg.a === 1),
        JSON.stringify(completas.filter((m) => m.bg.a !== 1).map((m) => m.lap)));
      const peor = completas.reduce((p, m) => {
        const c = contrast(m.bg, m.fg);
        return c < p.c ? { c, lap: m.lap } : p;
      }, { c: Infinity, lap: -1 });
      assert(results, 'el contador se lee (≥3:1) en cada peldaño de la escalera',
        completas.length > 0 && peor.c >= 3,
        'peor=' + peor.c.toFixed(2) + ':1 en la vuelta ' + peor.lap);
      const distintos = new Set(completas.map((m) => m.bg.r + ',' + m.bg.g + ',' + m.bg.b)).size;
      assert(results, 'el contador conserva la identidad: el fondo cambia con el peldaño',
        distintos >= 5, 'fondos distintos=' + distintos);

      const u = rep.cronoUrgent || {};
      const ub = parse(u.cronoBg), uf = parse(u.cronoFg);
      assert(results, 'en urgente el contador es rojo sólido con dígitos legibles',
        u.cronoUrgent === true && ub && uf && ub.a === 1 && contrast(ub, uf) >= 3,
        'urgente=' + u.cronoUrgent + ' bg=' + u.cronoBg + ' fg=' + u.cronoFg
          + (ub && uf ? ' ratio=' + contrast(ub, uf).toFixed(2) : ''));
    }

    // --- efectos de recompensa: movimiento real del canvas, no la clase ---
    // fix-reward-fx-static-and-duo-crash. Un burst disparado desde una tarea
    // puede recibir su primer frame con un timestamp mas viejo que el reloj (el
    // frame que lo entrega ya estaba en curso). Ese frame tiene que ser valido
    // y el efecto tiene que seguir: si un frame no se puede dibujar, la
    // excepcion no lo puede matar.
    // En la ruta navonly no se corre la fase de efectos: solo el fin de vida.
    if (!navOnly) {
    const stale = Array.isArray(rep.fxStaleFrame) ? rep.fxStaleFrame : [];
    for (const tier of ['racha', 'diamante', 'super']) {
      const s = stale.find((x) => x.name === tier) || {};
      assert(results, `el burst con frame viejo no rompe el efecto de ${tier}`,
        !s.missing && (s.newErrors || []).length === 0 && s.stillScheduled === true && s.inkAfter > 0,
        'errores=' + JSON.stringify(s.newErrors) + ' sigue=' + s.stillScheduled + ' tinta=' + s.inkAfter);
    }
    assert(results, 'el muestreo de efectos termino', rep.fxReady === true,
      'fxReady=' + rep.fxReady);
    const fx = Array.isArray(rep.fx) ? rep.fx : [];
    // El panel tiene que explicar una celebracion calmada que vino del sistema:
    // si no lo hace, el usuario ve una pared de figuras quietas y no tiene donde
    // mirar. Solo aplica con el nivel en 'system' y el sistema pidiendo calma.
    const hintEsperado = rep.motionSeeded === 'system' && rep.rmReduce === true;
    assert(results, 'el panel explica la calma que pidio el sistema',
      rep.motionSystemHint === hintEsperado,
      'nivel=' + rep.motionSeeded + ' rm=' + rep.rmReduce + ' hint=' + rep.motionSystemHint);

    // fix-reward-fx-killed-by-transient-bar-loss: un re-render de la fila de la
    // leccion (que Duolingo hace al responder) NO puede matar un efecto en vuelo.
    assert(results, 'el harness re-rendro la barra con un efecto en pantalla',
      rep.fxBarSwapOk === true, 'swap=' + rep.fxBarSwapOk);
    for (const tier of ['racha', 'diamante', 'super']) {
      const f = fx.find((x) => x.tier === tier) || {};
      const enVuelo = tier === rep.fxBarSwapTier;
      if (kind === 'animated' && enVuelo) {
        // El caso critico: el efecto que estaba en pantalla cuando la barra se
        // fue tiene que seguir dibujando, no quedar congelado en un frame.
        assert(results, `el efecto de ${tier} sigue animandose despues del re-render de la barra`,
          f.afterSwapFrames >= 3 && f.afterSwapChange >= 0.05,
          'muestras=' + f.afterSwapFrames + ' cambio=' + f.afterSwapChange);
      } else {
        assert(results, `el efecto de ${tier} sobrevive al re-render de la barra`,
          f.afterSwapFrames >= 3, 'muestras post swap=' + f.afterSwapFrames);
      }
    }
    }
    // Y el otro lado: un fin de vida real (cambio de path) tiene que seguir
    // limpiando, o la suite se podria satisfacer con "nunca destruyo nada".
    if (navOnly) {
      assert(results, 'un cambio de path limpia los canvas de efecto igual',
        rep.navBeforeCanvases >= 1 && rep.navAfterCanvases === 0,
        'antes=' + rep.navBeforeCanvases + ' despues=' + rep.navAfterCanvases + ' path=' + rep.navPath + ' btn=' + rep.navBtn + ' crono=' + rep.navCrono + ' rail=' + rep.navRail);
    }
    if (!navOnly) {
      const fx2 = Array.isArray(rep.fx) ? rep.fx : [];
      for (const tier of ['racha', 'diamante', 'super']) {
        const f = fx2.find((x) => x.tier === tier) || {};
        // "¿Se movio la figura?": fraccion de la mascara que cambio entre el
        // primer y el ultimo instante de la meseta. Un desvanecido no la cuenta y
        // un monton de sprites que se mueven en direcciones opuestas tampoco (sus
        // centroides se cancelarian).
        if (kind === 'animated') {
          assert(results, `el efecto de ${tier} se mueve cuando la animacion esta permitida`,
            f.steadyFrames >= 3 && f.shapeChange >= 0.1,
            'cambio de forma=' + f.shapeChange);
        } else {
          assert(results, `el efecto de ${tier} queda quieto cuando la animacion esta apagada`,
            f.steadyFrames >= 3 && f.shapeChange <= 0.02,
            'cambio de forma=' + f.shapeChange);
        }
      }
    }
  } else {
    assert(results, 'fuera de una leccion NO hay overlay', rep.overlay === false);
    assert(results, 'fuera de una leccion NO hay segmentos', rep.segs === 0, rep.segs);
    assert(results, 'fuera de una leccion NO hay riel', rep.rail === false);
    // animations-panel-setting: el nivel se aplica SIN barra de leccion.
    assert(results, "con motionLevel 'never' el body SI queda con motion-off, aun sin leccion",
      rep.motionOffClass === true,
      'sembrado=' + rep.motionSeeded + ' clase=' + rep.motionOffClass);
  }
}

// fix-reward-fx-static-and-duo-crash: la variante calmada tiene que SER calmada,
// no una foto fija a pantalla completa. Eso se mide contra la corrida animada:
// mucho menos tiempo en pantalla, mucha menos tinta y ningun movimiento.
function compareCalmVsAnimated(animated, calm, results, label) {
  const a = (animated && animated.fx) || [];
  const c = (calm && calm.fx) || [];
  if (!a.length || !c.length) {
    assert(results, `la variante calmada se pudo comparar (${label})`, false,
      'animada=' + a.length + ' calma=' + c.length);
    return;
  }
  for (const tier of ['racha', 'diamante', 'super']) {
    const fa = a.find((x) => x.tier === tier) || {};
    const fc = c.find((x) => x.tier === tier) || {};
    const life = fa.visibleMs > 0 ? fc.visibleMs / fa.visibleMs : Infinity;
    // Menos elementos, no menos area: con menos particulas el modulo agranda cada
    // una (la base sale de la grilla), asi que el area cubierta casi no baja.
    const comps = fa.maxComps > 0 ? fc.maxComps / fa.maxComps : Infinity;
    assert(results, `la calma de ${tier} dura mucho menos que la animacion (${label})`,
      life <= 0.4, 'visible=' + fc.visibleMs + 'ms vs ' + fa.visibleMs + 'ms (x' + life.toFixed(2) + ')');
    assert(results, `la calma de ${tier} tiene muchos menos elementos (${label})`,
      comps <= 0.5, 'elementos=' + fc.maxComps + ' vs ' + fa.maxComps + ' (x' + comps.toFixed(2) + ')');
  }
}

// ---------- main ----------
async function main() {
  const bin = findBrowser();
  if (!bin) {
    console.error('E2E: no se encontro ningun browser. Instalá Chrome/Chromium o definí CHROME_BIN.');
    process.exit(1);   // falla ruidosamente: un verde por omission es peor que un rojo
  }
  const { server, port } = await serve();
  const results = [];
  const reports = {};
  try {
    for (const r of ROUTES) {
      const dom = await runBrowser(bin, `http://127.0.0.1:${port}${r.path}`);
      const rep = extractReport(dom);
      reports[r.path] = rep;
      if (process.env.DEBUG_FX) {
        const { laps, fx, fxStaleFrame, ...rest } = rep || {};
        console.log('DEBUG', r.path, JSON.stringify(rest, null, 1));
        console.log('DEBUG fx', JSON.stringify(fx));
      }
      checkReport(rep, results, r);
    }
    compareCalmVsAnimated(reports['/lesson/'], reports['/lesson/calm-system/'], results, 'reduce del sistema');
    compareCalmVsAnimated(reports['/lesson/'], reports['/lesson/calm-never/'], results, 'nivel never');
    // (la ruta navonly no corre la fase de efectos: no entra en las comparaciones)
  } finally {
    server.close();
  }

  const failed = results.filter((r) => !r.pass);
  for (const r of results) {
    console.log(`${r.pass ? 'OK   ' : 'FAIL '} ${r.name}${r.detail ? '  [' + r.detail.slice(0, 90) + ']' : ''}`);
  }
  console.log(`\ne2e navegador: ${results.length - failed.length}/${results.length}  (${bin})`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => { console.error('E2E fallo:', e); process.exit(1); });
