/**
 * BatteryAlarm — Preferences
 *
 * GTK4 / libadwaita settings dialog for configuring battery thresholds,
 * alarm sounds, notifications, quiet hours, and panel indicators.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gio from 'gi://Gio';
import Gdk from 'gi://Gdk';
import Gtk from 'gi://Gtk';
import Adw from 'gi://Adw';
import GSound from 'gi://GSound';
import {ExtensionPreferences, gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

const ThresholdRow = GObject.registerClass(
class ThresholdRow extends Adw.ActionRow {
    _init(threshold, onDelete, onChanged) {
        super._init();

        this._threshold = {...threshold};
        this._onChanged = onChanged;

        this._enabledSwitch = new Gtk.Switch({
            active: threshold.enabled,
            valign: Gtk.Align.CENTER,
        });
        this._enabledSwitch.connect('state-set', (_, state) => {
            this._threshold.enabled = state;
            this._onChanged(this._threshold);
        });
        this.add_prefix(this._enabledSwitch);

        this._labelEntry = new Gtk.Entry({
            text: threshold.label || '',
            placeholder_text: _('Label'),
            valign: Gtk.Align.CENTER,
            hexpand: true,
            max_length: 30,
        });
        this._labelEntry.connect('changed', () => {
            this._threshold.label = this._labelEntry.text;
            this._onChanged(this._threshold);
        });
        this.add_suffix(this._labelEntry);

        const pctAdj = new Gtk.Adjustment({
            lower: 1,
            upper: 100,
            step_increment: 1,
            page_increment: 5,
            value: threshold.percent,
        });
        this._pctSpin = new Gtk.SpinButton({
            adjustment: pctAdj,
            numeric: true,
            digits: 0,
            valign: Gtk.Align.CENTER,
        });
        this._pctSpin.connect('value-changed', () => {
            this._threshold.percent = this._pctSpin.value;
            this._onChanged(this._threshold);
        });
        this.add_suffix(this._pctSpin);

        this.add_suffix(new Gtk.Label({label: '%', valign: Gtk.Align.CENTER}));

        const dirModel = new Gtk.StringList();
        dirModel.append(_('While Charging'));
        dirModel.append(_('While Discharging'));
        dirModel.append(_('Any Direction'));

        const dirMap = {'charging': 0, 'discharging': 1, 'any': 2};
        const dirRevMap = ['charging', 'discharging', 'any'];

        const dirDrop = new Gtk.DropDown({
            model: dirModel,
            selected: dirMap[threshold.direction] ?? 0,
            valign: Gtk.Align.CENTER,
        });
        dirDrop.connect('notify::selected', () => {
            this._threshold.direction = dirRevMap[dirDrop.selected];
            this._onChanged(this._threshold);
        });
        this.add_suffix(dirDrop);

        const deleteBtn = new Gtk.Button({
            icon_name: 'user-trash-symbolic',
            valign: Gtk.Align.CENTER,
            css_classes: ['destructive-action', 'flat'],
        });
        deleteBtn.connect('clicked', () => onDelete(threshold.id));
        this.add_suffix(deleteBtn);
    }
});

const ThresholdsPage = GObject.registerClass(
class ThresholdsPage extends Adw.PreferencesPage {
    _init(settings) {
        super._init({
            name: 'thresholds',
            title: _('Thresholds'),
            icon_name: 'alarm-symbolic',
        });

        this._settings = settings;
        this._rows = new Map();

        this._group = new Adw.PreferencesGroup({
            title: _('Battery Thresholds'),
            description: _('Configure battery percentage levels that trigger an alarm.'),
        });
        this.add(this._group);

        const addBtn = new Gtk.Button({
            label: _('Add Threshold'),
            halign: Gtk.Align.CENTER,
            margin_top: 12,
            css_classes: ['suggested-action', 'pill'],
        });
        addBtn.connect('clicked', () => this._addThreshold());

        const addGroup = new Adw.PreferencesGroup();
        addGroup.add(addBtn);
        this.add(addGroup);

        this._loadThresholds();
    }

    _loadThresholds() {
        for (const row of this._rows.values())
            this._group.remove(row);
        this._rows.clear();

        const thresholds = this._getThresholds();
        for (const t of thresholds)
            this._addRow(t);
    }

    _addRow(threshold) {
        const row = new ThresholdRow(
            threshold,
            id => this._deleteThreshold(id),
            updated => this._updateThreshold(updated)
        );
        this._group.add(row);
        this._rows.set(threshold.id, row);
    }

    _addThreshold() {
        const thresholds = this._getThresholds();
        if (thresholds.length >= 10)
            return;

        const newThreshold = {
            id: `t_${Date.now().toString(36)}`,
            percent: 80,
            direction: 'charging',
            enabled: true,
            label: _('New Threshold'),
        };

        thresholds.push(newThreshold);
        this._saveThresholds(thresholds);
        this._addRow(newThreshold);
    }

    _deleteThreshold(id) {
        const row = this._rows.get(id);
        if (row) {
            this._group.remove(row);
            this._rows.delete(id);
        }
        const thresholds = this._getThresholds().filter(t => t.id !== id);
        this._saveThresholds(thresholds);
    }

    _updateThreshold(updated) {
        const thresholds = this._getThresholds().map(t =>
            t.id === updated.id ? updated : t
        );
        this._saveThresholds(thresholds);
    }

    _getThresholds() {
        try {
            return JSON.parse(this._settings.get_string('thresholds'));
        } catch {
            return [];
        }
    }

    _saveThresholds(thresholds) {
        this._settings.set_string('thresholds', JSON.stringify(thresholds));
    }
});

const SoundPage = GObject.registerClass(
class SoundPage extends Adw.PreferencesPage {
    _init(settings, extensionPath) {
        super._init({
            name: 'sound',
            title: _('Sound & Alerts'),
            icon_name: 'audio-volume-high-symbolic',
        });

        this._settings = settings;
        this._extensionPath = extensionPath;

        // Sound settings group
        const soundGroup = new Adw.PreferencesGroup({
            title: _('Sound Alert'),
        });
        this.add(soundGroup);

        const soundEnabledRow = new Adw.SwitchRow({
            title: _('Enable Alarm Sound'),
            subtitle: _('Play audio when a threshold is triggered'),
        });
        settings.bind('sound-enabled', soundEnabledRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        soundGroup.add(soundEnabledRow);

        const stopOnUnplugRow = new Adw.SwitchRow({
            title: _('Stop Alarm on Unplug'),
            subtitle: _('Silence alarm immediately when charger is disconnected'),
        });
        settings.bind('stop-alarm-on-unplug', stopOnUnplugRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        soundGroup.add(stopOnUnplugRow);

        // Sound file selection
        const fileRow = new Adw.ActionRow({
            title: _('Alarm Sound File'),
            subtitle: _('Custom audio file (.ogg, .wav, .mp3) or built-in default'),
        });

        const currentFile = settings.get_string('sound-file');
        this._fileLabel = new Gtk.Label({
            label: currentFile ? GLib.path_get_basename(currentFile) : _('Default chime'),
            valign: Gtk.Align.CENTER,
            hexpand: true,
            xalign: 0,
        });
        fileRow.add_suffix(this._fileLabel);

        const chooseBtn = new Gtk.Button({
            label: _('Choose…'),
            valign: Gtk.Align.CENTER,
        });
        chooseBtn.connect('clicked', () => this._chooseFile());
        fileRow.add_suffix(chooseBtn);

        const resetBtn = new Gtk.Button({
            label: _('Reset'),
            valign: Gtk.Align.CENTER,
        });
        resetBtn.connect('clicked', () => {
            settings.set_string('sound-file', '');
            this._fileLabel.label = _('Default chime');
        });
        fileRow.add_suffix(resetBtn);
        soundGroup.add(fileRow);

        const repeatRow = new Adw.SpinRow({
            title: _('Repeat Count'),
            adjustment: new Gtk.Adjustment({lower: 1, upper: 10, step_increment: 1, value: 3}),
        });
        settings.bind('repeat-count', repeatRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        soundGroup.add(repeatRow);

        const intervalRow = new Adw.SpinRow({
            title: _('Repeat Interval (seconds)'),
            adjustment: new Gtk.Adjustment({lower: 1, upper: 30, step_increment: 1, value: 2}),
        });
        settings.bind('repeat-interval', intervalRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        soundGroup.add(intervalRow);

        const testBtn = new Gtk.Button({
            label: _('Test Sound'),
            halign: Gtk.Align.CENTER,
            margin_top: 8,
            css_classes: ['pill'],
        });
        testBtn.connect('clicked', () => this._testSound());
        soundGroup.add(testBtn);

        // Notifications group
        const notifGroup = new Adw.PreferencesGroup({
            title: _('Notifications'),
        });
        this.add(notifGroup);

        const notifRow = new Adw.SwitchRow({
            title: _('Desktop Notifications'),
            subtitle: _('Display a system notification when an alarm triggers'),
        });
        settings.bind('notifications-enabled', notifRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        notifGroup.add(notifRow);

        // Visual alert group
        const visualGroup = new Adw.PreferencesGroup({
            title: _('Screen Flash Alert'),
            description: _('Flash the screen edges when an alarm is triggered.'),
        });
        this.add(visualGroup);

        const visualEnabledRow = new Adw.SwitchRow({
            title: _('Enable Screen Flash'),
        });
        settings.bind('visual-alert-enabled', visualEnabledRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        visualGroup.add(visualEnabledRow);

        const colorRow = new Adw.ActionRow({
            title: _('Flash Color'),
        });
        const storedColor = settings.get_string('visual-alert-color') || '#00CC66';
        let colorBtn;
        try {
            const rgba = new Gdk.RGBA();
            rgba.parse(storedColor);
            colorBtn = new Gtk.ColorDialogButton({
                dialog: new Gtk.ColorDialog({with_alpha: false}),
                rgba,
                valign: Gtk.Align.CENTER,
            });
            colorBtn.connect('notify::rgba', () => {
                const c = colorBtn.rgba;
                const toHex = val => Math.round(val * 255).toString(16).padStart(2, '0');
                settings.set_string('visual-alert-color', `#${toHex(c.red)}${toHex(c.green)}${toHex(c.blue)}`.toUpperCase());
            });
        } catch {
            colorBtn = new Gtk.Entry({
                text: storedColor,
                valign: Gtk.Align.CENTER,
            });
            colorBtn.connect('changed', () => {
                if (/^#[0-9A-Fa-f]{6}$/.test(colorBtn.text.trim()))
                    settings.set_string('visual-alert-color', colorBtn.text.trim().toUpperCase());
            });
        }
        colorRow.add_suffix(colorBtn);
        visualGroup.add(colorRow);

        const durationRow = new Adw.SpinRow({
            title: _('Flash Duration (seconds)'),
            subtitle: _('Set to 0 to flash until alarm is stopped'),
            adjustment: new Gtk.Adjustment({lower: 0, upper: 300, step_increment: 5, value: 30}),
        });
        settings.bind('visual-alert-duration', durationRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        visualGroup.add(durationRow);
    }

    _chooseFile() {
        const dialog = new Gtk.FileDialog({
            title: _('Select Alarm Sound File'),
        });

        const filter = new Gtk.FileFilter();
        filter.set_name(_('Audio Files'));
        filter.add_mime_type('audio/ogg');
        filter.add_mime_type('audio/wav');
        filter.add_mime_type('audio/mpeg');
        filter.add_pattern('*.ogg');
        filter.add_pattern('*.wav');
        filter.add_pattern('*.mp3');

        const filters = new Gio.ListStore({item_type: Gtk.FileFilter.$gtype});
        filters.append(filter);
        dialog.filters = filters;

        dialog.open(this.get_root(), null, (dlg, res) => {
            try {
                const file = dlg.open_finish(res);
                if (file) {
                    const path = file.get_path();
                    this._settings.set_string('sound-file', path);
                    this._fileLabel.label = GLib.path_get_basename(path);
                }
            } catch {
                // User cancelled dialog
            }
        });
    }

    _testSound() {
        const soundSetting = this._settings.get_string('sound-file');
        const defaultSound = GLib.build_filenamev([this._extensionPath, 'sounds', 'battery-alarm.ogg']);
        const soundPath = soundSetting || defaultSound;

        try {
            const ctx = new GSound.Context();
            ctx.init(null);
            ctx.play_simple({
                [GSound.ATTR_MEDIA_FILENAME]: soundPath,
                [GSound.ATTR_MEDIA_ROLE]: 'alarm',
            }, null);
        } catch {
            // Ignore preview playback errors
        }
    }
});

const GeneralPage = GObject.registerClass(
class GeneralPage extends Adw.PreferencesPage {
    _init(settings) {
        super._init({
            name: 'general',
            title: _('General'),
            icon_name: 'preferences-system-symbolic',
        });

        // Panel indicator group
        const panelGroup = new Adw.PreferencesGroup({
            title: _('Panel Indicator'),
        });
        this.add(panelGroup);

        const showPanelRow = new Adw.SwitchRow({
            title: _('Show Panel Indicator'),
            subtitle: _('Display battery icon in top panel'),
        });
        settings.bind('show-panel-indicator', showPanelRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        panelGroup.add(showPanelRow);

        const showPctRow = new Adw.SwitchRow({
            title: _('Show Percentage in Panel'),
            subtitle: _('Display battery percentage next to the icon'),
        });
        settings.bind('show-percentage-in-panel', showPctRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        panelGroup.add(showPctRow);

        // Cooldown group
        const cooldownGroup = new Adw.PreferencesGroup({
            title: _('Cooldown'),
        });
        this.add(cooldownGroup);

        const cooldownRow = new Adw.SpinRow({
            title: _('Cooldown Period (minutes)'),
            subtitle: _('Minimum time before re-triggering the same threshold'),
            adjustment: new Gtk.Adjustment({lower: 1, upper: 120, step_increment: 1, value: 5}),
        });
        settings.bind('cooldown-minutes', cooldownRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        cooldownGroup.add(cooldownRow);

        // Quiet hours group
        const quietGroup = new Adw.PreferencesGroup({
            title: _('Quiet Hours'),
            description: _('Suppress alarms during specified hours.'),
        });
        this.add(quietGroup);

        const quietEnabledRow = new Adw.SwitchRow({
            title: _('Enable Quiet Hours'),
        });
        settings.bind('quiet-hours-enabled', quietEnabledRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        quietGroup.add(quietEnabledRow);

        const startRow = new Adw.EntryRow({
            title: _('Start Time (HH:MM)'),
            text: settings.get_string('quiet-hours-start'),
            show_apply_button: true,
        });
        startRow.connect('apply', () => {
            const val = startRow.text.trim();
            if (/^\d{2}:\d{2}$/.test(val))
                settings.set_string('quiet-hours-start', val);
        });
        quietGroup.add(startRow);

        const endRow = new Adw.EntryRow({
            title: _('End Time (HH:MM)'),
            text: settings.get_string('quiet-hours-end'),
            show_apply_button: true,
        });
        endRow.connect('apply', () => {
            const val = endRow.text.trim();
            if (/^\d{2}:\d{2}$/.test(val))
                settings.set_string('quiet-hours-end', val);
        });
        quietGroup.add(endRow);
    }
});

export default class BatteryAlarmPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        window.set_default_size(680, 580);
        window.set_search_enabled(true);
        window.title = _('BatteryAlarm Settings');

        window.add(new ThresholdsPage(settings));
        window.add(new SoundPage(settings, this.path));
        window.add(new GeneralPage(settings));
    }
}
