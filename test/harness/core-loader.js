// Carga el USUARIO ARCHIVO PUBLICADO como sujeto de test.
//
// No hay copia "dev": lo que se testea es duolingo-adhd.user.js, el mismo archivo
// que se instala. El script expone su núcleo puro por un enganche inerte
// (globalThis.__ADHD_TEST__), que se define ANTES de evaluar el archivo y se
// limpia después. En un userscript manager ese global nunca existe, así que la
// rama no corre y el archivo se comporta igual que sin el enganche.
//
// El guard browser-only del script (`typeof window !== 'undefined'`) se salta a
// propósito: acá no hay DOM, y el núcleo puro es justamente la parte que no lo
// necesita. Lo que sí necesita DOM se prueba en el check de navegador
// (test/e2e), que inyecta este mismo archivo entero.
//
// Ver openspec/changes/test-published-file-ci/design.md (decisiones 1 y 2).
'use strict';

const fs = require('fs');
const path = require('path');

const PUBLISHED = path.join(__dirname, '..', '..', 'duolingo-adhd.user.js');
const META = /^\/\/ ==UserScript==[\s\S]*?\/\/ ==\/UserScript==\n/m;

/**
 * Almacenamiento con forma de userscript manager.
 *
 * El archivo publicado usa GM_getValue/GM_setValue y SOLO eso: la rama de test
 * que el antiguo archivo dev tenía (`global.__adhd_test_store`) nunca existió en
 * el archivo que se instala, así que los tests de storage la ejercitaban sin que
 * ese código le importara a nadie. Con estos stubs los tests pasan por el mismo
 * camino que el usuario real.
 */
const gmStore = new Map();
globalThis.GM_getValue = (k, d) => (gmStore.has(k) ? gmStore.get(k) : d);
globalThis.GM_setValue = (k, v) => { gmStore.set(k, v); };
globalThis.GM_deleteValue = (k) => { gmStore.delete(k); };

function resetGmStore() { gmStore.clear(); }

/** El código del archivo publicado, sin el bloque de metadata. */
function publishedSource() {
  return fs.readFileSync(PUBLISHED, 'utf8').replace(META, '');
}

/** Ruta al archivo publicado (por si un test necesita leerlo crudo). */
function publishedPath() {
  return PUBLISHED;
}

/**
 * Evalúa el archivo publicado en Node y devuelve su núcleo puro.
 * Lanza si el enganche no se dispara: significaría que el archivo publicado
 * cambió y el arnés quedó viejo, que es exactamente el bug que este arnés existe
 * para evitar.
 */
function loadCore() {
  let core = null;
  globalThis.__ADHD_TEST__ = (c) => { core = c; };
  try {
    // window/document indefinidos -> el IIFE browser-only no se ejecuta.
    new Function('window', 'document', publishedSource())(undefined, undefined);
  } finally {
    delete globalThis.__ADHD_TEST__;
  }
  if (!core) {
    throw new Error('el archivo publicado no entregó su núcleo por __ADHD_TEST__: ' +
                    'revisá que el enganche siga en duolingo-adhd.user.js');
  }
  return core;
}

module.exports = { loadCore, publishedSource, publishedPath, gmStore, resetGmStore };
