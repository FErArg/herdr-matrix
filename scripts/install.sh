#!/usr/bin/env bash
# Instalación de herdr-matrix en Herdr (macOS y Linux).
# Uso: scripts/install.sh [--setup]
#   Sin opciones: comprueba requisitos, instala dependencias y enlaza el plugin en Herdr.
#   --setup:      además lanza la configuración interactiva (URL, bot, contraseña, dueño).
# No arranca el bridge ni hace `verify`: ambos necesitan pasos manuales (ver README).

set -euo pipefail

MIN_NODE_MAJOR=22
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN_SETUP=false

for arg in "$@"; do
  case "$arg" in
    --setup) RUN_SETUP=true ;;
    -h|--help)
      sed -n '2,6p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "Opción desconocida: $arg" >&2
      exit 2
      ;;
  esac
done

die() {
  echo "Error: $*" >&2
  exit 1
}

info() {
  echo "==> $*"
}

# Devuelve 0 si la versión $1 es igual o superior a $2 (ambas "X.Y.Z").
version_gte() {
  awk -v a="$1" -v b="$2" 'BEGIN {
    split(a, x, "."); split(b, y, ".");
    for (i = 1; i <= 3; i++) {
      if ((x[i] + 0) > (y[i] + 0)) exit 0;
      if ((x[i] + 0) < (y[i] + 0)) exit 1;
    }
    exit 0;
  }'
}

check_os() {
  case "$(uname -s)" in
    Darwin|Linux) ;;
    *) die "sistema no soportado: $(uname -s). El plugin declara solo linux y macos." ;;
  esac
}

check_node() {
  command -v node >/dev/null 2>&1 || die "Node.js no está instalado. Instala Node.js ${MIN_NODE_MAJOR} o superior."
  local major
  major="$(node -p 'process.versions.node.split(".")[0]')"
  if [ "$major" -lt "$MIN_NODE_MAJOR" ]; then
    die "Node.js $(node -v) es demasiado antiguo. Se necesita ${MIN_NODE_MAJOR} o superior."
  fi
}

check_npm() {
  command -v npm >/dev/null 2>&1 || die "npm no está instalado (viene con Node.js)."
}

check_herdr() {
  command -v herdr >/dev/null 2>&1 || die "Herdr no está en el PATH. Instálalo antes de continuar."
  local min current
  min="$(sed -n 's/^min_herdr_version = "\(.*\)"/\1/p' "$ROOT/herdr-plugin.toml")"
  current="$(herdr --version | awk '{print $2}')"
  if ! version_gte "$current" "$min"; then
    die "Herdr $current es anterior a la mínima requerida ($min)."
  fi
  info "Herdr $current (mínimo $min)"
}

install_deps() {
  info "Instalando dependencias fijadas en package-lock.json"
  (cd "$ROOT" && npm ci --ignore-scripts)
}

list_plugins() {
  # Se guarda la salida completa para evitar SIGPIPE con `grep -q` bajo pipefail.
  herdr plugin list 2>/dev/null || true
}

# Herdr guarda el manifiesto en el momento del enlace. Por eso se reenlaza siempre:
# así el [[startup]] y las acciones del manifiesto actual quedan registrados.
link_plugin() {
  if [[ "$(list_plugins)" == *herdr-matrix* ]]; then
    info "Reenlazando el plugin para registrar el manifiesto actual"
    herdr plugin unlink herdr-matrix
  else
    info "Enlazando el plugin en Herdr"
  fi
  herdr plugin link "$ROOT" --enabled
  [[ "$(list_plugins)" == *herdr-matrix* ]] || die "Herdr no muestra el plugin tras enlazarlo."
}

# Herdr arranca el plugin con sus propios directorios (HERDR_PLUGIN_CONFIG_DIR y
# HERDR_PLUGIN_STATE_DIR). setup, verify y run deben usar esos mismos directorios:
# si no, el arranque automático no encuentra la configuración y el bloqueo de instancia no coincide.
# La ruta de estado sigue la convención de Herdr (~/.local/state/herdr/plugins/<id>).
export_herdr_dirs() {
  HERDR_PLUGIN_CONFIG_DIR="$(herdr plugin config-dir herdr-matrix)"
  HERDR_PLUGIN_STATE_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/herdr/plugins/herdr-matrix"
  export HERDR_PLUGIN_CONFIG_DIR HERDR_PLUGIN_STATE_DIR
  info "Directorios del plugin: config=$HERDR_PLUGIN_CONFIG_DIR state=$HERDR_PLUGIN_STATE_DIR"
}

run_setup() {
  if [ ! -t 0 ]; then
    die "--setup necesita una terminal interactiva (la contraseña se lee sin eco)."
  fi
  info "Configuración: URL del servidor, usuario del bot, contraseña y MXID del dueño"
  (cd "$ROOT" && node src/index.mjs setup)
}

print_next_steps() {
  cat <<EOF

Instalación lista. Desde el directorio del plugin, con los mismos directorios de Herdr:

  cd "$ROOT"
  export HERDR_PLUGIN_CONFIG_DIR="$HERDR_PLUGIN_CONFIG_DIR"
  export HERDR_PLUGIN_STATE_DIR="$HERDR_PLUGIN_STATE_DIR"

  1. Configurar (si no lo hiciste con --setup):
       node src/index.mjs setup
  2. Verificar el dispositivo del bot desde Element del dueño (escanear QR):
       node src/index.mjs verify
  3. Arrancar el bridge (SIGINT o SIGTERM para parar).
     Herdr lo arranca solo al iniciarse; no lo ejecutes a la vez que este comando:
       node src/index.mjs run

AVISO: el chat por salas solo responde si el proyecto del workspace está iniciado.
Abre el agente (Claude Code u opencode) en el panel del workspace antes de escribir en su sala.
Sin agente abierto, el agente de ese workspace no responderá.
EOF
}

main() {
  check_os
  check_node
  check_npm
  check_herdr
  install_deps
  link_plugin
  export_herdr_dirs
  if [ "$RUN_SETUP" = true ]; then
    run_setup
  fi
  print_next_steps
}

main
