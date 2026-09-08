/**
 * BatteryAlarm — GNOME Shell Extension
 * extension.js — Main extension logic
 *
 * Monitors battery levels via UPower DBus and plays alarm sounds
 * when user-defined thresholds are reached.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 * Copyright (C) 2024 BatteryAlarm Contributors
 */

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import St from 'gi://St';
import Clutter from 'gi://Clutter';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {Extension, gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const UPOWER_DBUS_NAME      = 'org.freedesktop.UPower';
const UPOWER_DBUS_PATH      = '/org/freedesktop/UPower';
const UPOWER_DEVICE_IFACE   = 'org.freedesktop.UPower.Device';
const UPOWER_DISPLAY_DEVICE = '/org/freedesktop/UPower/devices/DisplayDevice';

// Battery states (UPower enum)
const BatteryState = {
    UNKNOWN:          0,
    CHARGING:         1,
    DISCHARGING:      2,
    EMPTY:            3,
    FULLY_CHARGED:    4,
    PENDING_CHARGE:   5,
    PENDING_DISCHARGE: 6,
};

// How often to poll battery (ms) — fallback if DBus signals miss
const POLL_INTERVAL_MS = 30_000;

// ─── UPower DBus Interface XML ─────────────────────────────────────────────────

const UPowerDeviceInterface = `
<node>
  <interface name="org.freedesktop.UPower.Device">
    <property name="Type"               type="u" access="read"/>
    <property name="State"              type="u" access="read"/>
    <property name="Percentage"         type="d" access="read"/>
    <property name="IsPresent"          type="b" access="read"/>
    <property name="TimeToFull"         type="x" access="read"/>
    <property name="TimeToEmpty"        type="x" access="read"/>
    <signal name="Changed"/>
  </interface>
</node>`;

const UPowerDeviceProxy = Gio.DBusProxy.makeProxyWrapper(UPowerDeviceInterface);

// ─── BatteryMonitor ───────────────────────────────────────────────────────────

/**
 * Subscribes to UPower DBus and emits 'battery-changed' with {percent, state}
 * whenever the battery status changes.
 */
const BatteryMonitor = GObject.registerClass({
    Signals: {
        'battery-changed': {
            param_types: [GObject.TYPE_DOUBLE, GObject.TYPE_UINT],
        },
    },
}, class BatteryMonitor extends GObject.Object {
    _init() {
        super._init();
        this._proxy = null;
        this._propChangedId = null;
        this._pollTimer = null;
        this._lastPercent = -1;
        this._lastState   = BatteryState.UNKNOWN;
    }

    async start() {
        try {
            this._proxy = new UPowerDeviceProxy(
                Gio.DBus.system,
                UPOWER_DBUS_NAME,
                UPOWER_DISPLAY_DEVICE,
                null
            );

            // Connect to property-changed signal for real-time updates
            this._propChangedId = this._proxy.connect(
                'g-properties-changed',
                () => this._onBatteryChanged()
            );

            // Initial read
            this._onBatteryChanged();

            // Polling fallback (catches edge cases DBus signals might miss)
            this._pollTimer = GLib.timeout_add(
                GLib.PRIORITY_DEFAULT_IDLE,
                POLL_INTERVAL_MS,
                () => {
                    this._onBatteryChanged();
                    return GLib.SOURCE_CONTINUE;
                }
            );

            console.log('[BatteryAlarm] Monitor started successfully');
        } catch (e) {
            console.error(`[BatteryAlarm] Failed to start battery monitor: ${e.message}`);
        }
    }

    _onBatteryChanged() {
        if (!this._proxy) return;

        try {
            const percent = this._proxy.Percentage ?? -1;
            const state   = this._proxy.State ?? BatteryState.UNKNOWN;

            // Only emit if something meaningful changed
            if (Math.floor(percent) !== Math.floor(this._lastPercent) ||
                state !== this._lastState) {
                this._lastPercent = percent;
                this._lastState   = state;
                this.emit('battery-changed', percent, state);
            }
        } catch (e) {
            console.error(`[BatteryAlarm] Error reading battery state: ${e.message}`);
        }
    }

    getCurrentStatus() {
        return {
            percent: this._lastPercent,
            state:   this._lastState,
        };
    }

    stop() {
        if (this._propChangedId && this._proxy) {
            this._proxy.disconnect(this._propChangedId);
            this._propChangedId = null;
        }
        if (this._pollTimer) {
            GLib.source_remove(this._pollTimer);
            this._pollTimer = null;
        }
        this._proxy = null;
        console.log('[BatteryAlarm] Monitor stopped');
    }
});

// ─── AlarmPlayer ──────────────────────────────────────────────────────────────

/**
 * Plays alarm sounds using GSound (libcanberra) or paplay as fallback.
 * Handles repeat counts and intervals.
 */
class AlarmPlayer {
    constructor(extensionDir) {
        this._extensionDir = extensionDir;
        this._repeatTimers = [];
        this._soundCtx     = null;
        this._initGSound();
    }

    _initGSound() {
        try {
            // Dynamically import GSound — it may not be available on all systems
            import('gi://GSound').then(({default: GSound}) => {
                this._GSound = GSound;
                const ctx = new GSound.Context();
                ctx.init(null);
                this._soundCtx = ctx;
                console.log('[BatteryAlarm] GSound context initialized');
            }).catch(e => {
                console.warn(`[BatteryAlarm] GSound not available, will use paplay: ${e.message}`);
            });
        } catch (e) {
            console.warn(`[BatteryAlarm] GSound init failed: ${e.message}`);
        }
    }

    /**
     * Play the alarm sound.
     * @param {string} soundFile  - Absolute path or '' for bundled default
     * @param {number} volume     - 0.0 – 1.0
     * @param {number} repeatCount - Times to play
     * @param {number} repeatIntervalSec - Seconds between repeats
     */
    play(soundFile, volume = 0.8, repeatCount = 3, repeatIntervalSec = 2) {
        this.stop(); // Cancel any previous alarm in progress

        const resolvedFile = soundFile || this._getBundledSoundPath();
        let played = 0;

        const doPlay = () => {
            this._playSingle(resolvedFile, volume);
            played++;
            if (played < repeatCount) {
                const timerId = GLib.timeout_add_seconds(
                    GLib.PRIORITY_DEFAULT,
                    repeatIntervalSec,
                    () => {
                        doPlay();
                        return GLib.SOURCE_REMOVE;
                    }
                );
                this._repeatTimers.push(timerId);
            }
        };

        doPlay();
    }

    _playSingle(filePath, volume) {
        if (this._soundCtx && this._GSound) {
            try {
                const GSound = this._GSound;
                this._soundCtx.play_simple({
                    [GSound.ATTR_MEDIA_FILENAME]: filePath,
                    [GSound.ATTR_MEDIA_ROLE]:     'alarm',
                }, null);
                return;
            } catch (e) {
                console.warn(`[BatteryAlarm] GSound playback failed, falling back to paplay: ${e.message}`);
            }
        }

        // Fallback: paplay
        this._paplay(filePath, volume);
    }

    _paplay(filePath, volume) {
        try {
            // volume is 0.0–1.0, paplay --volume expects 0–65536
            const paVolume = Math.round(volume * 65536);
            const proc = Gio.Subprocess.new(
                ['paplay', `--volume=${paVolume}`, filePath],
                Gio.SubprocessFlags.NONE
            );
            proc.wait_check_async(null, null);
        } catch (e) {
            console.error(`[BatteryAlarm] paplay failed: ${e.message}`);
            // Last resort: system beep via bell
            try {
                Gio.Subprocess.new(['dbus-send', '--session',
                    '--dest=org.gnome.SettingsDaemon.MediaKeys',
                    '/org/gnome/SettingsDaemon/MediaKeys',
                    'org.gnome.SettingsDaemon.MediaKeys.RingBell'],
                    Gio.SubprocessFlags.NONE);
            } catch (_) {}
        }
    }

    _getBundledSoundPath() {
        return GLib.build_filenamev([this._extensionDir, 'sounds', 'battery-alarm.ogg']);
    }

    stop() {
        for (const id of this._repeatTimers) {
            GLib.source_remove(id);
        }
        this._repeatTimers = [];
    }

    destroy() {
        this.stop();
        this._soundCtx = null;
    }
}

// ─── ThresholdChecker ────────────────────────────────────────────────────────

/**
 * Evaluates the current battery state against user-configured thresholds
 * and decides whether to trigger an alarm.
 */
class ThresholdChecker {
    constructor(settings) {
        this._settings = settings;
    }

    /**
     * Check if any threshold should fire.
     * Returns an array of thresholds that should trigger an alarm.
     *
     * @param {number} percent  - Current battery percentage
     * @param {number} state    - UPower battery state
     * @param {number} prevPct  - Previous battery percentage
     * @param {number} prevState - Previous battery state
     */
    getTriggeredThresholds(percent, state, prevPct, prevState) {
        const thresholds   = this._getThresholds();
        const lastAlarmMap = this._getLastAlarmTimes();
        const now          = Date.now();
        const cooldownMs   = this._settings.get_int('cooldown-minutes') * 60_000;
        const triggered    = [];

        const isCharging    = state === BatteryState.CHARGING ||
                              state === BatteryState.PENDING_CHARGE;
        const isDischarging = state === BatteryState.DISCHARGING ||
                              state === BatteryState.PENDING_DISCHARGE ||
                              state === BatteryState.EMPTY;

        for (const threshold of thresholds) {
            if (!threshold.enabled) continue;

            const pct = threshold.percent;

            // Direction check
            const dirMatch = (threshold.direction === 'charging'    && isCharging)    ||
                             (threshold.direction === 'discharging' && isDischarging) ||
                             (threshold.direction === 'any');
            if (!dirMatch) continue;

            // Threshold crossing check:
            // We fire when percent crosses threshold from below (charging) or above (discharging)
            let crossed = false;
            if (threshold.direction === 'charging' || threshold.direction === 'any') {
                // Crossing upward through threshold
                crossed = crossed || (prevPct < pct && Math.floor(percent) >= pct);
            }
            if (threshold.direction === 'discharging' || threshold.direction === 'any') {
                // Crossing downward through threshold
                crossed = crossed || (prevPct > pct && Math.floor(percent) <= pct);
            }

            if (!crossed) continue;

            // Cooldown check
            const lastFired = lastAlarmMap[threshold.id] ?? 0;
            if (now - lastFired < cooldownMs) {
                console.log(`[BatteryAlarm] Threshold "${threshold.label}" suppressed (cooldown active)`);
                continue;
            }

            triggered.push(threshold);
        }

        return triggered;
    }

    recordAlarmFired(thresholdIds) {
        const map = this._getLastAlarmTimes();
        const now = Date.now();
        for (const id of thresholdIds) {
            map[id] = now;
        }
        this._settings.set_string('last-alarm-times', JSON.stringify(map));
    }

    _getThresholds() {
        try {
            return JSON.parse(this._settings.get_string('thresholds'));
        } catch (e) {
            console.error(`[BatteryAlarm] Failed to parse thresholds: ${e.message}`);
            return [];
        }
    }

    _getLastAlarmTimes() {
        try {
            return JSON.parse(this._settings.get_string('last-alarm-times'));
        } catch (_) {
            return {};
        }
    }
}

// ─── QuietHoursChecker ───────────────────────────────────────────────────────

/**
 * Determines whether the current time falls within quiet hours.
 */
class QuietHoursChecker {
    constructor(settings) {
        this._settings = settings;
    }

    isQuietNow() {
        if (!this._settings.get_boolean('quiet-hours-enabled')) return false;

        const now   = new Date();
        const nowMin = now.getHours() * 60 + now.getMinutes();

        const start = this._parseTime(this._settings.get_string('quiet-hours-start'));
        const end   = this._parseTime(this._settings.get_string('quiet-hours-end'));

        if (start <= end) {
            // Simple range: e.g., 09:00 – 17:00
            return nowMin >= start && nowMin < end;
        } else {
            // Overnight range: e.g., 22:00 – 07:00
            return nowMin >= start || nowMin < end;
        }
    }

    _parseTime(timeStr) {
        const [h, m] = timeStr.split(':').map(Number);
        return (h || 0) * 60 + (m || 0);
    }
}

// ─── Panel Indicator ─────────────────────────────────────────────────────────

const BatteryAlarmIndicator = GObject.registerClass(
class BatteryAlarmIndicator extends PanelMenu.Button {
    _init(settings, onMuteToggle) {
        super._init(0.0, _('BatteryAlarm'));

        this._settings = settings;
        this._onMuteToggle = onMuteToggle;
        this._muted = settings.get_boolean('muted');

        // ── Icon + Label box ──
        this._box = new St.BoxLayout({
            style_class: 'battery-alarm-panel-box',
            vertical: false,
        });
        this.add_child(this._box);

        this._icon = new St.Icon({
            gicon: this._getIcon(),
            style_class: 'system-status-icon battery-alarm-icon',
        });
        this._box.add_child(this._icon);

        this._label = new St.Label({
            text: '',
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'battery-alarm-panel-label',
        });
        this._box.add_child(this._label);

        // ── Menu ──
        this._buildMenu();

        // ── Settings change listener ──
        this._settingsSignal = settings.connect('changed', () => this._onSettingsChanged());
        this._updateLabelVisibility();
    }

    _buildMenu() {
        // Header: extension name
        const headerItem = new PopupMenu.PopupMenuItem(_('BatteryAlarm'), {
            reactive: false,
            style_class: 'battery-alarm-menu-header',
        });
        this.menu.addMenuItem(headerItem);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // Battery status display
        this._statusItem = new PopupMenu.PopupMenuItem('', {reactive: false});
        this.menu.addMenuItem(this._statusItem);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // Mute toggle
        this._muteSwitch = new PopupMenu.PopupSwitchMenuItem(
            _('Mute All Alarms'),
            this._muted
        );
        this._muteSwitch.connect('toggled', (_, state) => {
            this._muted = state;
            this._settings.set_boolean('muted', state);
            this._updateIcon();
            this._onMuteToggle?.(state);
        });
        this.menu.addMenuItem(this._muteSwitch);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // Open preferences
        const prefsItem = new PopupMenu.PopupMenuItem(_('Settings…'));
        prefsItem.connect('activate', () => {
            this.menu.close();
            // Extension reference is resolved at runtime
            this._openPrefs?.();
        });
        this.menu.addMenuItem(prefsItem);
    }

    updateBatteryStatus(percent, state) {
        this._currentPercent = percent;
        this._currentState   = state;

        if (this._settings.get_boolean('show-percentage-in-panel') && percent >= 0) {
            this._label.text = ` ${Math.round(percent)}%`;
        } else {
            this._label.text = '';
        }

        let stateStr = '';
        switch (state) {
        case BatteryState.CHARGING:         stateStr = _('Charging');       break;
        case BatteryState.DISCHARGING:      stateStr = _('Discharging');    break;
        case BatteryState.FULLY_CHARGED:    stateStr = _('Fully Charged');  break;
        case BatteryState.EMPTY:            stateStr = _('Empty');          break;
        case BatteryState.PENDING_CHARGE:   stateStr = _('Pending Charge'); break;
        default:                            stateStr = _('Unknown');
        }

        if (this._statusItem) {
            this._statusItem.label.text =
                percent >= 0
                    ? `🔋 ${Math.round(percent)}%  •  ${stateStr}`
                    : `🔋 ${stateStr}`;
        }
    }

    flashAlarm(thresholdLabel) {
        // Brief visual pulse on the panel icon to draw attention
        const origColor = this._icon.style;
        this._icon.add_style_class_name('battery-alarm-flash');
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1500, () => {
            this._icon.remove_style_class_name('battery-alarm-flash');
            return GLib.SOURCE_REMOVE;
        });
    }

    _onSettingsChanged() {
        this._muted = this._settings.get_boolean('muted');
        this._muteSwitch?.setToggleState(this._muted);
        this._updateIcon();
        this._updateLabelVisibility();
    }

    _updateIcon() {
        this._icon.gicon = this._getIcon();
    }

    _updateLabelVisibility() {
        const show = this._settings.get_boolean('show-percentage-in-panel');
        this._label.visible = show;
    }

    _getIcon() {
        const iconName = this._muted
            ? 'battery-alarm-muted-symbolic'
            : 'battery-alarm-symbolic';
        // Try extension icon first, fall back to system icon
        return Gio.ThemedIcon.new_with_default_fallbacks(iconName);
    }

    destroy() {
        if (this._settingsSignal) {
            this._settings.disconnect(this._settingsSignal);
            this._settingsSignal = null;
        }
        super.destroy();
    }
});

// ─── Main Extension Class ─────────────────────────────────────────────────────

export default class BatteryAlarmExtension extends Extension {
    enable() {
        console.log('[BatteryAlarm] Enabling extension…');

        this._settings = this.getSettings();
        this._extensionDir = this.path;

        // Core components
        this._monitor  = new BatteryMonitor();
        this._player   = new AlarmPlayer(this._extensionDir);
        this._checker  = new ThresholdChecker(this._settings);
        this._quietChk = new QuietHoursChecker(this._settings);

        // Previous battery state (for crossing detection)
        this._prevPercent = -1;
        this._prevState   = BatteryState.UNKNOWN;

        // Panel indicator
        this._indicator = null;
        if (this._settings.get_boolean('show-panel-indicator')) {
            this._createIndicator();
        }

        // Settings change handler (e.g., show-panel-indicator toggled)
        this._settingsChangedId = this._settings.connect(
            'changed::show-panel-indicator',
            () => this._onPanelIndicatorSettingChanged()
        );

        // Connect to battery monitor
        this._batteryChangedId = this._monitor.connect(
            'battery-changed',
            (_, percent, state) => this._onBatteryChanged(percent, state)
        );

        // Start monitoring
        this._monitor.start();

        console.log('[BatteryAlarm] Extension enabled');
    }

    disable() {
        console.log('[BatteryAlarm] Disabling extension…');

        if (this._batteryChangedId && this._monitor) {
            this._monitor.disconnect(this._batteryChangedId);
            this._batteryChangedId = null;
        }

        if (this._settingsChangedId && this._settings) {
            this._settings.disconnect(this._settingsChangedId);
            this._settingsChangedId = null;
        }

        this._monitor?.stop();
        this._player?.destroy();
        this._indicator?.destroy();

        this._monitor   = null;
        this._player    = null;
        this._checker   = null;
        this._quietChk  = null;
        this._indicator = null;
        this._settings  = null;

        console.log('[BatteryAlarm] Extension disabled');
    }

    _createIndicator() {
        this._indicator = new BatteryAlarmIndicator(
            this._settings,
            muted => console.log(`[BatteryAlarm] Mute toggled: ${muted}`)
        );
        // Expose openPrefs to indicator menu
        this._indicator._openPrefs = () => this.openPreferences();

        Main.panel.addToStatusArea('battery-alarm', this._indicator);

        // Update with current battery status
        const {percent, state} = this._monitor.getCurrentStatus();
        if (percent >= 0) {
            this._indicator.updateBatteryStatus(percent, state);
        }
    }

    _onPanelIndicatorSettingChanged() {
        const shouldShow = this._settings.get_boolean('show-panel-indicator');
        if (shouldShow && !this._indicator) {
            this._createIndicator();
        } else if (!shouldShow && this._indicator) {
            this._indicator.destroy();
            this._indicator = null;
        }
    }

    _onBatteryChanged(percent, state) {
        // Update panel indicator
        this._indicator?.updateBatteryStatus(percent, state);

        // Check thresholds (skip if first read or muted globally)
        if (this._prevPercent >= 0) {
            if (!this._settings.get_boolean('muted')) {
                this._checkThresholds(percent, state);
            }
        }

        this._prevPercent = percent;
        this._prevState   = state;
    }

    _checkThresholds(percent, state) {
        // Check quiet hours
        if (this._quietChk.isQuietNow()) {
            console.log('[BatteryAlarm] Quiet hours active — suppressing alarm check');
            return;
        }

        const triggered = this._checker.getTriggeredThresholds(
            percent, state, this._prevPercent, this._prevState
        );

        if (triggered.length === 0) return;

        for (const threshold of triggered) {
            console.log(`[BatteryAlarm] Threshold triggered: "${threshold.label}" at ${Math.round(percent)}%`);
            this._triggerAlarm(threshold, percent);
        }

        // Record all fired thresholds for cooldown
        this._checker.recordAlarmFired(triggered.map(t => t.id));
    }

    _triggerAlarm(threshold, currentPercent) {
        // Play sound
        if (this._settings.get_boolean('sound-enabled')) {
            this._player.play(
                this._settings.get_string('sound-file'),
                this._settings.get_double('alarm-volume'),
                this._settings.get_int('repeat-count'),
                this._settings.get_int('repeat-interval')
            );
        }

        // Show notification
        if (this._settings.get_boolean('notifications-enabled')) {
            this._showNotification(threshold, currentPercent);
        }

        // Flash panel icon
        this._indicator?.flashAlarm(threshold.label);
    }

    _showNotification(threshold, percent) {
        const title = threshold.label || _('Battery Alarm');
        const dirStr = threshold.direction === 'charging'
            ? _('while charging')
            : threshold.direction === 'discharging'
                ? _('while discharging')
                : '';

        const body = _(`Battery is at ${Math.round(percent)}% ${dirStr}`.trim() + '.');

        // GNOME Shell notification via Main.notify
        Main.notify(title, body);
    }
}
