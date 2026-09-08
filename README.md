# 🔋 BatteryAlarm

> **Customizable battery alarm notifications for GNOME Shell / Ubuntu**

[![License: GPL v2](https://img.shields.io/badge/License-GPL%20v2-blue.svg)](https://www.gnu.org/licenses/old-licenses/gpl-2.0.en.html)
[![GNOME Shell](https://img.shields.io/badge/GNOME%20Shell-45%2B-brightgreen)](https://extensions.gnome.org)

BatteryAlarm is an open-source **GNOME Shell extension** that plays configurable alarm sounds when your laptop battery reaches user-defined percentage thresholds. Stop overcharging your battery or getting caught with a dead laptop — let BatteryAlarm keep you informed.

---

## ✨ Features

| Feature | Description |
|---|---|
| 🔔 **Custom Thresholds** | Set any number of battery % levels to trigger alarms |
| ⚡ **Charge Direction Aware** | Trigger alarms only when charging, discharging, or either |
| 🎵 **Alarm Sounds** | Built-in chime or choose your own `.ogg`/`.wav`/`.mp3` |
| 🔁 **Repeat Control** | Configure how many times the alarm plays and the interval |
| ⏱️ **Cooldown** | Prevents alarm spam with a configurable cooldown period |
| 🌙 **Quiet Hours** | Automatically silence alarms during set hours (e.g., overnight) |
| 📢 **Desktop Notifications** | Visual GNOME notification alongside the sound |
| 📊 **Panel Indicator** | Tray icon with mute toggle and quick settings access |
| 🔕 **Quick Mute** | One-click mute from the panel icon |

---

## 📋 Requirements

- Ubuntu 22.04+ / Any GNOME-based distro
- GNOME Shell **45, 46, or 47**
- `libglib2.0-bin` (for `glib-compile-schemas`)
- `pulseaudio-utils` or `pipewire-pulse` (for alarm sound playback)
- `python3` (for sound file generation)
- `ffmpeg` *(optional, for OGG conversion)*

---

## 🚀 Quick Install

```bash
git clone https://github.com/SANGAMARTIN99/BatteryAlarm
cd BatteryAlarm
chmod +x install.sh
./install.sh
```

That's it! The script will:
1. Check your environment and GNOME version
2. Install any missing system packages (with your permission)
3. Generate the bundled alarm sound
4. Compile GSettings schemas
5. Install and enable the extension

---

## 🛠️ Manual Installation (via Make)

```bash
# Generate sound + install + enable
make sound && make dev

# Or step by step:
make sound       # Generate alarm sound
make install     # Install extension files
make enable      # Enable in GNOME Shell

# Package for extensions.gnome.org
make pack
```

---

## ⚙️ Configuration

Click the **🔋 BatteryAlarm panel icon** in the top bar → **Settings…**

Or open the **GNOME Extensions** app and click the ⚙️ gear next to BatteryAlarm.

### Thresholds Tab
- Add/remove thresholds at any battery percentage
- Set direction: "While Charging", "While Discharging", or "Any"
- Enable/disable individual thresholds without deleting them

### Sound Tab
- Test the alarm sound with the **▶ Test** button
- Choose a custom sound file via file picker
- Adjust volume (0–100%) and repeat settings

### General Tab
- Cooldown period (1–120 minutes)
- Quiet hours (start/end time, 24h format)
- Panel indicator and percentage display options

---

## 🏗️ Project Structure

```
battery-alarm@mastesa.github.com/
├── metadata.json           # Extension identity & GNOME version compatibility
├── extension.js            # Core logic: UPower monitoring, alarms, panel
├── prefs.js                # GTK4/libadwaita preferences window (4 pages)
├── schemas/
│   └── *.gschema.xml       # GSettings schema (all user preferences)
├── sounds/
│   └── battery-alarm.ogg   # Bundled alarm chime
├── icons/
│   ├── battery-alarm-symbolic.svg        # Panel icon (active)
│   └── battery-alarm-muted-symbolic.svg  # Panel icon (muted)
├── src/
│   └── generate_sound.py   # Script to regenerate alarm sound from scratch
├── po/                     # Translations (gettext)
├── Makefile                # Build system
├── install.sh              # One-click install script
└── LICENSE                 # GPL-2.0-or-later
```

---

## 🔧 Development

```bash
# Install for development
make dev

# View extension logs
journalctl -f -o cat /usr/bin/gnome-shell | grep BatteryAlarm

# Reload extension after changes (X11 only)
# Press Alt+F2, type 'r', press Enter

# Reload on Wayland
gnome-extensions disable battery-alarm@mastesa.github.com
gnome-extensions enable  battery-alarm@mastesa.github.com

# Validate extension syntax
node --input-type=module < extension.js 2>&1 || true
```

### How Threshold Detection Works

The `ThresholdChecker` uses **level crossing detection** — it only fires when the battery percentage *crosses* a threshold boundary in the configured direction:

- **Charging threshold at 80%**: Alarm fires when battery goes from 79% → 80% while charging
- **Discharging threshold at 20%**: Alarm fires when battery goes from 21% → 20% while discharging

A **cooldown period** prevents the same threshold from triggering again within N minutes, preventing spam when the charger is plugged/unplugged repeatedly.

---

## 🤝 Contributing

Contributions welcome! See [CONTRIBUTING.md](CONTRIBUTING.md).

- 🐛 Report bugs: [GitHub Issues](https://github.com/SANGAMARTIN99/BatteryAlarm/issues)
- 💬 Discuss: [GitHub Discussions](https://github.com/SANGAMARTIN99/BatteryAlarm/discussions)
- 🌐 Translations: Add `.po` files in the `po/` directory

---

## 📝 License

GNU General Public License v2.0 or later. See [LICENSE](LICENSE).

---

## 🙏 Acknowledgements

- [GNOME Shell Extensions Documentation](https://gjs.guide/extensions/)
- [UPower](https://upower.freedesktop.org/) — Battery information via DBus
- [GSound](https://github.com/GNOME/gsound) — Audio playback
- [libadwaita](https://gnome.pages.gitlab.gnome.org/libadwaita/) — GTK4 UI toolkit
