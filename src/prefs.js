import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';
import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {LayoutEditor} from './prefs/layoutEditor.js';
import {clockPicker, connectWhile, edgeRow, presetRow, quickSettingsRows, switchRow} from './prefs/widgets.js';

// This file's directory: builds/<id>/ when installed, src/ in the repo.
const HERE = GLib.path_get_dirname(GLib.filename_from_uri(import.meta.url)[0]);

export default class KeelPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        window._settings = settings;
        window.set_default_size(700, 880);
        window.search_enabled = true;

        // Stylesheet and icons, for as long as the window is open.
        const display = Gdk.Display.get_default();
        const css = new Gtk.CssProvider();
        css.load_from_path(GLib.build_filenamev([HERE, 'prefs', 'style.css']));
        Gtk.StyleContext.add_provider_for_display(display, css, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);
        Gtk.IconTheme.get_for_display(display).add_search_path(GLib.build_filenamev([HERE, 'icons']));
        window.connect('close-request', () => {
            Gtk.StyleContext.remove_provider_for_display(display, css);
            return false;
        });

        const openPage = name => {
            window.visible_page_name = name;
        };
        window.add(panelPage(settings, openPage));
        window.add(taskbarPage(settings));
        window.add(statusPage(settings));
        window.add(aboutPage(window, settings, this.metadata, this.path));
    }
}

const isVertical = settings => ['left', 'right'].includes(settings.get_string('position'));

/** Keeps widget insensitive while the bar is on the left or right. */
function horizontalOnly(settings, widget) {
    const sync = () => {
        widget.sensitive = !isVertical(settings);
    };
    connectWhile(widget, settings, 'changed::position', sync);
    sync();
}

/** Where the bar is and how big, then what's on it. */
function panelPage(settings, openPage) {
    const page = new Adw.PreferencesPage({name: 'panel', title: 'Panel', icon_name: 'keel-edge-bottom-symbolic'});

    const bar = new Adw.PreferencesGroup({title: 'Position'});
    bar.add(edgeRow(settings));
    bar.add(presetRow(settings, 'panel-height', {
        title: 'Size',
        subtitle: 'Height, or width on the left or right',
        presets: [[40, 'Small'], [48, 'Medium']],
        format: v => `${v} px`,
    }));
    page.add(bar);

    const reset = new Gtk.Button({
        icon_name: 'edit-undo-symbolic',
        tooltip_text: 'Reset layout',
        valign: Gtk.Align.CENTER,
        css_classes: ['flat', 'circular'],
    });
    reset.connect('clicked', () => settings.reset('panel-layout'));
    const layout = new Adw.PreferencesGroup({
        title: 'Layout',
        description: 'Drag items to arrange the bar. Click one to move it or open its settings.',
        header_suffix: reset,
    });
    layout.add(new LayoutEditor(settings, openPage).widget);
    page.add(layout);

    return page;
}

function taskbarPage(settings) {
    const page = new Adw.PreferencesPage({name: 'taskbar', title: 'Taskbar', icon_name: 'view-app-grid-symbolic'});

    const apps = new Adw.PreferencesGroup({title: 'Apps'});
    apps.add(switchRow(settings, 'show-apps-button', 'App grid button',
        'At the start of the taskbar'));
    apps.add(switchRow(settings, 'show-favorites', 'Pinned apps',
        'Keep favorites in the taskbar when they aren’t running'));
    apps.add(switchRow(settings, 'group-windows', 'Group windows',
        'One button per app. Off: one button per window'));
    page.add(apps);

    const look = new Adw.PreferencesGroup({title: 'Appearance'});
    look.add(presetRow(settings, 'icon-size', {
        title: 'Icon size',
        subtitle: 'Largest size; icons shrink to fit a smaller bar',
        presets: [[24, 'Small'], [32, 'Medium'], [40, 'Large']],
        format: v => `${v} px`,
    }));
    const labels = switchRow(settings, 'show-labels', 'Window labels',
        'Window title, or app name, next to the icon. Top or bottom bar only');
    horizontalOnly(settings, labels);
    look.add(labels);
    page.add(look);

    const previews = new Adw.PreferencesGroup({title: 'Window Previews'});
    const enabled = switchRow(settings, 'window-previews', 'Show on hover',
        'Live thumbnails of an app’s windows next to its button');
    previews.add(enabled);
    const delay = presetRow(settings, 'preview-delay', {
        title: 'Delay',
        subtitle: 'How long to hover before they open',
        presets: [[0, 'None'], [200, 'Short'], [400, 'Medium'], [800, 'Long']],
        format: v => `${v} ms`,
    });
    const size = presetRow(settings, 'preview-size', {
        title: 'Size',
        subtitle: 'Thumbnail width',
        presets: [[160, 'Small'], [220, 'Medium'], [320, 'Large']],
        format: v => `${v} px`,
    });
    for (const row of [delay, size]) {
        settings.bind('window-previews', row, 'sensitive', Gio.SettingsBindFlags.GET);
        previews.add(row);
    }
    page.add(previews);

    return page;
}

/** The right end of the bar: clock and Quick Settings. */
function statusPage(settings) {
    const page = new Adw.PreferencesPage({name: 'status', title: 'Clock & Status', icon_name: 'preferences-system-time-symbolic'});

    const clock = new Adw.PreferencesGroup({
        title: 'Clock',
        description: 'A bar on the left or right always shows the time over the date.',
    });
    clock.add(clockPicker(settings));
    page.add(clock);

    const quick = new Adw.PreferencesGroup({title: 'Quick Settings'});
    quickSettingsRows(settings).forEach(row => quick.add(row));
    page.add(quick);

    return page;
}

function aboutPage(window, settings, metadata, path) {
    const page = new Adw.PreferencesPage({name: 'about', title: 'About', icon_name: 'help-about-symbolic'});

    const header = new Adw.PreferencesGroup();
    const box = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        spacing: 8,
        halign: Gtk.Align.CENTER,
        margin_top: 12,
    });
    box.append(new Gtk.Image({icon_name: 'keel-logo', pixel_size: 112, margin_bottom: 4}));
    box.append(new Gtk.Label({label: metadata.name ?? 'Keel', css_classes: ['title-1']}));
    box.append(new Gtk.Label({
        label: 'One bar for the clock, Quick Settings, apps and windows.',
        css_classes: ['dim-label'],
        wrap: true,
        justify: Gtk.Justification.CENTER,
    }));
    box.append(new Gtk.Label({
        label: `Version ${metadata['version-name'] ?? metadata.version ?? '–'}`,
        halign: Gtk.Align.CENTER,
        margin_top: 4,
        css_classes: ['keel-about-version'],
    }));
    header.add(box);
    page.add(header);

    const info = new Adw.PreferencesGroup({title: 'Installation'});
    const build = readText(GLib.build_filenamev([path, 'current-build']));
    const buildRow = new Adw.ActionRow({
        title: 'Build',
        subtitle: build ? prettyBuild(build) : 'Running from the source tree',
        subtitle_selectable: true,
    });
    buildRow.add_css_class('property');
    info.add(buildRow);

    let source = null;
    try {
        source = JSON.parse(readText(GLib.build_filenamev([path, 'source.json'])) ?? 'null');
    } catch {}
    if (source?.repo) {
        const sourceRow = new Adw.ActionRow({
            title: 'Source',
            subtitle: source.commit ? `${source.repo} · ${source.commit.slice(0, 7)}` : source.repo,
            subtitle_selectable: true,
        });
        sourceRow.add_css_class('property');
        const open = new Gtk.Button({
            icon_name: 'folder-open-symbolic',
            tooltip_text: 'Open folder',
            valign: Gtk.Align.CENTER,
            css_classes: ['flat'],
        });
        open.connect('clicked', () => {
            new Gtk.FileLauncher({file: Gio.File.new_for_path(source.repo)}).launch(window, null, null);
        });
        sourceRow.add_suffix(open);
        info.add(sourceRow);
    }
    page.add(info);

    const resetGroup = new Adw.PreferencesGroup();
    const reset = new Adw.ButtonRow({title: 'Reset All Settings'});
    reset.add_css_class('destructive-action');
    reset.connect('activated', () => {
        const dialog = new Adw.AlertDialog({
            heading: 'Reset all settings?',
            body: 'Layout, position, sizes, clock and taskbar options go back to their defaults. Your pinned apps stay.',
            default_response: 'cancel',
            close_response: 'cancel',
        });
        dialog.add_response('cancel', 'Cancel');
        dialog.add_response('reset', 'Reset');
        dialog.set_response_appearance('reset', Adw.ResponseAppearance.DESTRUCTIVE);
        dialog.connect('response', (_d, response) => {
            if (response !== 'reset')
                return;
            for (const key of settings.settings_schema.list_keys())
                settings.reset(key);
            window.add_toast(new Adw.Toast({title: 'Settings reset', timeout: 3}));
        });
        dialog.present(window);
    });
    resetGroup.add(reset);
    page.add(resetGroup);

    return page;
}

function readText(file) {
    try {
        const [ok, bytes] = GLib.file_get_contents(file);
        return ok ? new TextDecoder().decode(bytes).trim() : null;
    } catch {
        return null;
    }
}

/** 20261114-210102-840022845 → "14 Nov 2026, 21:01". */
function prettyBuild(id) {
    const m = id.match(/^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})/);
    if (!m)
        return id;
    const date = GLib.DateTime.new_local(+m[1], +m[2], +m[3], +m[4], +m[5], +m[6]);
    return `${date.format('%e %b %Y, %R').trim()}  (${id})`;
}
