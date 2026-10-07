---
change: add-field-qa-loop
version: 2.19.0
fecha: 2026-10-06
resultado: skip
fallas: 0
---

# QA de campo — add-field-qa-loop (2.19.0)

**Salto general.** Motivo: ronda informal ordenada por el usuario para avanzar
al change siguiente (`fix-crono-contrast`, ver S3) — el guion completo no se
corrió en esta oportunidad. Lo que sí se probó queda registrado abajo.

## Evidencia de la ronda (companion en el sitio real)

Dos diagnósticos copiados con el companion desde duolingo.com, pegados por el
usuario (2026-10-06 ~21:20 local):

**/learn** (fuera de lección — artefactos ausentes es lo esperado):

```
path: /learn
motion: animado
overlay: ausente · segmentos: 0 · riel: ausente · tab de ajustes: presente
errores (0)
```

**/lesson** (lección real):

```
path: /lesson
motion: animado
overlay: presente · segmentos: 5 · riel: presente · tab de ajustes: presente
errores (0)
```

## Preguntas del change

### [SALTO] (R1) El guion abre en el navegador, autoguarda y el botón Descargar baja el reporte
- Nota: no se corrió en esta ronda informal.
- Evidencia: —

### [SALTO] (R2) Companion: botón QA + «Copiar diagnóstico» suelta el bloque (errores, artefactos, motion)
- Nota: probado informalmente — los dos bloques pegados arriba salieron del companion en el sitio real.
- Evidencia: diagnósticos de /learn y /lesson (arriba).

### [SALTO] (R2) El companion no hace peticiones de red
- Nota: no verificado en esta ronda (verificado por arnés: tests core + e2e sin red).
- Evidencia: —

### [SALTO] (Revert) El script publicado quedó igual que 2.19.0
- Nota: sin revisión visual del panel en esta ronda; el revert está verificado por arnés (core: 11 marcadores en 0).
- Evidencia: —

### [SALTO] (R3) El reporte exportado lleva front matter y una sección por pregunta
- Nota: este reporte lo escribió el agente citando la ronda informal (salto con motivo); el export del guion no se probó.
- Evidencia: —

## Smoke

### [OK] S1. El script bootea sin errores en /learn (consola limpia)
- Nota: el companion capturó 0 errores en ambas pantallas.
- Evidencia: diagnóstico del companion, /learn y /lesson.

### [OK] S2. La barra de lección se detecta en /learn* (aparecen segmentos)
- Nota: probado en /lesson — segmentos: 5, overlay y riel presentes. (*el ítem nombra /learn pero la verificación real fue dentro de una lección, donde corresponde.)
- Evidencia: diagnóstico del companion, /lesson.

### [SALTO] S3. Riel, cronómetro y overlay se ven bien sobre la barra real
- Nota: riel y overlay presentes y sin errores de runtime, pero **el cronómetro tiene un problema de contraste reportado por el usuario en esta misma ronda**: los colores del contador hacen el texto casi ilegible. Fuera del alcance de este change (el cronómetro es anterior), así que se marca SALTO y se enruta: nace el change `fix-crono-contrast`, cuyo proposal cita este reporte (spec field-qa, requisito 4).
- Evidencia: reporte verbal del usuario en la ronda; diagnóstico del companion, /lesson (errores 0: el problema es visual, no de runtime).

### [SALTO] S4. El panel de ajustes abre, cierra y sus controles responden
- Nota: tab presente en ambas pantallas; abrir/cerrar no verificado en esta ronda.
- Evidencia: —

### [SALTO] S5. Los sonidos: Probar sonido suena, y el recordatorio respeta el idle
- Nota: no verificado en esta ronda.
- Evidencia: —

### [SALTO] S6. El nivel de animación se respeta
- Nota: solo se leyó `motion: animado` del diagnóstico.
- Evidencia: —

### [SALTO] S7. El recordatorio no suena mientras practicás; suena tras 45 s quieto
- Nota: no verificado en esta ronda.
- Evidencia: —

### [SALTO] S8. El diario (si activo) cuenta lecciones y tramos
- Nota: no verificado en esta ronda.
- Evidencia: —
