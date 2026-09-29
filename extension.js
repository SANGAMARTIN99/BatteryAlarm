/**
 * BatteryAlarm — GNOME Shell Extension
 *
 * Monitors battery status via UPower DBus and plays alarm sounds
 * when configured charge thresholds are reached.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
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

const UPOWER_DBUS_NAME = 'org.freedesktop.UPower';
const UPOWER_DISPLAY_DEVICE = '/org/freedesktop/UPower/devices/DisplayDevice';

const BatteryState = {
    UNKNOWN: 0,
    CHARGING: 1,
    DISCHARGING: 2,
    EMPTY: 3,
    FULLY_CHARGED: 4,
    PENDING_CHARGE: 5,
    PENDING_DISCHARGE: 6,
};

const UPowerDeviceInterface = `
<node>
  <interface name="org.freedesktop.UPower.Device">
    <property name="State" type="u" access="read"/>
    <property name="Percentage" type="d" access="read"/>
    <signal name="Changed"/>
  </interface>
</node>`;

const UPowerDeviceProxy = Gio.DBusProxy.makeProxyWrapper(UPowerDeviceInterface);

class VisualAlert {
    constructor(color, durationSec) {
        this._color = color || '#00CC66';
        this._duration = durationSec;
        this._actor = null;
        this._pulseTimer = null;
        this._stopTimer = null;
        this._pulseState = false;
    }

    start() {
        const monitor = Main.layoutManager.primaryMonitor;
        if (!monitor)
            return;

        this._actor = new St.Widget({
            style: `border: 6px solid ${this._color}; background-color: transparent;`,
            reactive: false,
            can_focus: false,
            opacity: 0,
        });
        this._actor.set_position(monitor.x, monitor.y);
        this._actor.set_size(monitor.width, monitor.height);
        Main.layoutManager.addChrome(this._actor, {trackFullscreen: true});

        this._pulseTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
            if (!this._actor)
                return GLib.SOURCE_REMOVE;

            this._pulseState = !this._pulseState;
            this._actor.ease({
                opacity: this._pulseState ? 220 : 0,
                duration: 350,
                mode: Clutter.AnimationMode.EASE_IN_OUT_SINE,
            });
            return GLib.SOURCE_CONTINUE;
        });

        if (this._duration > 0) {
            this._stopTimer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, this._duration, () => {
                this.stop();
                return GLib.SOURCE_REMOVE;
            });
        }
    }

    stop() {
        if (this._stopTimer) {
            GLib.source_remove(this._stopTimer);
            this._stopTimer = null;
        }
        if (this._pulseTimer) {
            GLib.source_remove(this._pulseTimer);
            this._pulseTimer = null;
        }
        if (this._actor) {
            Main.layoutManager.removeChrome(this._actor);
            this._actor.destroy();
            this._actor = null;
        }
    }
}

const BatteryAlarmIndicator = GObject.registerClass(
class BatteryAlarmIndicator extends PanelMenu.Button {
    _init(settings, onOpenPrefs) {
        super._init(0.0, _('BatteryAlarm'));

        this._settings = settings;
        this._onOpenPrefs = onOpenPrefs;
        this._onStopAlarm = null;
        this._flashTimeout = null;

        const box = new St.BoxLayout({
            style_class: 'battery-alarm-panel-box',
            vertical: false,
        });
        this.add_child(box);

        this._icon = new St.Icon({
            gicon: this._getIcon(),
            style_class: 'system-status-icon battery-alarm-icon',
        });
        box.add_child(this._icon);

        this._label = new St.Label({
            text: '',
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'battery-alarm-panel-label',
        });
        box.add_child(this._label);

        this._buildMenu();

        this._settingsChangedId = this._settings.connect('changed', () => this._onSettingsChanged());
        this._updateLabelVisibility();
    }

    _buildMenu() {
        const header = new PopupMenu.PopupMenuItem(_('BatteryAlarm'), {reactive: false});
        this.menu.addMenuItem(header);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        this._statusItem = new PopupMenu.PopupMenuItem('', {reactive: false});
        this.menu.addMenuItem(this._statusItem);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        this._stopItem = new PopupMenu.PopupMenuItem(_('Stop Alarm Now'));
        this._stopItem.connect('activate', () => {
            this.menu.close();
            this._onStopAlarm?.();
        });
        this._stopItem.actor.hide();
        this.menu.addMenuItem(this._stopItem);

        this._stopSeparator = new PopupMenu.PopupSeparatorMenuItem();
        this._stopSeparator.actor.hide();
        this.menu.addMenuItem(this._stopSeparator);

        const muted = this._settings.get_boolean('muted');
        this._muteSwitch = new PopupMenu.PopupSwitchMenuItem(_('Mute All Alarms'), muted);
        this._muteSwitch.connect('toggled', (_, state) => {
            this._settings.set_boolean('muted', state);
        });
        this.menu.addMenuItem(this._muteSwitch);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        const prefsItem = new PopupMenu.PopupMenuItem(_('Settings…'));
        prefsItem.connect('activate', () => {
            this.menu.close();
            this._onOpenPrefs?.();
        });
        this.menu.addMenuItem(prefsItem);
    }

    showStopButton(callback) {
        this._onStopAlarm = callback;
        this._stopItem.actor.show();
        this._stopSeparator.actor.show();
    }

    hideStopButton() {
        this._onStopAlarm = null;
        this._stopItem.actor.hide();
        this._stopSeparator.actor.hide();
    }

    updateBatteryStatus(percent, state) {
        if (this._settings.get_boolean('show-percentage-in-panel') && percent >= 0)
            this._label.text = ` ${Math.round(percent)}%`;
        else
            this._label.text = '';

        let stateStr;
        switch (state) {
        case BatteryState.CHARGING:
            stateStr = _('Charging');
            break;
        case BatteryState.DISCHARGING:
            stateStr = _('Discharging');
            break;
        case BatteryState.FULLY_CHARGED:
            stateStr = _('Fully Charged');
            break;
        case BatteryState.EMPTY:
            stateStr = _('Empty');
            break;
        case BatteryState.PENDING_CHARGE:
            stateStr = _('Pending Charge');
            break;
        default:
            stateStr = _('Unknown');
        }

        const pctText = percent >= 0 ? `${Math.round(percent)}%` : '--%';
        this._statusItem.label.text = `${pctText} • ${stateStr}`;
    }

    flashIcon() {
        if (!this._icon)
            return;

        if (this._flashTimeout) {
            GLib.source_remove(this._flashTimeout);
            this._flashTimeout = null;
        }

        this._icon.add_style_class_name('battery-alarm-flash');
        this._flashTimeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1500, () => {
            if (this._icon)
                this._icon.remove_style_class_name('battery-alarm-flash');
            this._flashTimeout = null;
            return GLib.SOURCE_REMOVE;
        });
    }

    _onSettingsChanged() {
        const muted = this._settings.get_boolean('muted');
        this._muteSwitch?.setToggleState(muted);
        this._icon.gicon = this._getIcon();
        this._updateLabelVisibility();
    }

    _updateLabelVisibility() {
        this._label.visible = this._settings.get_boolean('show-percentage-in-panel');
    }

    _getIcon() {
        const iconName = this._settings.get_boolean('muted')
            ? 'battery-alarm-muted-symbolic'
            : 'battery-alarm-symbolic';
        return Gio.ThemedIcon.new_with_default_fallbacks(iconName);
    }

    destroy() {
        if (this._flashTimeout) {
            GLib.source_remove(this._flashTimeout);
            this._flashTimeout = null;
        }
        if (this._settingsChangedId) {
            this._settings.disconnect(this._settingsChangedId);
            this._settingsChangedId = null;
        }
        super.destroy();
    }
});

export default class BatteryAlarmExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._lastAlarmTimes = new Map();
        this._alarmActive = false;
        this._prevPercent = -1;
        this._prevState = BatteryState.UNKNOWN;
        this._soundTimerId = null;
        this._soundCancellable = null;
        this._visualAlert = null;
        this._indicator = null;

        if (this._settings.get_boolean('show-panel-indicator'))
            this._createIndicator();

        this._panelSettingId = this._settings.connect(
            'changed::show-panel-indicator',
            () => this._syncIndicatorVisibility()
        );

        this._proxy = new UPowerDeviceProxy(
            Gio.DBus.system,
            UPOWER_DBUS_NAME,
            UPOWER_DISPLAY_DEVICE,
            (proxy, error) => {
                if (error) {
                    console.error(`BatteryAlarm: Failed to connect to UPower: ${error.message}`);
                    return;
                }
                this._onBatteryChanged();
            }
        );

        this._propChangedId = this._proxy.connect(
            'g-properties-changed',
            () => this._onBatteryChanged()
        );
    }

    disable() {
        this._stopActiveAlarm();

        if (this._propChangedId && this._proxy) {
            this._proxy.disconnect(this._propChangedId);
            this._propChangedId = null;
        }
        this._proxy = null;

        if (this._panelSettingId && this._settings) {
            this._settings.disconnect(this._panelSettingId);
            this._panelSettingId = null;
        }

        if (this._indicator) {
            this._indicator.destroy();
            this._indicator = null;
        }

        this._lastAlarmTimes.clear();
        this._settings = null;
    }

    _createIndicator() {
        this._indicator = new BatteryAlarmIndicator(
            this._settings,
            () => this.openPreferences()
        );
        Main.panel.addToStatusArea('battery-alarm', this._indicator);

        if (this._proxy) {
            const percent = this._proxy.Percentage ?? -1;
            const state = this._proxy.State ?? BatteryState.UNKNOWN;
            this._indicator.updateBatteryStatus(percent, state);
        }
    }

    _syncIndicatorVisibility() {
        const show = this._settings.get_boolean('show-panel-indicator');
        if (show && !this._indicator) {
            this._createIndicator();
        } else if (!show && this._indicator) {
            this._indicator.destroy();
            this._indicator = null;
        }
    }

    _onBatteryChanged() {
        if (!this._proxy)
            return;

        const percent = this._proxy.Percentage ?? -1;
        const state = this._proxy.State ?? BatteryState.UNKNOWN;

        this._indicator?.updateBatteryStatus(percent, state);

        // Auto-silence when charger is disconnected
        if (this._alarmActive &&
            this._settings.get_boolean('stop-alarm-on-unplug') &&
            this._prevState !== BatteryState.DISCHARGING &&
            this._prevState !== BatteryState.UNKNOWN &&
            (state === BatteryState.DISCHARGING || state === BatteryState.PENDING_DISCHARGE)) {
            this._stopActiveAlarm();
        }

        if (this._prevPercent >= 0 && !this._settings.get_boolean('muted'))
            this._evaluateThresholds(percent, state);

        this._prevPercent = percent;
        this._prevState = state;
    }

    _evaluateThresholds(percent, state) {
        if (this._isQuietTime())
            return;

        let thresholds = [];
        try {
            thresholds = JSON.parse(this._settings.get_string('thresholds'));
        } catch {
            return;
        }

        const now = Date.now();
        const cooldownMs = this._settings.get_int('cooldown-minutes') * 60_000;
        const isCharging = state === BatteryState.CHARGING || state === BatteryState.PENDING_CHARGE;
        const isDischarging = state === BatteryState.DISCHARGING ||
                              state === BatteryState.PENDING_DISCHARGE ||
                              state === BatteryState.EMPTY;

        for (const threshold of thresholds) {
            if (!threshold.enabled)
                continue;

            const dirMatch = (threshold.direction === 'charging' && isCharging) ||
                             (threshold.direction === 'discharging' && isDischarging) ||
                             (threshold.direction === 'any');
            if (!dirMatch)
                continue;

            let crossed = false;
            if (threshold.direction === 'charging' || threshold.direction === 'any')
                crossed = crossed || (this._prevPercent < threshold.percent && Math.floor(percent) >= threshold.percent);

            if (threshold.direction === 'discharging' || threshold.direction === 'any')
                crossed = crossed || (this._prevPercent > threshold.percent && Math.floor(percent) <= threshold.percent);

            if (!crossed)
                continue;

            const lastFired = this._lastAlarmTimes.get(threshold.id) ?? 0;
            if (now - lastFired < cooldownMs)
                continue;

            this._lastAlarmTimes.set(threshold.id, now);
            this._triggerAlarm(threshold, percent);
        }
    }

    _triggerAlarm(threshold, percent) {
        this._alarmActive = true;

        if (this._settings.get_boolean('notifications-enabled')) {
            const title = threshold.label || _('Battery Alarm');
            const directionText = threshold.direction === 'charging'
                ? _('while charging')
                : threshold.direction === 'discharging'
                    ? _('while discharging')
                    : '';
            const body = `${_('Battery is at')} ${Math.round(percent)}% ${directionText}.`.trim();
            Main.notify(title, body);
        }

        if (this._settings.get_boolean('sound-enabled'))
            this._playSound();

        this._indicator?.flashIcon();

        if (this._settings.get_boolean('visual-alert-enabled')) {
            this._visualAlert?.stop();
            const color = this._settings.get_string('visual-alert-color');
            const duration = this._settings.get_int('visual-alert-duration');
            this._visualAlert = new VisualAlert(color, duration);
            this._visualAlert.start();
        }

        this._indicator?.showStopButton(() => this._stopActiveAlarm());
    }

    _playSound() {
        this._stopSound();

        const customPath = this._settings.get_string('sound-file');
        const defaultPath = GLib.build_filenamev([this.path, 'sounds', 'battery-alarm.ogg']);
        const soundPath = customPath && GLib.file_test(customPath, GLib.FileTest.EXISTS)
            ? customPath
            : defaultPath;

        const file = Gio.File.new_for_path(soundPath);
        const repeatCount = this._settings.get_int('repeat-count');
        const repeatInterval = this._settings.get_int('repeat-interval');
        const player = global.display.get_sound_player();
        let played = 0;

        const playOnce = () => {
            this._soundCancellable = new Gio.Cancellable();
            player.play_from_file(file, 'Battery Alarm', this._soundCancellable);
            played++;

            if (played < repeatCount) {
                this._soundTimerId = GLib.timeout_add_seconds(
                    GLib.PRIORITY_DEFAULT,
                    repeatInterval,
                    () => {
                        this._soundTimerId = null;
                        playOnce();
                        return GLib.SOURCE_REMOVE;
                    }
                );
            }
        };

        playOnce();
    }

    _stopSound() {
        if (this._soundTimerId) {
            GLib.source_remove(this._soundTimerId);
            this._soundTimerId = null;
        }
        if (this._soundCancellable) {
            this._soundCancellable.cancel();
            this._soundCancellable = null;
        }
    }

    _stopActiveAlarm() {
        this._alarmActive = false;
        this._stopSound();

        if (this._visualAlert) {
            this._visualAlert.stop();
            this._visualAlert = null;
        }

        this._indicator?.hideStopButton();
    }

    _isQuietTime() {
        if (!this._settings.get_boolean('quiet-hours-enabled'))
            return false;

        const now = new Date();
        const currentMinutes = now.getHours() * 60 + now.getMinutes();

        const parseTime = str => {
            const [h, m] = (str || '').split(':').map(Number);
            return (h || 0) * 60 + (m || 0);
        };

        const start = parseTime(this._settings.get_string('quiet-hours-start'));
        const end = parseTime(this._settings.get_string('quiet-hours-end'));

        return start <= end
            ? currentMinutes >= start && currentMinutes < end
            : currentMinutes >= start || currentMinutes < end;
    }
}
