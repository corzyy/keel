import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Pango from 'gi://Pango';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {isVertical} from '../../lib/panel.js';

/**
 * The panel clock, per the clock-style setting:
 *
 * - gnome:   the stock label ("Sat 14 Nov 19:20") on a horizontal panel.
 * - windows: Windows 11 layout, time over the locale's short date,
 *            right-aligned ("19:20" / "14.11.2026"), in the panel's own
 *            (system) font so it still looks like GNOME.
 *
 * "Sat 14 Nov 19:20" doesn't fit across a left / right panel's column, so
 * there both styles show time over a short date, centered.
 *
 * The stock label stays (hidden) next to ours: it keeps the date menu working
 * and updates on every tick of the shell's wall clock (and on format changes),
 * so ours follows it rather than running a timer of its own.
 */
export class PanelClock {
    constructor(settings) {
        this._settings = settings;
        this._label = null;
    }

    enable() {
        this._interface = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
        this._settings.connectObject(
            'changed::clock-style', () => this._sync(),
            'changed::position', () => this._sync(),
            this);
        this._interface.connectObject(
            'changed::clock-format', () => this._update(),
            'changed::clock-show-seconds', () => this._update(),
            this);
        this._sync();
    }

    disable() {
        this._settings.disconnectObject(this);
        this._interface.disconnectObject(this);
        this._interface = null;
        this._teardown();
    }

    /** 'stock', 'vertical' or 'windows'. */
    _mode() {
        if (isVertical(this._settings))
            return 'vertical';
        return this._settings.get_string('clock-style') === 'windows' ? 'windows' : 'stock';
    }

    _sync() {
        const mode = this._mode();
        if (mode === 'stock') {
            this._teardown();
            return;
        }
        if (!this._label && !this._setup())
            return;
        const windows = mode === 'windows';
        this._label.x_align = windows ? Clutter.ActorAlign.END : Clutter.ActorAlign.CENTER;
        this._label.clutter_text.line_alignment = windows ? Pango.Alignment.RIGHT : Pango.Alignment.CENTER;
        this._label.style = windows
            ? 'text-align: right;'   // the panel's own font, size and weight, like the stock clock
            : 'font-size: 0.82em; text-align: center;';
        this._update();
    }

    _setup() {
        const display = Main.panel.statusArea.dateMenu?._clockDisplay;
        if (!display)
            return false;
        this._display = display;
        this._label = new St.Label({
            style_class: 'clock keel-clock',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._label.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
        display.get_parent().insert_child_above(this._label, display);
        display.hide();
        display.connectObject('notify::text', () => this._update(), this);
        return true;
    }

    _teardown() {
        if (!this._label)
            return;
        this._display.disconnectObject(this);
        this._display.show();
        this._label.destroy();
        this._label = this._display = null;
    }

    _update() {
        if (!this._label)
            return;
        const now = GLib.DateTime.new_now_local();
        const twelve = this._interface.get_string('clock-format') === '12h';
        if (this._mode() === 'windows') {
            const seconds = this._interface.get_boolean('clock-show-seconds') ? ':%S' : '';
            const time = now.format(twelve ? `%l:%M${seconds} %p` : `%H:%M${seconds}`).trim();
            // %x: the locale's short date, as Windows shows it (14.11.2026, 11/14/26...).
            this._label.text = `${time}\n${now.format('%x')}`;
        } else {
            const time = now.format(twelve ? '%l:%M' : '%H:%M').trim();
            this._label.text = `${time}\n${now.format('%d.%m.')}`;
        }
    }
}
