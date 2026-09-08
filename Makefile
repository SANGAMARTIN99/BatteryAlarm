## Makefile for BatteryAlarm GNOME Shell Extension
##
## Targets:
##   make install    — Install to ~/.local/share/gnome-shell/extensions/
##   make uninstall  — Remove installed extension
##   make enable     — Enable the extension (requires GNOME Shell running)
##   make disable    — Disable the extension
##   make pack       — Create distributable .zip for extensions.gnome.org
##   make dev        — Quick development install (install + enable)
##   make clean      — Remove build artifacts
##   make sound      — Regenerate the bundled alarm sound
##   make schemas    — Recompile GSettings schemas only

UUID       := battery-alarm@mastesa.github.com
INSTALL_DIR := $(HOME)/.local/share/gnome-shell/extensions/$(UUID)
SCHEMA_DIR  := $(INSTALL_DIR)/schemas
DIST_DIR    := dist

# Files to include in the installed extension (and .zip)
EXTENSION_FILES := \
	metadata.json \
	extension.js \
	prefs.js \
	LICENSE

EXTENSION_DIRS := \
	schemas \
	sounds \
	icons \
	po

.PHONY: all install uninstall enable disable pack dev clean sound schemas help

all: help

## ── Install ──────────────────────────────────────────────────────────────────

install: _check_deps _compile_schemas _copy_files
	@echo ""
	@echo "✅ BatteryAlarm installed to: $(INSTALL_DIR)"
	@echo "   Run 'make enable' to activate, or use GNOME Extensions app."
	@echo ""

_check_deps:
	@command -v glib-compile-schemas >/dev/null 2>&1 || \
		{ echo "❌ Error: glib-compile-schemas not found. Install: sudo apt install libglib2.0-bin"; exit 1; }
	@command -v gnome-extensions >/dev/null 2>&1 || \
		{ echo "⚠️  Warning: gnome-extensions CLI not found. Install: sudo apt install gnome-shell-extensions"; }

_copy_files:
	@mkdir -p $(INSTALL_DIR)
	@cp -v $(EXTENSION_FILES) $(INSTALL_DIR)/
	@for d in $(EXTENSION_DIRS); do \
		if [ -d $$d ]; then \
			cp -rv $$d $(INSTALL_DIR)/; \
		fi; \
	done
	@echo "   Files copied."

_compile_schemas:
	@echo "   Compiling GSettings schemas..."
	@glib-compile-schemas schemas/
	@echo "   Schemas compiled."

schemas: _compile_schemas

## ── Uninstall ─────────────────────────────────────────────────────────────────

uninstall:
	@if [ -d "$(INSTALL_DIR)" ]; then \
		gnome-extensions disable $(UUID) 2>/dev/null || true; \
		rm -rf $(INSTALL_DIR); \
		echo "✅ BatteryAlarm uninstalled."; \
	else \
		echo "⚠️  Extension not found at $(INSTALL_DIR)"; \
	fi

## ── Enable / Disable ─────────────────────────────────────────────────────────

enable:
	@gnome-extensions enable $(UUID) && \
		echo "✅ BatteryAlarm enabled." || \
		echo "❌ Failed to enable. Is the extension installed? Run 'make install' first."

disable:
	@gnome-extensions disable $(UUID) && \
		echo "✅ BatteryAlarm disabled." || \
		echo "⚠️  Could not disable (may not be installed)."

## ── Development shortcut ─────────────────────────────────────────────────────

dev: install enable
	@echo ""
	@echo "🔄 To reload GNOME Shell (X11 only): press Alt+F2, type 'r', press Enter"
	@echo "   On Wayland: log out and back in, or run: gnome-extensions disable $(UUID) && gnome-extensions enable $(UUID)"

## ── Package for distribution ──────────────────────────────────────────────────

pack: _check_deps _compile_schemas
	@mkdir -p $(DIST_DIR)
	@zip -r $(DIST_DIR)/$(UUID).zip \
		$(EXTENSION_FILES) \
		$(EXTENSION_DIRS) \
		--exclude '*.pyc' \
		--exclude '*/__pycache__/*' \
		--exclude '*/.*'
	@echo "✅ Extension packaged: $(DIST_DIR)/$(UUID).zip"
	@echo "   Upload this file to: https://extensions.gnome.org/upload/"

## ── Sound generation ─────────────────────────────────────────────────────────

sound:
	@echo "Generating alarm sound..."
	@python3 src/generate_sound.py
	@echo "✅ Sound ready: sounds/battery-alarm.ogg"

## ── Clean ────────────────────────────────────────────────────────────────────

clean:
	@rm -rf $(DIST_DIR)
	@rm -f schemas/gschemas.compiled
	@find . -name '*.pyc' -delete
	@find . -name '__pycache__' -type d -exec rm -rf {} + 2>/dev/null || true
	@echo "✅ Cleaned build artifacts."

## ── Help ─────────────────────────────────────────────────────────────────────

help:
	@echo ""
	@echo "  BatteryAlarm — GNOME Shell Extension Build System"
	@echo "  ────────────────────────────────────────────────"
	@echo ""
	@echo "  make install    Install extension to ~/.local/share/gnome-shell/extensions/"
	@echo "  make uninstall  Remove installed extension"
	@echo "  make enable     Enable the extension in GNOME Shell"
	@echo "  make disable    Disable the extension"
	@echo "  make dev        Install + enable (quick dev setup)"
	@echo "  make pack       Package .zip for extensions.gnome.org"
	@echo "  make sound      Regenerate bundled alarm sound"
	@echo "  make schemas    Recompile GSettings schemas"
	@echo "  make clean      Remove build artifacts"
	@echo ""
	@echo "  Quick start:"
	@echo "    make sound && make dev"
	@echo ""
