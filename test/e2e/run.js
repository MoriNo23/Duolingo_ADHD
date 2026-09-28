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
    if (path_ === '/lesson/' || path_ === '/lesson') {
      // El fixture se genera con el script inyectado inline (ver buildFixture).
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(buildFixture('/lesson/'));
    }
    if (path_.startsWith('/not-a-lesson')) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(buildFixture('/not-a-lesson/x'));
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
      '--virtual-time-budget=30000', '--dump-dom', url,
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

function checkReport(rep, results, { expectLesson }) {
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
    assert(results, "con motionLevel 'always' el body NO queda con motion-off",
      rep.motionOffClass === false,
      'sembrado=' + rep.motionSeeded + ' clase=' + rep.motionOffClass);
    assert(results, 'la etiqueta del riel nombra un peldaño real',
      ['MADERA', 'BRONCE', 'PLATA', 'RACHA', 'DIAMANTE', 'SUPER'].includes(rep.railLabel),
      rep.railLabel);
    assert(results, 'la referencia del riel describe el descenso',
      typeof rep.railTitle === 'string' && rep.railTitle.includes('Madera'),
      rep.railTitle);

    // --- el reloj de la escalera, la parte que fallo dos veces ---
    const l = rep.laps || [];
    const first = l[0] || {}, second = l[1] || {}, deep = l[l.length - 1] || {};
    assert(results, 'dentro de una vuelta el material del fill NO cambia',
      Array.isArray(first.materials) && first.materials.every((m) => m === first.materials[0]),
      JSON.stringify(first.materials));
    assert(results, 'dentro de una vuelta la etiqueta NO cambia',
      Array.isArray(first.labels) && first.labels.every((x) => x === first.labels[0]),
      JSON.stringify(first.labels));
    assert(results, 'la recarga baja EXACTAMENTE un peldaño',
      typeof second.label === 'string' && typeof first.label === 'string' &&
      second.label !== first.label,
      first.label + ' -> ' + second.label);
    assert(results, 'el piso es MADERA y no se agota',
      deep.label === 'MADERA' && deep.lost === false,
      'laps=' + l.length + ' label=' + deep.label);
    assert(results, 'nunca aparece un estado de derrota en ninguna vuelta',
      l.every((x) => x.label !== 'PERDIDO' && x.lost === false && !/perdido|afafaf/i.test(x.material || '')),
      JSON.stringify(l.map((x) => x.label)));
    assert(results, 'el marcador de vuelta sigue contando en el piso',
      typeof deep.lapMark === 'number' && deep.lapMark >= 6, 'lapMark=' + deep.lapMark);
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

// ---------- main ----------
async function main() {
  const bin = findBrowser();
  if (!bin) {
    console.error('E2E: no se encontro ningun browser. Instalá Chrome/Chromium o definí CHROME_BIN.');
    process.exit(1);   // falla ruidosamente: un verde por omission es peor que un rojo
  }
  const { server, port } = await serve();
  const results = [];
  try {
    const lessonDom = await runBrowser(bin, `http://127.0.0.1:${port}/lesson/`);
    checkReport(extractReport(lessonDom), results, { expectLesson: true });

    const otherDom = await runBrowser(bin, `http://127.0.0.1:${port}/not-a-lesson/x`);
    checkReport(extractReport(otherDom), results, { expectLesson: false });
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
