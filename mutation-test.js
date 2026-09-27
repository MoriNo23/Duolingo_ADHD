// Mutation testing del núcleo del ARCHIVO PUBLICADO (duolingo-adhd.user.js)
// Aplica mutaciones al archivo fuente y corre los tests; las mutaciones
// que los tests NO detectan = gaps de cobertura.
// Correr: node mutation-test.js   (o: npm run mutate)
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const SRC = path.join(__dirname, 'duolingo-adhd.user.js');
const TEST = path.join(__dirname, 'test', 'core.test.js');
const TMP = path.join(__dirname, '.mutation-tmp.user.js');
const ORIG = fs.readFileSync(SRC, 'utf8');

// ---------- mutadores (aplican a `code`, devuelven {code, label}) ----------
function firstReplace(text, re, replacement, label) {
  const m = re.exec(text);
  if (!m) return null;
  const i = m.index;
  return { code: text.slice(0, i) + text.slice(i).replace(re, replacement), label };
}

const MUTATORS = [
  c => firstReplace(c, /segmentCount\(separators\) \{ return separators \+ 1; \}/, 'segmentCount(separators) { return separators + 1 + 1; }', 'segmentCount: +1 → +2'),
  c => firstReplace(c, /return \(i \* 100\) \/ T;/, 'return (i * 99) / T;', 'segLeft: *100 → *99'),
  c => firstReplace(c, /function segLength\(T\) \{ return 100 \/ T; \}/, 'function segLength(T) { return 99 / T; }', 'segLength: 100/T → 99/T'),
  c => firstReplace(c, /function sepPos\(i, separators\) \{ return \(i \* 100\) \/ \(separators \+ 1\); \}/, 'function sepPos(i, separators) { return (i * 99) / (separators + 1); }', 'sepPos: *100 → *99'),
  c => firstReplace(c, /if \(i === T - 1\) return null;/, 'if (i !== T - 1) return null;', 'levelColor: === → !=='),
  c => firstReplace(c, /if \(nNonLegend <= RARITY\.length\) return RARITY\[i\]\.color;/, 'if (nNonLegend < RARITY.length) return RARITY[i].color;', 'levelColor: <= → <'),
  c => firstReplace(c, /Math\.floor\(pos\)/, 'Math.ceil(pos)', 'levelColor: floor → ceil'),
  c => firstReplace(c, /Math\.max\(0, Math\.min\(len, pct - start\)\)/, 'Math.max(0, Math.min(len, pct + start))', 'segProgress: pct-start → pct+start'),
  // reachedSeparators ya no tiene mutador de >= → >: el epsilon (pct + 1e-9)
  // hace que ambos operadores den el mismo resultado SIEMPRE, asi que el
  // mutante es equivalente y ningun test podria matarlo. Sin epsilon, cualquiera.
  c => firstReplace(c, /color: '#8d6e63'/, "color: '#000000'", 'madera → negro'),
  c => firstReplace(c, /separators: 4,/, 'separators: 5,', 'DEFAULTS.separators 4 → 5'),
  c => firstReplace(c, /Math\.max\(0, Math\.min\(T, Math\.floor\(\(pct \/ 100\) \* T\)\)\)/, 'Math.max(0, Math.min(T, Math.floor((pct / 100) * T) + 1))', 'currentSeg: +1 al índice'),
  c => firstReplace(c, /const idx = Math\.floor\(pos\);/, 'const idx = Math.floor(pos) + 1;', 'levelColor: idx + 1'),
  c => firstReplace(c, /const n = parseInt\(h\.slice\(1\), 16\);/, 'const n = parseInt(h.slice(1), 10);', 'hexToRgb: base16 → base10'),
  c => firstReplace(c, /return \[\(n >> 16\) & 255, \(n >> 8\) & 255, n & 255\];/, 'return [(n >> 16) & 255, (n >> 8) & 255, (n >> 16) & 255];', 'hexToRgb: canal B roto'),
  // ---------- rail-fixed-lap-ceiling: escalera por vueltas ----------
  c => firstReplace(c, /return 'adhd-rung-' \+ RUNGS\[rungIdx\]\.id;/, "return 'adhd-rung-x' + RUNGS[rungIdx].id;", 'rungClass: prefijo roto'),
  c => firstReplace(c, /\{ id: 'racha',\s*label: 'Racha',/, "{ id: 'rachaa', label: 'Racha',", 'RUNGS: id racha roto'),
  c => firstReplace(c, /const n = Math\.max\(0, Math\.floor\(lap \|\| 0\)\);/, 'const n = Math.max(1, Math.floor(lap || 0));', 'tierForLap: lap 0 → 1'),
  c => firstReplace(c, /return RUNGS\.length - 1 - Math\.min\(n, RUNGS\.length - 1\);/, 'return RUNGS.length - 1 - n;', 'tierForLap: sin clamp (piso de madera roto)'),
  c => firstReplace(c, /return RUNGS\.length - 1 - Math\.min\(n, RUNGS\.length - 1\);/, 'return Math.max(0, RUNGS.length - n);', 'tierForLap: orden invertido'),
  c => firstReplace(c, /const lap = Math\.floor\(total\);/, 'const lap = Math.floor(total / 2);', 'ladderAt: media vuelta'),
  c => firstReplace(c, /frac: total - lap,/, 'frac: total,', 'ladderAt: frac sin normalizar por vuelta'),
  c => firstReplace(c, /return \{ lap, frac: total - lap, tier: tierForLap\(lap\) \};/, 'return { lap, frac: total - lap, tier: tierForLap(lap + 1) };', 'ladderAt: peldano de la vuelta siguiente'),
  c => firstReplace(c, /rung: L\.tier, isFast: L\.tier >= 4 \};/, 'rung: L.tier, isFast: L.tier >= 5 };', 'evaluateRace: isFast 4 → 5'),
  c => firstReplace(c, /return \{ lap: L\.lap, frac: L\.frac, tier: L\.tier, rung: L\.tier, isFast: L\.tier >= 4 \};/, 'return { lap: L.lap, frac: L.frac, tier: L.tier, rung: L.tier, isFast: L.tier >= 4, lost: L.tier < 0 };', 'evaluateRace: lost reintroducido'),
];

// ---------- correr los tests contra el SRC actual ----------
function runTests() {
  const r = spawnSync('node', ['--test', TEST], {
    cwd: __dirname,
    encoding: 'utf8',
    timeout: 30000,
  });
  return r.status === 0;
}

// ---------- main ----------
console.log('=== MUTATION TESTING duolingo-adhd ===\n');

const base = runTests();
console.log(`baseline (sin mutación): ${base ? 'PASS ✓' : 'FAIL ✗ — tests fallan en código original, arreglar antes'}`);
if (!base) process.exit(1);

let killed = 0, survived = 0, skipped = 0;
const survList = [];

for (const [i, mut] of MUTATORS.entries()) {
  const res = mut(ORIG);
  if (!res) {
    skipped++;
    console.log(`[${i + 1}] SKIP — patrón no encontrado (puede haber cambiado el código)`);
    continue;
  }
  fs.writeFileSync(TMP, res.code);
  // swap: SRC ← mutado, correr, restaurar
  fs.copyFileSync(SRC, SRC + '.bak');
  fs.copyFileSync(TMP, SRC);
  const pass = runTests();
  fs.copyFileSync(SRC + '.bak', SRC);
  fs.rmSync(SRC + '.bak', { force: true });

  if (pass) {
    survived++;
    survList.push(res.label);
    console.log(`[${i + 1}] SUPERVIVIÓ ✗ — tests NO detectaron: ${res.label}`);
  } else {
    killed++;
    console.log(`[${i + 1}] MURIO ✓ — tests mataron: ${res.label}`);
  }
}

fs.rmSync(TMP, { force: true });

console.log(`\n=== RESULTADO ===`);
console.log(`mutadores: ${MUTATORS.length} | muertas: ${killed} | supervivientes: ${survived} | skip: ${skipped}`);
console.log(`mutation score: ${(killed / Math.max(1, MUTATORS.length - skipped) * 100).toFixed(0)}%`);
if (survList.length) {
  console.log('\nGAPS — mutaciones que los tests no matan (agregar tests):');
  survList.forEach(s => console.log(`  - ${s}`));
}
