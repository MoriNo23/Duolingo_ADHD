---
change: ci-only-verification
version: 2.19.0
fecha: 2026-10-06
resultado: skip
fallas: 0
---

# QA de campo — ci-only-verification (2.19.0)

**Salto general.** Motivo: change de infraestructura (workflow de CI, scripts de
`package.json`, `openspec/config.yaml`, README) sin ningún comportamiento
observable en duolingo.com; el script publicado no cambia por este change. Salto
autorizado explícitamente por el mantenedor.

## Verificación sustitutiva (CI del PR #1)

Run 37562575409, en verde a la primera, 39 s, sin paso `vendor diff`:

- `core tests`: 163/163.
- `mutation`: 35/35 muertos, 0 skips, score 100 %.
- `browser (e2e)`: 213/213, 0 FAIL.

## Preguntas

Sin preguntas propias: no hay escenario de este change que se pueda observar en
el sitio real. El smoke fijo no se corrió porque el script publicado no se tocó
por este change.
