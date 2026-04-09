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
# List releases (not /releases/latest): "latest" can exist before CI uploads assets.
readonly API_RELEASES="https://api.github.com/repos/${REPO}/releases?per_page=100"
readonly VERSION_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/sqlitey"
readonly VERSION_FILE="${VERSION_DIR}/version"

die() {
  echo "install-sqlitey: $*" >&2
  exit 1
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "required command not found: $1"
}

# Turso .node must match host OS/arch (e.g. catch Linux ELF saved as turso-darwin-arm64.node).
turso_native_matches_host() {
  local f="$1"
  [[ -f "$f" && -s "$f" ]] || return 1
  command -v file >/dev/null 2>&1 || return 0
  local ft
  ft=$(file -b "$f" 2>/dev/null || true)
  case "$(uname -s)" in
    Darwin)
      [[ "$ft" == *Mach-O* ]] || return 1
      # Reject foreign objects (e.g. ELF mislabeled as darwin).
      [[ "$ft" == *ELF* ]] && return 1
      case "$(uname -m)" in
        arm64|aarch64) [[ "$ft" == *arm64* ]] || [[ "$ft" == *aarch64* ]] || return 1 ;;
        x86_64|amd64) [[ "$ft" == *x86_64* ]] || return 1 ;;
      esac
      ;;
    Linux)
      [[ "$ft" == *ELF* ]] || return 1
      ;;
    MINGW*|MSYS*|CYGWIN*)
      [[ "$ft" == *PE32* ]] || [[ "$ft" == *PE32+* ]] || return 1
      ;;
  esac
  return 0
}

# Pick newest non-draft release that already has both binaries (avoids empty "latest" during CI).
resolve_release_with_assets() {
  local json="$1" asset_name="$2" turso_asset_name="$3"
  if command -v jq >/dev/null 2>&1; then
    jq -r --arg a1 "$asset_name" --arg a2 "$turso_asset_name" '
      def asset_ok:
        ([.assets[].name] | (index($a1) != null) and (index($a2) != null));
      def pick($stable):
        .[] | select(.draft == false)
          | select(if $stable then (.prerelease == false) else true end)
          | select(asset_ok);
      (first(pick(true)) // first(pick(false)))
      | "\(.tag_name)\t\(([.assets[] | select(.name == $a1)][0].browser_download_url))\t\(([.assets[] | select(.name == $a2)][0].browser_download_url))"
    ' "$json"
  elif command -v python3 >/dev/null 2>&1; then
    python3 - "$json" "$asset_name" "$turso_asset_name" <<'PY'
import json, sys

with open(sys.argv[1], encoding="utf-8") as f:
    releases = json.load(f)
a1, a2 = sys.argv[2], sys.argv[3]


def row(rel):
    by_name = {}
    for x in rel.get("assets") or []:
        n, u = x.get("name"), x.get("browser_download_url")
        if n and u:
            by_name[n] = u
    if a1 in by_name and a2 in by_name:
        tag = rel.get("tag_name") or ""
        return f"{tag}\t{by_name[a1]}\t{by_name[a2]}"
    return None


def emit(stable_only):
    for rel in releases:
        if rel.get("draft"):
            continue
        if stable_only and rel.get("prerelease"):
            continue
        r = row(rel)
        if r:
            print(r)
            sys.exit(0)


emit(True)
emit(False)
sys.exit(1)
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
    "$API_RELEASES" -o "$tmp"; then
    die "failed to fetch release metadata from GitHub (check network, rate limits, and that ${REPO} exists and is public)"
  fi
  [[ -s "$tmp" ]] || die "empty response from GitHub API"

  local tag url turso_url line
  line=$(resolve_release_with_assets "$tmp" "$asset_name" "$turso_asset_name") || true
  [[ -n "$line" ]] || die "no release with both $asset_name and $turso_asset_name yet (wait for CI to finish uploading assets, or try again)"

  IFS=$'\t' read -r tag url turso_url <<<"$line"
  [[ -n "$tag" && "$tag" != "null" ]] || die "could not parse release tag"
  [[ -n "$url" && "$url" != "null" ]] || die "no release asset named: $asset_name (is this platform published?)"
  [[ -n "$turso_url" && "$turso_url" != "null" ]] || die "no release asset named: $turso_asset_name (publish both sqlitey and turso-*.node from scripts/release.ts)"

  mkdir -p "$install_dir" "$VERSION_DIR" || die "cannot create directories under $install_dir"

  if [[ "$force" -eq 0 ]] && [[ -f "$VERSION_FILE" ]] && [[ "$(cat "$VERSION_FILE" 2>/dev/null || true)" == "$tag" ]]; then
    if [[ -x "$install_dir/$dest_name" ]] && [[ -f "$install_dir/$turso_asset_name" ]]; then
      if turso_native_matches_host "$install_dir/$turso_asset_name"; then
        echo "sqlitey is already at latest ($tag) in $install_dir"
        ensure_sqlitey_on_path "$install_dir" "$dest_name"
        exit 0
      fi
      echo "install-sqlitey: replacing invalid $turso_asset_name (wrong OS/arch or corrupt); re-downloading ..." >&2
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
  turso_native_matches_host "$dl2" || die "downloaded $turso_asset_name does not match this OS/arch ($(file -b "$dl2")). Remove bad files and retry, or report a mislabeled release asset."

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
