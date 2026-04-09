#!/usr/bin/env bash
# Install or update sqlitey from https://github.com/Ehesp/sqlitey/releases
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/<user>/<repo>/main/scripts/install-sqlitey.sh | bash
#   bash scripts/install-sqlitey.sh
# Environment:
#   SQLITEY_INSTALL — install prefix; binary at $SQLITEY_INSTALL/bin (default: $HOME/.local)
#   INSTALL_DIR     — full path to bin directory (overrides SQLITEY_INSTALL)
#   FORCE=1         — reinstall even if already on latest tag
#
# System-wide example: INSTALL_DIR=/usr/local/bin bash scripts/install-sqlitey.sh

set -euo pipefail

readonly REPO="Ehesp/sqlitey"
readonly API_LATEST="https://api.github.com/repos/${REPO}/releases/latest"
readonly VERSION_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/sqlitey"
readonly VERSION_FILE="${VERSION_DIR}/version"

die() {
  echo "install-sqlitey: $*" >&2
  exit 1
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "required command not found: $1"
}

get_tag_name() {
  local json="$1"
  if command -v jq >/dev/null 2>&1; then
    jq -r '.tag_name' "$json"
  else
    grep -o '"tag_name"[[:space:]]*:[[:space:]]*"[^"]*"' "$json" | head -1 | sed 's/.*"tag_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/'
  fi
}

get_asset_url() {
  local json="$1" name="$2"
  if command -v jq >/dev/null 2>&1; then
    jq -r --arg n "$name" '.assets[] | select(.name == $n) | .browser_download_url' "$json" | head -1
  elif command -v python3 >/dev/null 2>&1; then
    python3 - "$json" "$name" <<'PY'
import json, sys
with open(sys.argv[1], encoding="utf-8") as f:
    data = json.load(f)
want = sys.argv[2]
for a in data.get("assets", []):
    if a.get("name") == want:
        print(a.get("browser_download_url") or "")
        break
PY
  else
    die "install jq or python3 to parse GitHub release JSON"
  fi
}

detect_asset_name() {
  local os arch
  os=$(uname -s)
  arch=$(uname -m)

  case "$os" in
    Darwin) os="darwin" ;;
    Linux) os="linux" ;;
    MINGW*|MSYS*|CYGWIN*)
      os="win32"
      ;;
    *)
      die "unsupported OS: $os (expected Darwin, Linux, or Windows MSYS)"
      ;;
  esac

  case "$arch" in
    arm64|aarch64) arch="arm64" ;;
    x86_64|amd64) arch="x64" ;;
    *)
      die "unsupported CPU: $arch (expected arm64/aarch64 or x86_64/amd64)"
      ;;
  esac

  if [[ "$os" == "win32" ]]; then
    echo "sqlitey-${os}-${arch}.exe"
  else
    echo "sqlitey-${os}-${arch}"
  fi
}

# Native addon shipped next to the executable (see scripts/release.ts).
detect_turso_asset_name() {
  local base
  base=$(detect_asset_name)
  if [[ "$base" == *.exe ]]; then
    base="${base%.exe}"
  fi
  echo "turso-${base#sqlitey-}.node"
}

default_install_dir() {
  SQLITEY_INSTALL="${SQLITEY_INSTALL:-$HOME/.local}"
  echo "${SQLITEY_INSTALL}/bin"
}

tildify() {
  if [[ "$1" == "$HOME"/* ]]; then
    echo "\$HOME/${1#$HOME/}"
  else
    printf '%s\n' "$1"
  fi
}

path_line_in_file() {
  local f="$1" dir="$2"
  [[ -f "$f" ]] && grep -qF "install-sqlitey.sh PATH" "$f" 2>/dev/null && grep -qF "$dir" "$f" 2>/dev/null
}

# If sqlitey is not invocable, append SQLITEY_INSTALL + PATH to the user's shell config (fish / zsh / bash).
ensure_sqlitey_on_path() {
  local install_dir="$1"
  local dest_name="$2"

  [[ "$dest_name" == "sqlitey" ]] || return 0

  if command -v sqlitey >/dev/null 2>&1; then
    echo "Run 'sqlitey --help' to get started."
    return 0
  fi

  local install_base
  install_base="$(dirname -- "$install_dir")"

  local tilde_bin_dir
  tilde_bin_dir="$(tildify "$install_dir")"

  local refresh_command=""
  local shell_name
  shell_name=$(basename "${SHELL:-/bin/zsh}")

  case "$shell_name" in
    fish)
      local fish_config="$HOME/.config/fish/config.fish"
      mkdir -p "$(dirname -- "$fish_config")"
      [[ -f "$fish_config" ]] || touch "$fish_config"

      if [[ -w "$fish_config" ]]; then
        if ! path_line_in_file "$fish_config" "$install_dir"; then
          {
            echo ""
            echo "# sqlitey (install-sqlitey.sh PATH)"
            if [[ "$install_base" == "$HOME"/* ]]; then
              echo "set -gx SQLITEY_INSTALL \$HOME/${install_base#$HOME/}"
            else
              echo "set -gx SQLITEY_INSTALL \"$install_base\""
            fi
            echo "set -gx PATH \"$install_dir\" \$PATH"
          } >>"$fish_config"
          echo "Added $tilde_bin_dir to PATH in $fish_config"
        fi
        refresh_command="source $fish_config"
      else
        echo "Manually add to $fish_config:"
        if [[ "$install_base" == "$HOME"/* ]]; then
          echo "  set -gx SQLITEY_INSTALL \$HOME/${install_base#$HOME/}"
        else
          echo "  set -gx SQLITEY_INSTALL \"$install_base\""
        fi
        echo "  set -gx PATH \"$install_dir\" \$PATH"
      fi
      ;;
    zsh)
      local zsh_config="$HOME/.zshrc"
      [[ -f "$zsh_config" ]] || touch "$zsh_config"

      if [[ -w "$zsh_config" ]]; then
        if ! path_line_in_file "$zsh_config" "$install_dir"; then
          {
            echo ""
            echo "# sqlitey (install-sqlitey.sh PATH)"
            if [[ "$install_base" == "$HOME"/* ]]; then
              echo "export SQLITEY_INSTALL=\"\$HOME/${install_base#$HOME/}\""
            else
              printf 'export SQLITEY_INSTALL=%q\n' "$install_base"
            fi
            echo "export PATH=$install_dir:\$PATH"
          } >>"$zsh_config"
          echo "Added $tilde_bin_dir to PATH in $zsh_config"
        fi
        refresh_command="exec $SHELL"
      else
        echo "Manually add to $zsh_config:"
        if [[ "$install_base" == "$HOME"/* ]]; then
          echo "  export SQLITEY_INSTALL=\"\$HOME/${install_base#$HOME/}\""
        else
          echo "  export SQLITEY_INSTALL=$(printf '%q' "$install_base")"
        fi
        echo "  export PATH=$install_dir:\$PATH"
      fi
      ;;
    bash)
      local bash_config=""
      local wrote=0
      for bash_config in "$HOME/.bash_profile" "$HOME/.bashrc"; do
        [[ -f "$bash_config" ]] || touch "$bash_config" 2>/dev/null || continue
        if [[ -w "$bash_config" ]]; then
          if ! path_line_in_file "$bash_config" "$install_dir"; then
            {
              echo ""
              echo "# sqlitey (install-sqlitey.sh PATH)"
              if [[ "$install_base" == "$HOME"/* ]]; then
                echo "export SQLITEY_INSTALL=\"\$HOME/${install_base#$HOME/}\""
              else
                printf 'export SQLITEY_INSTALL=%q\n' "$install_base"
              fi
              echo "export PATH=$install_dir:\$PATH"
            } >>"$bash_config"
            echo "Added $tilde_bin_dir to PATH in $bash_config"
          fi
          refresh_command="source $bash_config"
          wrote=1
          break
        fi
      done
      if [[ "$wrote" -eq 0 ]]; then
        echo "Manually add to ~/.bashrc or ~/.bash_profile:"
        if [[ "$install_base" == "$HOME"/* ]]; then
          echo "  export SQLITEY_INSTALL=\"\$HOME/${install_base#$HOME/}\""
        else
          echo "  export SQLITEY_INSTALL=$(printf '%q' "$install_base")"
        fi
        echo "  export PATH=$install_dir:\$PATH"
      fi
      ;;
    *)
      echo "Manually add to your shell config:"
      if [[ "$install_base" == "$HOME"/* ]]; then
        echo "  export SQLITEY_INSTALL=\"\$HOME/${install_base#$HOME/}\""
      else
        echo "  export SQLITEY_INSTALL=$(printf '%q' "$install_base")"
      fi
      echo "  export PATH=$install_dir:\$PATH"
      ;;
  esac

  echo ""
  if [[ -n "$refresh_command" ]]; then
    echo "To load sqlitey in this session, run:"
    echo "  $refresh_command"
    echo "  sqlitey --help"
  else
    echo "Restart your terminal, then run 'sqlitey --help'"
  fi
}

script_help() {
  sed -n '2,/^$/p' "${BASH_SOURCE[0]:-$0}" | sed '/^$/d' | sed 's/^# \{0,1\}//'
}

main() {
  need_cmd curl
  need_cmd uname

  local force=0
  while [[ $# -gt 0 ]]; do
    case "$1" in
      -f|--force) force=1; shift ;;
      -h|--help)
        script_help
        exit 0
        ;;
      *) die "unknown option: $1 (use --help)" ;;
    esac
  done

  local asset_name turso_asset_name
  asset_name=$(detect_asset_name)
  turso_asset_name=$(detect_turso_asset_name)

  local dest_name="sqlitey"
  [[ "$asset_name" == *.exe ]] && dest_name="sqlitey.exe"

  local install_dir="${INSTALL_DIR:-$(default_install_dir)}"

  local tmp
  tmp=$(mktemp)
  trap 'rm -f "$tmp"' EXIT

  if ! curl -fsSL -H "Accept: application/vnd.github+json" -H "X-GitHub-Api-Version: 2022-11-28" \
    "$API_LATEST" -o "$tmp"; then
    die "failed to fetch release metadata from GitHub (check network, rate limits, and that ${REPO} exists and is public)"
  fi
  [[ -s "$tmp" ]] || die "empty response from GitHub API"

  local tag url
  tag=$(get_tag_name "$tmp")
  [[ -n "$tag" && "$tag" != "null" ]] || die "could not parse release tag"

  url=$(get_asset_url "$tmp" "$asset_name")
  [[ -n "$url" && "$url" != "null" ]] || die "no release asset named: $asset_name (is this platform published?)"

  local turso_url
  turso_url=$(get_asset_url "$tmp" "$turso_asset_name")
  [[ -n "$turso_url" && "$turso_url" != "null" ]] || die "no release asset named: $turso_asset_name (publish both sqlitey and turso-*.node from scripts/release.ts)"

  mkdir -p "$install_dir" "$VERSION_DIR" || die "cannot create directories under $install_dir"

  if [[ "$force" -eq 0 ]] && [[ -f "$VERSION_FILE" ]] && [[ "$(cat "$VERSION_FILE" 2>/dev/null || true)" == "$tag" ]]; then
    if [[ -x "$install_dir/$dest_name" ]] && [[ -f "$install_dir/$turso_asset_name" ]]; then
      echo "sqlitey is already at latest ($tag) in $install_dir"
      ensure_sqlitey_on_path "$install_dir" "$dest_name"
      exit 0
    fi
  fi

  local dl
  dl=$(mktemp)
  trap 'rm -f "$tmp" "$dl"' EXIT

  echo "Downloading $asset_name ($tag) ..."
  curl -fL --progress-bar -o "$dl" "$url" || die "download failed"

  local dl2
  dl2=$(mktemp)
  trap 'rm -f "$tmp" "$dl" "$dl2"' EXIT

  echo "Downloading $turso_asset_name ($tag) ..."
  curl -fL --progress-bar -o "$dl2" "$turso_url" || die "download failed (turso native addon)"

  if [[ "$asset_name" == *.exe ]]; then
    mv -f "$dl" "$install_dir/$dest_name"
  else
    need_cmd install
    install -m 0755 "$dl" "$install_dir/$dest_name"
  fi

  install -m 0644 "$dl2" "$install_dir/$turso_asset_name"

  printf '%s\n' "$tag" >"$VERSION_FILE"
  echo "Installed $install_dir/$dest_name + $install_dir/$turso_asset_name ($tag)"

  ensure_sqlitey_on_path "$install_dir" "$dest_name"
}

main "$@"
