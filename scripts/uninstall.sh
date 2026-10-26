#!/usr/bin/env bash
# Desinstalación de herdr-matrix (macOS y Linux).
# Uso: scripts/uninstall.sh [--purge] [--yes]
#   Sin opciones: revoca la sesión en el servidor, borra la sesión local y desenlaza el plugin de Herdr.
#                 Conserva la configuración (config.json) y el código del repositorio.
#   --purge:      además borra la configuración y el estado (almacén criptográfico, auditoría, snapshot).
#   --yes:        no pide confirmación para --purge.
# No borra el directorio del repositorio ni desinstala Node.js ni Herdr.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PURGE=false
ASSUME_YES=false

for arg in "$@"; do
  case "$arg" in
    --purge) PURGE=true ;;
    --yes) ASSUME_YES=true ;;
    -h|--help)
      sed -n '2,8p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
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

warn() {
  echo "Aviso: $*" >&2
}

# Mismos directorios que install.sh y que usa Herdr al arrancar el plugin.
# Si Herdr no responde o el plugin no está registrado, se usa la convención de Herdr.
herdr_config_dir() {
  herdr plugin config-dir herdr-matrix 2>/dev/null \
    || echo "${XDG_CONFIG_HOME:-$HOME/.config}/herdr/plugins/config/herdr-matrix"
}

herdr_state_dir() {
  echo "${XDG_STATE_HOME:-$HOME/.local/state}/herdr/plugins/herdr-matrix"
}

# Se exportan antes de cualquier acción: así `setup --logout` (hijo de node) usa los mismos directorios.
export_herdr_dirs() {
  HERDR_PLUGIN_CONFIG_DIR="${HERDR_PLUGIN_CONFIG_DIR:-$(herdr_config_dir)}"
  HERDR_PLUGIN_STATE_DIR="${HERDR_PLUGIN_STATE_DIR:-$(herdr_state_dir)}"
  export HERDR_PLUGIN_CONFIG_DIR HERDR_PLUGIN_STATE_DIR
}

config_dir() {
  echo "$HERDR_PLUGIN_CONFIG_DIR"
}

state_dir() {
  echo "$HERDR_PLUGIN_STATE_DIR"
}

# Las rutas antiguas (~/.config/herdr-matrix, ~/.local/state/herdr-matrix) ya no se usan.
# No se borran solas: solo se avisa, para que el usuario decida.
warn_legacy_dirs() {
  local legacy
  for legacy in "${XDG_CONFIG_HOME:-$HOME/.config}/herdr-matrix" "${XDG_STATE_HOME:-$HOME/.local/state}/herdr-matrix"; do
    if [ -e "$legacy" ]; then
      warn "existe una copia antigua en $legacy; no se usa. Bórrala a mano si ya no la necesitas."
    fi
  done
}

# Se niega a actuar si el bridge sigue corriendo: borrar el estado bajo un proceso vivo lo rompe.
check_bridge_stopped() {
  local lock pid
  lock="$(state_dir)/bridge.lock"
  [ -f "$lock" ] || return 0
  pid="$(tr -cd '0-9' < "$lock")"
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
    die "el bridge está en ejecución (pid $pid). Páralo con Ctrl+C o 'kill $pid' y vuelve a ejecutar."
  fi
}

revoke_session() {
  local session
  session="$(state_dir)/session.json"
  if [ ! -f "$session" ]; then
    info "No hay sesión guardada en $(state_dir)"
    return 0
  fi
  if [ ! -d "$ROOT/node_modules" ]; then
    warn "no hay node_modules; no se puede revocar la sesión en el servidor. Revócala desde Element o el servidor."
    return 0
  fi
  info "Revocando la sesión en el servidor y borrando la sesión local"
  (cd "$ROOT" && node src/index.mjs setup --logout)
}

unlink_plugin() {
  local plugins
  plugins="$(herdr plugin list 2>/dev/null || true)"
  if [[ "$plugins" != *herdr-matrix* ]]; then
    info "El plugin no está registrado en Herdr; nada que desenlazar"
    return 0
  fi
  info "Desenlazando el plugin de Herdr"
  herdr plugin unlink herdr-matrix
}

confirm_purge() {
  local dir="$1"
  [ "$ASSUME_YES" = true ] && return 0
  if [ ! -t 0 ]; then
    die "--purge necesita confirmación interactiva; usa --yes para omitirla."
  fi
  read -r -p "Se borrará $dir. ¿Continuar? [s/N] " answer
  case "$answer" in
    s|S|si|sí|y|Y) return 0 ;;
    *) die "cancelado por el usuario." ;;
  esac
}

purge_dir() {
  local dir="$1"
  # Guardas: no borrar rutas vacías, la raíz ni directorios que no sean de este plugin.
  case "$dir" in
    ""|"/"|"$HOME") die "ruta de borrado no segura: '$dir'" ;;
  esac
  [[ "$dir" == *herdr-matrix* ]] || die "ruta de borrado no reconocida: '$dir'"
  if [ ! -e "$dir" ]; then
    info "No existe $dir"
    return 0
  fi
  confirm_purge "$dir"
  rm -rf -- "$dir"
  info "Borrado $dir"
}

main() {
  export_herdr_dirs
  check_bridge_stopped
  revoke_session
  unlink_plugin
  if [ "$PURGE" = true ]; then
    purge_dir "$(state_dir)"
    purge_dir "$(config_dir)"
  else
    info "Configuración conservada en $(config_dir) (usa --purge para borrarla)"
  fi
  warn_legacy_dirs
  info "Desinstalación completa. El código del repositorio sigue en $ROOT"
}

main
