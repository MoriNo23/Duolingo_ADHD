// Probe vivo: corre el ARCHIVO PUBLICADO contra el duolingo.com REAL.
//
// Local-only, nunca CI: necesita la sesion logueada del mantenedor y red
// real, y el workflow solo permite loopback. Misma categoria que
// test:vendor: se corre a mano antes de pushear, nunca como paso del workflow.
// Correr: npm run test:live [-- --url=... --headed]
//
// Ver openspec/changes/live-playwright-probe/{proposal,design}.md
'use strict';

const { createHash } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..', '..');
const PUBLISHED = path.join(ROOT, 'duolingo-adhd.user.js');

const DEFAULT_PROFILE = path.join(os.homedir(), '.config', 'duolingo-adhd-live');
const DEFAULT_BIN = '/usr/bin/chromium';
const DEFAULT_URL = 'https://www.duolingo.com/learn';

function arg(name, def) {
  const m = process.argv.find((a) => a === name || a.startsWith(name + '='));
  if (!m) return def;
  if (m === name) return true;
  return m.slice(name.length + 1);
}

if (arg('--help', false)) {
  console.log([
    'uso: npm run test:live [-- --url=<leccion> --headed --profile=<dir> --out=<txt>]',
    '',
    '  --url       pagina a probar (default: /learn; para barra real pasar una leccion)',
    '  --headed    muestra el browser (default: headless nuevo)',
    '  --attended  modo atendido: abre la leccion, vos la haces, el probe anota',
    '              tus pasos (implica --headed; termina con Enter en esta terminal)',
    '  --tui       consola de control: abre el browser y te deja empezar la leccion;',
    '              cuando decis que esta optimo, elegis "run suite" y corre la bateria',
    '              completa (implica --headed; tambien muestrea tus pasos)',
    '  --profile   perfil persistente (env ADHD_LIVE_PROFILE, default ~/.config/duolingo-adhd-live)',
    '  --out       archivo del dump (default: qa/out/dump-live.json)',
    '',
    '  sesion: el probe NO te loguea. Primera vez: npm run test:live -- --tui',
    '  (o --headed), logueate a mano en la ventana que abre, sali con q.',
    '  La sesion queda en el perfil y las corridas siguientes la conservan.',
    '  No instales Tampermonkey en ese perfil: Playwright desactiva extensiones',
    '  por defecto y el probe inyecta el archivo solo, no lo necesita.',
    '',
    'Local-only: falla cerrado sin perfil o bajo CI. Nunca es gate.',
  ].join('\n'));
  process.exit(0);
}

// Nunca en CI: sin sesion real los veredictos no significan nada.
if (process.env.CI || process.env.GITHUB_ACTIONS) {
  console.error('test:live es local-only (necesita tu sesion real): rehúsa correr bajo CI.');
  process.exit(2);
}

const profileDir = process.env.ADHD_LIVE_PROFILE || arg('--profile', DEFAULT_PROFILE);
if (!fs.existsSync(profileDir)) {
  console.error('sin perfil persistente no hay sesion real que probar.');
  console.error(`crealo abriendo chromium una vez con --user-data-dir=${profileDir},`);
  console.error('logueate en Duolingo, cerralo, y volve a correr.');
  console.error(`(o apunta ADHD_LIVE_PROFILE a tu perfil existente)`);
  process.exit(2);
}

const bin = process.env.ADHD_CHROMIUM_BIN || DEFAULT_BIN;
if (!fs.existsSync(bin)) {
  console.error(`no hay chromium en ${bin} (env ADHD_CHROMIUM_BIN para otro path).`);
  console.error('Sin browser no hay probe: falla ruidoso, nunca en verde por omision.');
  process.exit(2);
}

// El archivo publicado, entero, como sale del repo (la metadata es comentario).
// Se lee en una funcion porque la TUI lo re-lee en cada re-inyeccion: editar
// el userscript y re-inyectar sin reiniciar el browser es el loop de trabajo.
function cargarArchivo() {
  const published = fs.readFileSync(PUBLISHED, 'utf8');
  const hash = createHash('sha256').update(published).digest('hex').slice(0, 12);
  const verMatch = published.match(/^\/\/ @version\s+(\S+)/m);
  return { published, hash, version: verMatch ? verMatch[1] : 'desconocida' };
}
let { published, hash, version } = cargarArchivo();

// Stubs de la API de manager, ANTES que el archivo: mismo contrato que el
// harness de Node (test/harness/core-loader.js), memoria en vez de disco.
// GM_xmlhttpRequest tira a proposito: si el script lo llama en vivo, eso es
// un hallazgo, no algo para emular en silencio.
// Es funcion y no constante porque la TUI re-inyecta tras editar el archivo:
// si el @version cambio, el stub tiene que llevar el nuevo.
function stubsPara(ver) {
  return `
'use strict';
(function () {
  const store = new Map();
  window.GM_getValue = (k, d) => (store.has(k) ? store.get(k) : d);
  window.GM_setValue = (k, v) => { store.set(k, v); };
  window.GM_deleteValue = (k) => { store.delete(k); };
  window.GM_addStyle = (css) => {
    const el = document.createElement('style');
    el.textContent = css;
    // El init script corre a document_start: head/documentElement todavia
    // pueden ser null (en Tampermonkey el script corre a document-idle y esto
    // nunca pasa). Si no hay donde colgarlo, se reintenta en DOMContentLoaded.
    const put = () => {
      const t = document.head || document.documentElement;
      if (t) { t.appendChild(el); return true; }
      return false;
    };
    if (!put()) document.addEventListener('DOMContentLoaded', put, { once: true });
    return el;
  };
  window.GM_info = { script: { version: ${JSON.stringify(ver)} } };
  // GM_xmlhttpRequest con fetch: el unico uso real del script es bajar la
  // fuente Baloo 2 de Google Fonts (css + woff2, ambos con CORS abierto), asi
  // que un GET por fetch es fiel. Cualquier otro metodo o un fallo de red
  // cae en onerror, como haria el manager. El header User-Agent custom que
  // pide el script lo ignora el navegador (header prohibido en fetch): Google
  // sirve igual el css y el parse busca el bloque latin como siempre; si no
  // matchea, el script cae al font del sistema sin romper nada.
  window.GM_xmlhttpRequest = (det) => {
    det = det || {};
    const ctrl = new AbortController();
    const done = { abort() { ctrl.abort(); } };
    try {
      if ((det.method || 'GET').toUpperCase() !== 'GET') throw new Error('stub del probe: solo GET');
      let timer = 0;
      if (det.timeout) timer = setTimeout(() => ctrl.abort(), det.timeout);
      fetch(det.url, { signal: ctrl.signal }).then(async (r) => {
        if (timer) clearTimeout(timer);
        if (det.responseType === 'arraybuffer') {
          const buf = await r.arrayBuffer();
          if (det.onload) det.onload({ status: r.status, response: buf, responseText: '', readyState: 4 });
        } else {
          const text = await r.text();
          if (det.onload) det.onload({ status: r.status, responseText: text, response: text, readyState: 4 });
        }
      }).catch((e) => { if (timer) clearTimeout(timer); if (det.onerror) det.onerror(e); });
    } catch (e) { if (det.onerror) det.onerror(e); }
    return done;
  };
})();
`;
}
const stubs = stubsPara(version);

// Una lectura del estado observable. Liviana a proposito: corre cada 5 s en
// modo atendido, asi que no puede costar mas que unos ms por pasada.
async function leerEstado(page) {
  return page.evaluate(() => {
    const q = (s) => document.querySelector(s);
    const crono = q('.adhd-mini-crono');
    let contraste = null;
    if (crono) {
      const est = getComputedStyle(crono);
      const aHex = (c) => {
        const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(c || '');
        if (!m) return null;
        return '#' + [1, 2, 3].map((i) => Number(m[i]).toString(16).padStart(2, '0')).join('');
      };
      const lum = (h) => {
        if (!h) return null;
        const v = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
          .map((c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
        return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
      };
      const a = lum(aHex(est.color)), b = lum(aHex(est.backgroundColor));
      if (a !== null && b !== null) {
        contraste = +((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)).toFixed(2);
      }
    }
    let sistema = null;
    try {
      sistema = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    } catch (e) { /* desconocido */ }
    const etiqueta = q('.adhd-rail-label');
    return {
      url: location.href,
      path: location.pathname,
      overlay: !!q('.adhd-overlay'),
      segmentos: document.querySelectorAll('.adhd-seg').length,
      riel: !!q('.adhd-decay-timeline'),
      etiqueta: etiqueta ? (etiqueta.textContent || '').trim().slice(0, 80) : null,
      crono: !!crono,
      contraste,
      panel: !!q('.adhd-btn'),
      motionCalmado: !!(document.body && document.body.classList.contains('adhd-motion-off')),
      sistemaPideReducir: sistema,
    };
  });
}

// Modo atendido: el browser queda abierto y el mantenedor hace la leccion.
// El probe muestrea cada 5 s y anota SOLO lo que cambio (un cierre de tramo,
// un cambio de peldano, la aparicion de una UI de recompensa): eso es la
// linea de tiempo de pasos. Termina con Enter en esta terminal.
async function modoAtendido(page, errors) {
  const readline = require('node:readline');
  const timeline = [];
  const firma = (o) => JSON.stringify([
    o.path, o.overlay, o.segmentos, o.riel, o.etiqueta, o.crono, o.motionCalmado,
  ]);
  let ultima = null;
  let seguir = true;

  console.log('modo atendido: hace la leccion en el browser.');
  console.log('el probe anota cada cambio que ve. Enter aca para terminar y generar el dump.');

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const fin = new Promise((res) => rl.question('Enter para terminar > ', () => {
    rl.close();
    seguir = false;
    res();
  }));

  const t0 = Date.now();
  while (seguir) {
    const o = await leerEstado(page).catch(() => null);
    if (o) {
      const f = firma(o);
      if (f !== ultima) {
        ultima = f;
        const paso = { t: +((Date.now() - t0) / 1000).toFixed(1), ...o };
        delete paso.url;
        timeline.push(paso);
        console.log(`  +${paso.t}s path=${o.path} segs=${o.segmentos} riel=${o.riel ? 'si' : 'no'} etiqueta=${o.etiqueta || '—'} errores=${errors.length}`);
      }
    }
    await Promise.race([fin, new Promise((r) => setTimeout(r, 5000))]);
  }
  await fin;
  return { obs: await leerEstado(page), timeline };
}

(async () => {
  const headedArg = !!arg('--headed', false);
  const attended = !!arg('--attended', false);
  const tui = !!arg('--tui', false);
  if (attended && tui) {
    console.error('--attended y --tui son excluyentes: uno corre solo, el otro con menu.');
    process.exit(2);
  }
  // Atendido y TUI implican visible: el mantenedor tiene que ver y clickear.
  // Headless no recibe input humano, asi que no se permite combinarlos.
  const headed = headedArg || attended || tui;
  const url = arg('--url', DEFAULT_URL);

  // Flags livianos (ver design D2 + notas):
  // - Playwright por defecto DESACTIVA el throttling de background y MUTEA el
  //   audio (--disable-background-timer-throttling, --disable-backgrounding-
  //   occluded-windows, --disable-renderer-backgrounding). Eso falsearia justo
  //   lo que este probe existe para observar (recordatorio en background,
  //   cues audibles), asi que se quitan de los defaults: queremos el browser
  //   REAL, no uno domesticado.
  // - --disable-gpu: sin GPU el canvas 2D corre por software igual; ahorra el
  //   proceso de GPU en una maquina chica. No cambia lo que se mide.
  // - JAMAS: --single-process (inestable), --mute-audio (ciega los cues),
  //   --autoplay-policy=no-user-gesture (falsea el desbloqueo de audio),
  //   flags de background/throttling (falsean el recordatorio).
  // - Video, tracing y HAR: apagados por defecto en Playwright; NO activarlos
  //   es la decision de RAM/disco. Una sola pestana, viewport chico, dpr 1.
  const context = await chromium.launchPersistentContext(profileDir, {
    executablePath: bin,
    headless: !headed,
    ignoreDefaultArgs: [
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--mute-audio',
    ],
    args: ['--disable-gpu'],
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
    acceptDownloads: false,
  });

  // Boot limpio mira SOLO errores atribuibles al script. Los 404 de recursos
  // del sitio (assets/favicon de Duolingo que no cargan) son ruido ajeno:
  // van a observaciones, nunca al veredicto. Primera lección de la corrida
  // viva: el veredicto ingenuo dio FALLA por dos 404 que no eran nuestros.
  const errors = [];
  const recursos = [];
  context.on('pageerror', (e) => errors.push('pageerror: ' + (e && e.message)));
  context.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    if (/^Failed to load resource/i.test(t)) recursos.push(t.slice(0, 200));
    else errors.push('console.error: ' + t.slice(0, 300));
  });

  // El archivo entero, verificado antes de inyectar (doctrina test-harness:
  // entero, nunca regiones). Se inyecta DESPUES de cargar la pagina via
  // page.evaluate, no con addInitScript: el init script corre a document_start
  // y el archivo publicado no tolera eso — hace GM_addStyle y applyTheme()
  // (document.body) a nivel de modulo, lo cual revienta con body null y, peor,
  // el error es SILENCIOSO en ese canal (no llega a pageerror). Evaluar con el
  // DOM ya cargado reproduce el @run-at document-idle de Tampermonkey, que es
  // el timing real del script instalado. Bonus: si tira, evaluate rechaza con
  // el error real en vez de callarse.
  const inyeccion = stubs + '\n' + published;

  const page = context.pages()[0] || await context.newPage();
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  // Si pediste /learn o una leccion y caiste en la landing (/), no hay sesion
  // valida en el perfil: el probe no te loguea solo. Ver el flujo en --help.
  const llegada = (() => { try { return new URL(page.url()).pathname; } catch (e) { return ''; } })();
  const pediaSesion = /learn|lesson|practice/.test(url);
  const sinSesion = pediaSesion && llegada === '/';
  let bootError = null;
  try {
    await page.evaluate(inyeccion);
  } catch (e) {
    bootError = 'inyeccion: ' + (e && e.message);
  }
  if (bootError) errors.push(bootError);
  let boot = false;
  try {
    await page.waitForFunction(
      () => !!document.querySelector('.adhd-btn'), null, { timeout: 20000 });
    boot = true;
  } catch (e) { boot = false; }
  // Asentar: el riel y el crono necesitan unos segundos de pagina viva.
  await page.waitForTimeout(8000);

  const obs = await leerEstado(page);

  // En atendido el boot ya se verifico arriba (.adhd-btn); el muestreo y la
  // lectura final salen del loop del mantenedor.
  let timeline = null;
  let final = obs;
  if (attended) {
    const r = await modoAtendido(page, errors);
    final = r.obs;
    timeline = r.timeline;
  }
  if (tui) {
    if (!process.stdin.isTTY) {
      console.error('--tui necesita una terminal interactiva (stdin no es TTY).');
      await context.close();
      process.exit(2);
    }
    await modoTui(context, page, errors, recursos);
    return; // modoTui cierra el contexto al salir
  }

  // Veredictos SOLO sobre invariantes estables (D4). Lo estructural es
  // observacion con contexto, nunca conclusion.
  const verdicts = calcularVeredictos(final, errors);
  const fallan = verdicts.filter((v) => !v.ok);

  const outPath = arg('--out', path.join(ROOT, 'qa', 'out', 'dump-live.json'));
  escribirDump({ outPath, modo: attended ? 'attended' : 'auto', final, verdicts, errors, recursos, timeline });
  resumen(final, verdicts, errors, outPath, { sinSesion, recursos });

  await context.close();
  process.exit(fallan.length ? 1 : 0);
})().catch((e) => {
  const msg = String((e && e.message) || e);
  // El perfil es de un solo dueño: si hay otra ventana con el mismo perfil
  // (una corrida anterior sin cerrar, o el chromium que abriste a mano), el
  // lanzamiento falla. No se roba el lock: se pide cerrar la otra ventana.
  if (/already in use|existing browser session/i.test(msg)) {
    console.error('el perfil ya esta en uso por otro Chromium.');
    console.error('Cerra la otra ventana (o la corrida anterior) y volve a correr.');
    process.exit(2);
  }
  console.error('el probe fallo antes de medir: ' + msg.split('\n')[0]);
  process.exit(2);
});

// --- piezas compartidas por los tres modos (auto / attended / tui) ---

function calcularVeredictos(final, errors) {
  return [
    { nombre: 'boot limpio (sin pageerror ni console.error)', ok: errors.length === 0, detalle: errors.length ? errors.join(' | ').slice(0, 500) : 'cero errores' },
    { nombre: 'entry point de ajustes presente', ok: final.panel, detalle: final.panel ? 'adhd-btn presente' : 'adhd-btn ausente' },
    {
      nombre: 'contraste del cronometro >= 3:1', ok: final.crono ? (final.contraste !== null && final.contraste >= 3) : true,
      detalle: !final.crono ? 'sin cronometro en pantalla (no aplica)' : (final.contraste + ':1'),
    },
    {
      nombre: 'motion acordado con el sistema', ok: final.sistemaPideReducir === null || final.motionCalmado === final.sistemaPideReducir,
      detalle: `cuerpo calmado=${final.motionCalmado}, sistema pide reducir=${final.sistemaPideReducir}`,
    },
  ];
}

function escribirDump({ outPath, modo, final, verdicts, errors, recursos, timeline }) {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const dump = {
    herramienta: 'live-probe (lectura del sitio real, no gate)',
    modo,
    archivo: `duolingo-adhd.user.js @${version}`,
    sha: hash,
    fecha: new Date().toISOString(),
    url: final.url,
    artefactos: {
      overlay: final.overlay ? 'presente' : 'ausente',
      segmentos: final.segmentos,
      riel: final.riel ? 'presente' : 'ausente',
      cronometro: final.crono ? 'presente' : 'ausente',
      contrasteCronometro: final.contraste === null ? 'no medible' : `${final.contraste}:1`,
      motionCuerpoCalmado: final.motionCalmado,
      sistemaPideReducir: final.sistemaPideReducir,
    },
    erroresPagina: errors,
    recursosSitioCaidos: recursos,
    veredictos: verdicts.map((v) => ({ nombre: v.nombre, ok: v.ok, detalle: v.detalle })),
    ...(timeline ? { lineaDeTiempo: timeline } : {}),
    nota: 'esto es una lectura del sitio de hoy, no una verificación',
  };
  fs.writeFileSync(outPath, JSON.stringify(dump, null, 2) + '\n');
  return outPath;
}

function resumen(final, verdicts, errors, outPath, extra) {
  const recursos = (extra && extra.recursos) || [];
  // Consola: resumen de 6 lineas, nada mas. El dump completo vive en el JSON.
  console.log(`live-probe @${version} (sha ${hash}) — ${final.path}`);
  for (const v of verdicts) console.log(`  [${v.ok ? 'OK' : 'FALLA'}] ${v.nombre} — ${v.detalle}`);
  console.log(`  errores de pagina: ${errors.length} | recursos del sitio caidos: ${recursos.length}`);
  if (extra && extra.sinSesion) {
    console.log('  AVISO: pediste una pagina con sesion y caiste en la landing (/).');
    console.log('  La sesion del perfil no es valida: logueate a mano con --tui/--headed y sali con q.');
  }
  console.log(`dump: ${outPath}`);
}

// Consola de control: el browser queda abierto con la leccion, el probe
// muestrea tus pasos en segundo plano, y VOS decidis cuando correr la bateria
// completa ("run suite") — por ejemplo despues de cerrar un ejercicio, cuando
// aparece la UI que queres verificar. Repetible sin reiniciar nada.
async function modoTui(context, page, errors, recursos) {
  const readline = require('node:readline');
  const outPath = arg('--out', path.join(ROOT, 'qa', 'out', 'dump-live.json'));
  const timeline = [];
  const firma = (o) => JSON.stringify([
    o.path, o.overlay, o.segmentos, o.riel, o.etiqueta, o.crono, o.motionCalmado,
  ]);
  let ultima = null;
  const t0 = Date.now();

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  // El muestreo escribe mientras el prompt espera input: sin repintar, la
  // linea que estas tipeando queda rota y parece que "no pregunta". Cada
  // salida pasa por aca: limpia la linea, imprime, y restaura prompt + lo
  // que ya habias tipeado (readline conserva el buffer).
  function decir(linea) {
    readline.clearLine(process.stdout, 0);
    readline.cursorTo(process.stdout, 0);
    console.log(linea);
    rl.prompt(true);
  }

  async function muestrear(origen) {
    const o = await leerEstado(page).catch(() => null);
    if (!o) return null;
    const f = firma(o);
    if (f !== ultima || origen === 'suite') {
      ultima = f;
      const paso = { t: +((Date.now() - t0) / 1000).toFixed(1), ...o };
      delete paso.url;
      timeline.push(paso);
      if (origen === 'muestreo') {
        decir(`  +${paso.t}s path=${o.path} segs=${o.segmentos} riel=${o.riel ? 'si' : 'no'} etiqueta=${o.etiqueta || '—'} errores=${errors.length}`);
      }
    }
    return o;
  }

  // Muestreo de fondo cada 5 s mientras el menu espera.
  const intervalo = setInterval(() => { muestrear('muestreo').catch(() => {}); }, 5000);

  console.log('TUI live-probe: el browser esta abierto con la leccion.');
  console.log('Empeza la leccion; cuando este optimo para medir, elegi run suite.');
  console.log('');
  console.log('  [1] run suite   correr la bateria completa ahora (repetible)');
  console.log('  [2] re-inyectar releer duolingo-adhd.user.js del disco e inyectarlo de nuevo');
  console.log('  [q] salir       cerrar el browser');

  let ocupado = false;
  let adios = null;
  const fin = new Promise((res) => { adios = res; });

  async function correrSuite() {
    if (ocupado) { decir('  suite ya en curso — espera que termine'); return; }
    ocupado = true;
    try {
      const final = await muestrear('suite');
      if (!final) { decir('  no se pudo leer la pagina (¿se cerro?).'); return; }
      const verdicts = calcularVeredictos(final, errors);
      escribirDump({ outPath, modo: 'tui', final, verdicts, errors, recursos, timeline });
      // resumen() imprime directo: despues se restaura el prompt una vez.
      resumen(final, verdicts, errors, outPath, { recursos });
      const fallan = verdicts.filter((v) => !v.ok).length;
      console.log(fallan ? `  suite con ${fallan} FALLA(s) — ver dump` : '  suite verde');
    } finally {
      ocupado = false;
      rl.prompt(true);
    }
  }

  async function reinyectar() {
    try {
      const antes = hash;
      ({ published, hash, version } = cargarArchivo());
      await page.evaluate(stubsPara(version) + '\n' + published);
      decir(`  re-inyectado @${version} (sha ${hash}${hash === antes ? ', sin cambios' : ''})`);
    } catch (e) {
      decir('  re-inyeccion fallo: ' + (e && e.message));
    }
  }

  async function salir() {
    clearInterval(intervalo);
    rl.close();
    await context.close().catch(() => {});
    adios();
  }

  rl.setPrompt('> ');
  rl.on('line', (crudo) => {
    const op = (crudo || '').trim();
    if (op === '1') correrSuite().catch((e) => decir('  suite fallo: ' + (e && e.message)));
    else if (op === '2') reinyectar().catch((e) => decir('  re-inyeccion fallo: ' + (e && e.message)));
    else if (op === 'q') salir().catch(() => process.exit(0));
    else rl.prompt(true);
  });
  rl.prompt(true);
  process.on('SIGINT', () => { salir().catch(() => process.exit(0)).then(() => process.exit(0)); });
  await fin;
}
