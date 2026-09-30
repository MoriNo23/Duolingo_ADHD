#!/usr/bin/env bash
# fix-reward-fx-static-and-duo-crash: diff de los tres modulos de terceros contra
# los zips de referencia del repo.
#
# Los modulos vienen de afuera y van inline en el archivo publicado, con parches
# locales acotados (ver la nota de "CODIGO DE TERCEROS" en el .user.js). Este
# script imprime esa divergencia para que nunca sea invisible y falla si crece
# mas alla de lo que los parches justifican: una edicion a mano de la geometria
# pasaria por el filtro de "es codigo de otro" sin que nadie lo note.
#
# Uso: test/vendor-diff.sh [archivo-publicado]
# Sale 0 si la divergencia entra en el presupuesto, 1 si no.
set -euo pipefail

RAIZ="$(cd "$(dirname "$0")/.." && pwd)"
PUBLICADO="${1:-$RAIZ/duolingo-adhd.user.js}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# Presupuesto de lineas divergentes. El valor actual es 59; el margen existe para
# que un parche FUTURO y bien justificado no tenga que tocar este numero el mismo
# dia, no para que quepan ediciones de la geometria del vendor.
PRESUPUESTO=90

# Los zips se abren desde un cwd neutral y con -j (sin paths internas): abrir un
# zip con el cwd en la raiz del repo deja los archivos sueltos en el arbol de
# trabajo, que es justo donde despues los confunde un grep o un git add.
cd "$TMP"
unzip -j -qo "$RAIZ/streak-llamas.zip" -d "$TMP/flames"
unzip -j -qo "$RAIZ/diamantes-orbita.zip" -d "$TMP/cristales"
unzip -j -qo "$RAIZ/animationFXSuper.zip" -d "$TMP/duo"

total=0
for par in "streak-flames:$TMP/flames/streak-flames.js" \
           "crystal-reward:$TMP/cristales/crystal-reward.js" \
           "duo-reward:$TMP/duo/duo-reward.js"; do
  mod="${par%%:*}"; ref="${par#*:}"
  if [ ! -f "$ref" ]; then
    echo "::error::falta el zip de referencia de $mod"
    exit 1
  fi
  # El bloque published va entre los marcadores >>> / <<< fin; las lineas de los
  # marcadores no son codigo del modulo.
  sed -n "/>>> $mod\.js/,/fin $mod\.js/p" "$PUBLICADO" | sed '1d;$d' > "$TMP/$mod.embebido.js"
  if [ ! -s "$TMP/$mod.embebido.js" ]; then
    echo "::error::el archivo publicado no tiene el bloque >>> $mod.js"
    exit 1
  fi
  lineas="$(diff -u "$ref" "$TMP/$mod.embebido.js" | grep -cE '^[+-][^+-]' || true)"
  echo "--- $mod: $lineas lineas divergentes del original ---"
  diff -u "$ref" "$TMP/$mod.embebido.js" | tail -n +3 | sed 's/^/    /' || true
  total=$((total + lineas))
done

echo
if [ "$total" -gt "$PRESUPUESTO" ]; then
  echo "::error::divergencia de $total lineas contra un presupuesto de $PRESUPUESTO"
  echo "::error::si el cambio es intencional y esta justificado en el header del .user.js, subi el presupuesto en test/vendor-diff.sh"
  exit 1
fi
echo "divergencia total: $total/$PRESUPUESTO lineas (parches locales)"
