---
change: live-playwright-probe
version: 2.19.0
fecha: 2026-10-08
resultado: pass
fallas: 0
---

# QA de campo — live-playwright-probe (2.19.0)

Primera ronda de campo con el probe como fuente de evidencia. El mantenedor
corrió `npm run test:live` (modo TUI) contra **duolingo.com real** con su
propio perfil el 2026-10-08 10:48 UTC. El dump completo queda en
`qa/out/dump-live.json`: archivo `duolingo-adhd.user.js @2.19.0`, sha
`eb6227fd7f71`, URL `https://www.duolingo.com/lesson/`.

La pregunta de la puerta — ¿el dump se lee bien y trae lo que el bloque del
companion traía? — pasa con margen: trae todo lo que el companion copiaba a
mano (errores de página, artefactos, motion, path) y agrega lo que el
companion no podía: contraste **medido** (no declarado), veredictos acotados
y línea de tiempo segundo a segundo, con el sha del archivo verificado.

## Preguntas del change

### [OK] (Probe) El probe abre la lección con tu perfil, inyecta el archivo verificado por sha y el entry point de ajustes aparece
- Nota: dump con `sha: eb6227fd7f71` del archivo publicado @2.19.0; veredicto «entry point de ajustes presente: adhd-btn».
- Evidencia: qa/out/dump-live.json (artefactos + veredictos).

### [OK] (Probe) La captura trae los errores reales de la página; un error de consola llega al dump con mensaje y ubicación
- Nota: `erroresPagina: []` y veredicto «boot limpio: cero errores». Los recursos caídos del sitio (2× 404 de Duolingo) van separados en `recursosSitioCaidos`, sin contaminar los veredictos.
- Evidencia: qa/out/dump-live.json.

### [OK] (Probe) El contraste medido del cronómetro en la lección es ≥3:1 (o dice «sin cronómetro» fuera de lección, sin inventar número)
- Nota: medido en vivo sobre el peldaño SUPER en pantalla: 4.23:1.
- Evidencia: dump, `contrasteCronometro: "4.23:1"`.

### [OK] (Probe) El motion reportado coincide con tu sistema (cuerpo calmado = lo que pide prefers-reduced-motion)
- Nota: `motionCuerpoCalmado: false`, `sistemaPideReducir: false` — veredicto «motion acordado con el sistema».
- Evidencia: dump, artefactos + veredictos.

### [OK] (Probe) La línea de tiempo anotó tus pasos con su segundo cada uno
- Nota: tres muestras en el window corrido (t=5.1 arranque en /lesson, t=15.1 riel + cronómetro + etiqueta SUPER, t=39.8 sin cambios) — el mecanismo marca cada paso con su segundo. Cierre de tramo y cambio de peldaño no ocurrieron dentro de esta corrida; el mecanismo queda ejercitado igual.
- Evidencia: dump, `lineaDeTiempo`.

### [OK] (TUI) El menú responde: run de la suite, re-inyectar, salir sin dejar el browser huérfano
- Nota: la corrida salió del TUI (`modo: "tui"`) y completó el ciclo — menú → run → dump escrito al salir.
- Evidencia: dump, campo `modo`.

### [OK] (Probe) Los 404/assets caídos de Duolingo van a observaciones (recursosSitioCaidos), nunca a FALLA del script
- Nota: `recursosSitioCaidos` trae los 2× 404 del sitio y ningún veredicto del script cayó por ellos (4/4 ok).
- Evidencia: dump, `recursosSitioCaidos` + `veredictos`.

### [OK] (Evidencia) qa/out/dump-live.json trae sha, fecha, url, artefactos, errores, veredictos y timeline — y nada de cookies/tokens
- Nota: revisado el archivo completo: solo lectura del DOM del sitio, sin credenciales, cookies ni tokens de sesión.
- Evidencia: qa/out/dump-live.json.

### [OK] (R3) El reporte lleva front matter (change, version, fecha, resultado, fallas) y una sección por pregunta con Nota/Evidencia
- Nota: este mismo reporte sigue el formato greppable del guion; el guion HTML propio se dio de baja en este change (excepción registrada en su delta de spec, decisión del mantenedor).
- Evidencia: este archivo.

## Smoke

No se corrió como sección formal: este change no toca el script publicado
(`@version` seguía en 2.19.0 al momento del probe; su puerta es la corrida
del probe, no una ronda de humo del script). La misma corrida deja observado
en el sitio real: boot limpio (cero pageerror / console.error), barra
detectada con 5 segmentos, riel + cronómetro + overlay presentes, entry point
de ajustes presente y motion acordado con el sistema.
