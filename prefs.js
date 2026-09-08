/**
 * BatteryAlarm — GNOME Shell Extension
 * prefs.js — GTK4 / libadwaita Preferences Window
 *
 * Full settings UI for configuring battery thresholds, alarm sounds,
 * quiet hours, cooldown, and panel indicator options.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 * Copyright (C) 2024 BatteryAlarm Contributors
 */

import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import Adw from 'gi://Adw';

import {ExtensionPreferences, gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

// ─── Threshold ID generator ───────────────────────────────────────────────────

function generateId() {
    return `t${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

// ─── Threshold Row Widget ─────────────────────────────────────────────────────

const ThresholdRow = GObject.registerClass(
class ThresholdRow extends Adw.ActionRow {
    _init(threshold, onDelete, onChanged) {
        super._init();
        this._threshold = {...threshold};
        this._onChanged = onChanged;

        // Enabled toggle
        this._enabledSwitch = new Gtk.Switch({
            active: threshold.enabled,
            valign: Gtk.Align.CENTER,
        });
        this._enabledSwitch.connect('state-set', (_, state) => {
            this._threshold.enabled = state;
            this._onChanged(this._threshold);
        });
        this.add_prefix(this._enabledSwitch);

        // Label
        this._labelEntry = new Gtk.Entry({
            text: threshold.label || '',
            placeholder_text: _('Label'),
            valign: Gtk.Align.CENTER,
            hexpand: true,
            max_length: 40,
        });
        this._labelEntry.connect('changed', () => {
            this._threshold.label = this._labelEntry.text;
            this._onChanged(this._threshold);
        });
        this.add_suffix(this._labelEntry);

        // Percentage spin button
        const pctAdj = new Gtk.Adjustment({
            lower: 1, upper: 100, step_increment: 1, page_increment: 5,
            value: threshold.percent,
        });
        this._pctSpin = new Gtk.SpinButton({
            adjustment: pctAdj,
            numeric: true,
            digits: 0,
            valign: Gtk.Align.CENTER,
            tooltip_text: _('Battery percentage to trigger alarm'),
        });
        this._pctSpin.connect('value-changed', () => {
            this._threshold.percent = this._pctSpin.value;
            this._onChanged(this._threshold);
        });
        this.add_suffix(this._pctSpin);

        // Percent label
        this.add_suffix(new Gtk.Label({
            label: '%',
            valign: Gtk.Align.CENTER,
        }));

        // Direction dropdown
        const dirModel = new Gtk.StringList();
        dirModel.append(_('While Charging'));
        dirModel.append(_('While Discharging'));
        dirModel.append(_('Any Direction'));

        const dirMap = {'charging': 0, 'discharging': 1, 'any': 2};
        const dirRevMap = ['charging', 'discharging', 'any'];

        this._dirDrop = new Gtk.DropDown({
            model: dirModel,
            selected: dirMap[threshold.direction] ?? 0,
            valign: Gtk.Align.CENTER,
            tooltip_text: _('When to trigger: charging, discharging, or either'),
        });
        this._dirDrop.connect('notify::selected', () => {
            this._threshold.direction = dirRevMap[this._dirDrop.selected];
            this._onChanged(this._threshold);
        });
        this.add_suffix(this._dirDrop);

        // Delete button
        const deleteBtn = new Gtk.Button({
            icon_name: 'user-trash-symbolic',
            valign: Gtk.Align.CENTER,
            tooltip_text: _('Delete this threshold'),
            css_classes: ['destructive-action', 'flat'],
        });
        deleteBtn.connect('clicked', () => onDelete(threshold.id));
        this.add_suffix(deleteBtn);
    }

    getData() {
        return this._threshold;
    }
});

// ─── Thresholds Page ─────────────────────────────────────────────────────────

const ThresholdsPage = GObject.registerClass(
class ThresholdsPage extends Adw.PreferencesPage {
    _init(settings) {
        super._init({
            name: 'thresholds',
            title: _('Thresholds'),
            icon_name: 'alarm-symbolic',
        });

        this._settings = settings;
        this._rows     = {};

        // Main group
        this._group = new Adw.PreferencesGroup({
            title: _('Battery Alarm Thresholds'),
            description: _('Configure the battery percentage levels that will trigger an alarm. You can add up to 10 custom thresholds.'),
        });
        this.add(this._group);

        // Add threshold button
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

        // Info banner
        const banner = new Adw.Banner({
            title: _('Tip: Set a threshold near your current battery level to test alarms immediately.'),
            revealed: true,
            button_label: _('Dismiss'),
        });
        banner.connect('button-clicked', () => { banner.revealed = false; });
        const bannerGroup = new Adw.PreferencesGroup();
        bannerGroup.add(banner);
        this.add(bannerGroup);

        this._loadThresholds();
    }

    _loadThresholds() {
        // Clear existing rows
        for (const id of Object.keys(this._rows)) {
            this._group.remove(this._rows[id]);
        }
        this._rows = {};

        const thresholds = this._getThresholds();
        for (const t of thresholds) {
            this._addRow(t);
        }
    }

    _addRow(threshold) {
        const row = new ThresholdRow(
            threshold,
            (id) => this._deleteThreshold(id),
            (updated) => this._updateThreshold(updated)
        );
        this._group.add(row);
        this._rows[threshold.id] = row;
    }

    _addThreshold() {
        const thresholds = this._getThresholds();
        if (thresholds.length >= 10) {
            this._showToast(_('Maximum of 10 thresholds reached.'));
            return;
        }

        const newThreshold = {
            id:        generateId(),
            percent:   80,
            direction: 'charging',
            enabled:   true,
            label:     _('New Threshold'),
        };

        thresholds.push(newThreshold);
        this._saveThresholds(thresholds);
        this._addRow(newThreshold);
    }

    _deleteThreshold(id) {
        if (this._rows[id]) {
            this._group.remove(this._rows[id]);
            delete this._rows[id];
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
        } catch (_) {
            return [];
        }
    }

    _saveThresholds(thresholds) {
        this._settings.set_string('thresholds', JSON.stringify(thresholds));
    }

    _showToast(msg) {
        // Traverse up to find the ToastOverlay in Adw.ApplicationWindow
        const win = this.get_root?.();
        if (win && win.add_toast) {
            win.add_toast(new Adw.Toast({title: msg}));
        }
    }
});

// ─── Sound Page ───────────────────────────────────────────────────────────────

const SoundPage = GObject.registerClass(
class SoundPage extends Adw.PreferencesPage {
    _init(settings, extensionPath) {
        super._init({
            name: 'sound',
            title: _('Sound'),
            icon_name: 'audio-volume-high-symbolic',
        });

        this._settings     = settings;
        this._extensionPath = extensionPath;

        // ── Sound enabled group ──
        const enableGroup = new Adw.PreferencesGroup({
            title: _('Alarm Sound'),
        });
        this.add(enableGroup);

        const soundEnabledRow = new Adw.SwitchRow({
            title: _('Enable Alarm Sound'),
            subtitle: _('Play an audio alert when a battery threshold is reached'),
        });
        settings.bind('sound-enabled', soundEnabledRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        enableGroup.add(soundEnabledRow);

        // ── Sound file group ──
        const fileGroup = new Adw.PreferencesGroup({
            title: _('Sound File'),
            description: _('Choose a custom .ogg, .wav, or .mp3 alarm sound, or use the built-in default.'),
        });
        this.add(fileGroup);

        // Custom file row
        this._fileRow = new Adw.ActionRow({
            title: _('Custom Sound File'),
            subtitle: _('Leave empty to use the bundled default alarm chime'),
        });

        const currentFile = settings.get_string('sound-file');
        this._fileLabel = new Gtk.Label({
            label: currentFile ? GLib.path_get_basename(currentFile) : _('Default sound'),
            ellipsize: 3, // PANGO_ELLIPSIZE_END
            xalign: 0,
            hexpand: true,
            valign: Gtk.Align.CENTER,
        });
        this._fileRow.add_suffix(this._fileLabel);

        const chooseBtn = new Gtk.Button({
            label: _('Choose…'),
            valign: Gtk.Align.CENTER,
            css_classes: ['suggested-action'],
        });
        chooseBtn.connect('clicked', () => this._chooseSoundFile());
        this._fileRow.add_suffix(chooseBtn);

        const clearBtn = new Gtk.Button({
            label: _('Reset'),
            valign: Gtk.Align.CENTER,
        });
        clearBtn.connect('clicked', () => {
            settings.set_string('sound-file', '');
            this._fileLabel.label = _('Default sound');
        });
        this._fileRow.add_suffix(clearBtn);
        fileGroup.add(this._fileRow);

        // ── Volume & repeats group ──
        const playbackGroup = new Adw.PreferencesGroup({
            title: _('Playback Settings'),
        });
        this.add(playbackGroup);

        // Volume
        const volumeAdj = new Gtk.Adjustment({lower: 0, upper: 100, step_increment: 5, value: settings.get_double('alarm-volume') * 100});
        const volumeScale = new Gtk.Scale({
            adjustment: volumeAdj,
            draw_value: true,
            value_pos: Gtk.PositionType.RIGHT,
            digits: 0,
            hexpand: true,
            valign: Gtk.Align.CENTER,
        });
        volumeAdj.connect('value-changed', () => {
            settings.set_double('alarm-volume', volumeAdj.value / 100);
        });

        const volumeRow = new Adw.ActionRow({
            title: _('Volume'),
            subtitle: _('Alarm sound volume (0 = silent, 100 = full)'),
        });
        volumeRow.add_suffix(volumeScale);
        playbackGroup.add(volumeRow);

        // Repeat count
        const repeatRow = new Adw.SpinRow({
            title: _('Repeat Count'),
            subtitle: _('Number of times the alarm sound plays'),
            adjustment: new Gtk.Adjustment({lower: 1, upper: 10, step_increment: 1, value: 1}),
        });
        settings.bind('repeat-count', repeatRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        playbackGroup.add(repeatRow);

        // Repeat interval
        const intervalRow = new Adw.SpinRow({
            title: _('Repeat Interval (seconds)'),
            subtitle: _('Seconds between each repetition'),
            adjustment: new Gtk.Adjustment({lower: 1, upper: 30, step_increment: 1, value: 2}),
        });
        settings.bind('repeat-interval', intervalRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        playbackGroup.add(intervalRow);

        // ── Test sound button ──
        const testGroup = new Adw.PreferencesGroup();
        this.add(testGroup);

        const testBtn = new Gtk.Button({
            label: _('▶  Test Alarm Sound'),
            halign: Gtk.Align.CENTER,
            css_classes: ['suggested-action', 'pill'],
        });
        testBtn.connect('clicked', () => this._testSound());
        testGroup.add(testBtn);
    }

    _chooseSoundFile() {
        const dialog = new Gtk.FileDialog({
            title: _('Choose Alarm Sound File'),
            accept_label: _('Select'),
        });

        // Filter for audio files
        const filter = new Gtk.FileFilter();
        filter.set_name(_('Audio Files'));
        filter.add_mime_type('audio/ogg');
        filter.add_mime_type('audio/wav');
        filter.add_mime_type('audio/mpeg');
        filter.add_pattern('*.ogg');
        filter.add_pattern('*.wav');
        filter.add_pattern('*.mp3');
        filter.add_pattern('*.flac');

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
            } catch (_) {
                // User cancelled
            }
        });
    }

    _testSound() {
        const soundFile = this._settings.get_string('sound-file') ||
            GLib.build_filenamev([this._extensionPath, 'sounds', 'battery-alarm.ogg']);
        const volume = this._settings.get_double('alarm-volume');

        try {
            const paVolume = Math.round(volume * 65536);
            Gio.Subprocess.new(
                ['paplay', `--volume=${paVolume}`, soundFile],
                Gio.SubprocessFlags.NONE
            );
        } catch (e) {
            console.error(`[BatteryAlarm] Test sound failed: ${e.message}`);
        }
    }
});

// ─── General Page ─────────────────────────────────────────────────────────────

const GeneralPage = GObject.registerClass(
class GeneralPage extends Adw.PreferencesPage {
    _init(settings) {
        super._init({
            name: 'general',
            title: _('General'),
            icon_name: 'preferences-system-symbolic',
        });

        // ── Panel group ──
        const panelGroup = new Adw.PreferencesGroup({
            title: _('Panel Indicator'),
        });
        this.add(panelGroup);

        const showPanelRow = new Adw.SwitchRow({
            title: _('Show Panel Indicator'),
            subtitle: _('Display a BatteryAlarm icon in the top system panel'),
        });
        settings.bind('show-panel-indicator', showPanelRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        panelGroup.add(showPanelRow);

        const showPctRow = new Adw.SwitchRow({
            title: _('Show Battery Percentage in Panel'),
            subtitle: _('Display the current battery percentage next to the panel icon'),
        });
        settings.bind('show-percentage-in-panel', showPctRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        panelGroup.add(showPctRow);

        // ── Notifications group ──
        const notifGroup = new Adw.PreferencesGroup({
            title: _('Notifications'),
        });
        this.add(notifGroup);

        const notifRow = new Adw.SwitchRow({
            title: _('Show Desktop Notifications'),
            subtitle: _('Display a system notification when an alarm triggers'),
        });
        settings.bind('notifications-enabled', notifRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        notifGroup.add(notifRow);

        // ── Cooldown group ──
        const cooldownGroup = new Adw.PreferencesGroup({
            title: _('Cooldown'),
            description: _('Minimum time between successive alarms for the same threshold, to prevent repeated notifications.'),
        });
        this.add(cooldownGroup);

        const cooldownRow = new Adw.SpinRow({
            title: _('Cooldown Duration (minutes)'),
            subtitle: _('Alarms for the same threshold are silenced for this many minutes after firing'),
            adjustment: new Gtk.Adjustment({lower: 1, upper: 120, step_increment: 1, value: 5}),
        });
        settings.bind('cooldown-minutes', cooldownRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        cooldownGroup.add(cooldownRow);

        // ── Quiet hours group ──
        const quietGroup = new Adw.PreferencesGroup({
            title: _('Quiet Hours'),
            description: _('Silence all alarms during specified hours (e.g., overnight).'),
        });
        this.add(quietGroup);

        const quietEnabledRow = new Adw.SwitchRow({
            title: _('Enable Quiet Hours'),
        });
        settings.bind('quiet-hours-enabled', quietEnabledRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        quietGroup.add(quietEnabledRow);

        const quietStartRow = new Adw.EntryRow({
            title: _('Quiet Hours Start (HH:MM)'),
            text: settings.get_string('quiet-hours-start'),
            input_purpose: Gtk.InputPurpose.NUMBER,
            show_apply_button: true,
        });
        quietStartRow.connect('apply', () => {
            const val = quietStartRow.text.trim();
            if (/^\d{2}:\d{2}$/.test(val)) {
                settings.set_string('quiet-hours-start', val);
            } else {
                quietStartRow.add_css_class('error');
                GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1500, () => {
                    try {
                        quietStartRow.remove_css_class('error');
                    } catch (_) {}
                    return GLib.SOURCE_REMOVE;
                });
            }
        });
        quietGroup.add(quietStartRow);

        const quietEndRow = new Adw.EntryRow({
            title: _('Quiet Hours End (HH:MM)'),
            text: settings.get_string('quiet-hours-end'),
            input_purpose: Gtk.InputPurpose.NUMBER,
            show_apply_button: true,
        });
        quietEndRow.connect('apply', () => {
            const val = quietEndRow.text.trim();
            if (/^\d{2}:\d{2}$/.test(val)) {
                settings.set_string('quiet-hours-end', val);
            } else {
                quietEndRow.add_css_class('error');
                GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1500, () => {
                    try {
                        quietEndRow.remove_css_class('error');
                    } catch (_) {}
                    return GLib.SOURCE_REMOVE;
                });
            }
        });
        quietGroup.add(quietEndRow);

        // Bind quiet-hours toggle sensitivity to start/end rows
        settings.connect('changed::quiet-hours-enabled', () => {
            const enabled = settings.get_boolean('quiet-hours-enabled');
            quietStartRow.sensitive = enabled;
            quietEndRow.sensitive   = enabled;
        });
        const initialEnabled = settings.get_boolean('quiet-hours-enabled');
        quietStartRow.sensitive = initialEnabled;
        quietEndRow.sensitive   = initialEnabled;
    }
});

// ─── About Page ───────────────────────────────────────────────────────────────

const AboutPage = GObject.registerClass(
class AboutPage extends Adw.PreferencesPage {
    _init(metadata) {
        super._init({
            name: 'about',
            title: _('About'),
            icon_name: 'help-about-symbolic',
        });

        // ── Extension info group ──
        const infoGroup = new Adw.PreferencesGroup();
        this.add(infoGroup);

        // Extension icon + name header
        const headerBox = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 12,
            margin_top: 24,
            margin_bottom: 12,
            halign: Gtk.Align.CENTER,
        });

        const iconImage = new Gtk.Image({
            icon_name: 'battery-alarm-symbolic',
            pixel_size: 96,
            css_classes: ['about-icon'],
        });
        headerBox.append(iconImage);

        const nameLabel = new Gtk.Label({
            label: `<span size="xx-large" weight="bold">BatteryAlarm</span>`,
            use_markup: true,
        });
        headerBox.append(nameLabel);

        const versionLabel = new Gtk.Label({
            label: `<span size="small" alpha="70%">${_('Version')} ${metadata.version ?? '1'}</span>`,
            use_markup: true,
        });
        headerBox.append(versionLabel);

        const descLabel = new Gtk.Label({
            label: _('Customizable battery threshold alarms for GNOME Shell'),
            wrap: true,
            halign: Gtk.Align.CENTER,
        });
        headerBox.append(descLabel);

        const headerRow = new Adw.ActionRow();
        headerRow.set_child(headerBox);
        infoGroup.add(headerRow);

        // ── Links group ──
        const linksGroup = new Adw.PreferencesGroup({title: _('Links')});
        this.add(linksGroup);

        const links = [
            {label: _('Source Code on GitHub'),  url: metadata.url ?? '#'},
            {label: _('Report an Issue'),         url: `${metadata.url}/issues` ?? '#'},
            {label: _('GNOME Extensions Page'),   url: 'https://extensions.gnome.org'},
        ];

        for (const link of links) {
            const row = new Adw.ActionRow({
                title: link.label,
                activatable: true,
            });
            row.add_suffix(new Gtk.Image({icon_name: 'external-link-symbolic'}));
            row.connect('activated', () => {
                Gio.AppInfo.launch_default_for_uri(link.url, null);
            });
            linksGroup.add(row);
        }

        // ── License group ──
        const licenseGroup = new Adw.PreferencesGroup({title: _('License')});
        this.add(licenseGroup);

        const licenseRow = new Adw.ActionRow({
            title: 'GNU General Public License v2.0 or later',
            subtitle: _('This extension is free and open source software.'),
        });
        licenseGroup.add(licenseRow);
    }
});

// ─── Main Preferences Class ───────────────────────────────────────────────────

export default class BatteryAlarmPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        const metadata = this.metadata;

        window.set_default_size(720, 620);
        window.set_search_enabled(true);
        window.title = _('BatteryAlarm Settings');

        // Add pages
        window.add(new ThresholdsPage(settings));
        window.add(new SoundPage(settings, this.path));
        window.add(new GeneralPage(settings));
        window.add(new AboutPage(metadata));

        // Apply a toast overlay (wraps pages automatically in Adw.PreferencesWindow)
        window.can_navigate_back = true;
    }
}
