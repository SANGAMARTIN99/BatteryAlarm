#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# BatteryAlarm — One-Click Install Script
# Usage: ./install.sh [--uninstall]
#
# This script:
#   1. Checks system dependencies
#   2. Installs missing packages (asks for sudo only if needed)
#   3. Generates the alarm sound
#   4. Compiles GSettings schemas
#   5. Installs the extension
#   6. Enables it via gnome-extensions CLI
#
# SPDX-License-Identifier: GPL-2.0-or-later
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

UUID="battery-alarm@mastesa.github.com"
INSTALL_DIR="$HOME/.local/share/gnome-shell/extensions/$UUID"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ── Colors ────────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; BOLD='\033[1m'; RESET='\033[0m'

info()    { echo -e "${BLUE}ℹ${RESET}  $*"; }
success() { echo -e "${GREEN}✅${RESET} $*"; }
warn()    { echo -e "${YELLOW}⚠️${RESET}  $*"; }
error()   { echo -e "${RED}❌${RESET} $*" >&2; }
step()    { echo -e "\n${BOLD}── $* ──${RESET}"; }

# ── Banner ────────────────────────────────────────────────────────────────────
echo -e "
${BOLD}${BLUE}┌─────────────────────────────────────┐
│   🔋  BatteryAlarm  GNOME Extension  │
│        Installation Script           │
└─────────────────────────────────────┘${RESET}
"

# ── Uninstall mode ────────────────────────────────────────────────────────────
if [[ "${1:-}" == "--uninstall" ]]; then
    step "Uninstalling BatteryAlarm"
    gnome-extensions disable "$UUID" 2>/dev/null || true
    rm -rf "$INSTALL_DIR"
    success "BatteryAlarm has been uninstalled."
    exit 0
fi

# ── Check GNOME Shell ─────────────────────────────────────────────────────────
step "Checking environment"

if ! command -v gnome-shell &>/dev/null; then
    error "GNOME Shell is not installed. This extension requires Ubuntu with GNOME."
    exit 1
fi

GNOME_VERSION=$(gnome-shell --version | grep -oP '[\d]+(?=\.)' | head -1)
info "GNOME Shell version: $GNOME_VERSION"

if [[ "$GNOME_VERSION" -lt 45 ]]; then
    error "BatteryAlarm requires GNOME Shell 45 or newer. Found: $GNOME_VERSION"
    exit 1
fi

success "Environment OK"

# ── Check & install dependencies ──────────────────────────────────────────────
step "Checking dependencies"

MISSING_PKGS=()

check_pkg() {
    local cmd="$1" pkg="$2"
    if ! command -v "$cmd" &>/dev/null; then
        warn "Missing: $cmd (package: $pkg)"
        MISSING_PKGS+=("$pkg")
    else
        info "Found: $cmd"
    fi
}

check_pkg "glib-compile-schemas"  "libglib2.0-bin"
check_pkg "python3"               "python3"
check_pkg "gnome-extensions"      "gnome-shell-extensions"

# Audio: check for paplay (PulseAudio) or pipewire-pulse
if ! command -v paplay &>/dev/null; then
    warn "paplay not found — alarm sound may not play. Install: pulseaudio-utils"
    MISSING_PKGS+=("pulseaudio-utils")
fi

# Optional: ffmpeg for sound generation
if ! command -v ffmpeg &>/dev/null; then
    warn "ffmpeg not found (needed for sound generation). Install: ffmpeg"
fi

if [[ ${#MISSING_PKGS[@]} -gt 0 ]]; then
    echo ""
    warn "The following packages are required and will be installed:"
    printf '   %s\n' "${MISSING_PKGS[@]}"
    echo ""
    read -r -p "Install missing packages now? [Y/n] " REPLY
    REPLY="${REPLY:-Y}"
    if [[ "$REPLY" =~ ^[Yy]$ ]]; then
        sudo apt-get update -q
        sudo apt-get install -y "${MISSING_PKGS[@]}"
        success "Packages installed"
    else
        warn "Skipping package installation. Some features may not work."
    fi
fi

# ── Generate alarm sound ──────────────────────────────────────────────────────
step "Generating alarm sound"

if [[ ! -f "$SCRIPT_DIR/sounds/battery-alarm.ogg" ]]; then
    mkdir -p "$SCRIPT_DIR/sounds"
    python3 "$SCRIPT_DIR/src/generate_sound.py" && \
        success "Alarm sound generated" || \
        warn "Sound generation failed — alarm will still work but may use a fallback"
else
    info "Alarm sound already exists, skipping generation"
fi

# ── Compile GSettings schemas ─────────────────────────────────────────────────
step "Compiling GSettings schemas"

glib-compile-schemas "$SCRIPT_DIR/schemas/"
success "Schemas compiled"

# ── Install extension ─────────────────────────────────────────────────────────
step "Installing extension"

mkdir -p "$INSTALL_DIR"

# Copy main files
cp -v "$SCRIPT_DIR/metadata.json"  "$INSTALL_DIR/"
cp -v "$SCRIPT_DIR/extension.js"   "$INSTALL_DIR/"
cp -v "$SCRIPT_DIR/prefs.js"       "$INSTALL_DIR/"
[[ -f "$SCRIPT_DIR/LICENSE" ]] && cp -v "$SCRIPT_DIR/LICENSE" "$INSTALL_DIR/"

# Copy directories
for d in schemas sounds icons po; do
    if [[ -d "$SCRIPT_DIR/$d" ]]; then
        cp -rv "$SCRIPT_DIR/$d" "$INSTALL_DIR/"
    fi
done

success "Extension files installed to: $INSTALL_DIR"

# ── Enable extension ──────────────────────────────────────────────────────────
step "Enabling extension"

# Check if GNOME Shell is running (not in TTY)
if [[ -z "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ]]; then
    warn "No display server detected. Extension installed but not enabled."
    info "After logging into GNOME, run: gnome-extensions enable $UUID"
else
    if gnome-extensions enable "$UUID" 2>/dev/null; then
        success "Extension enabled!"
    else
        warn "Could not auto-enable. To enable manually:"
        info "  Option 1: gnome-extensions enable $UUID"
        info "  Option 2: Open 'Extensions' app and toggle BatteryAlarm on"
    fi
fi

# ── Final message ─────────────────────────────────────────────────────────────
echo -e "
${GREEN}${BOLD}────────────────────────────────────────────${RESET}
${GREEN}${BOLD}  🎉  BatteryAlarm installed successfully!   ${RESET}
${GREEN}${BOLD}────────────────────────────────────────────${RESET}

  Next steps:
  1. Open ${BOLD}GNOME Extensions${RESET} app to verify BatteryAlarm is enabled
  2. Click the 🔋 icon in the top panel to access settings
  3. Open ${BOLD}Settings → Configure thresholds${RESET} to customize your alarms

  To uninstall:  ${BOLD}./install.sh --uninstall${RESET}
  Report issues: ${BOLD}https://github.com/mastesa/battery-alarm-gnome/issues${RESET}
"
