import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';

// Building blocks for the Keel settings window. Everything here binds straight
// to GSettings, so the shell side picks up each change right away.

export function switchRow(settings, key, title, subtitle = '') {
    const row = new Adw.SwitchRow({title, subtitle});
    settings.bind(key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
    return row;
}

/** Connects to a settings signal for as long as `widget` lives. */
export function connectWhile(widget, settings, signal, callback) {
    const id = settings.connect(signal, callback);
    widget.connect('destroy', () => settings.disconnect(id));
    return id;
}

/**
 * A row with a few preset values for an integer key, as a toggle group.
 * presets are [value, label] pairs; format(value) is shown as each toggle's
 * tooltip. A value set elsewhere that matches no preset leaves all toggles off.
 */
export function presetRow(settings, key, {title, subtitle = '', presets, format}) {
    const row = new Adw.ActionRow({title, subtitle});
    const group = new Adw.ToggleGroup({valign: Gtk.Align.CENTER, css_classes: ['round']});
    for (const [value, label] of presets)
        group.add(new Adw.Toggle({name: String(value), label, tooltip: format(value)}));
    row.add_suffix(group);

    const sync = () => {
        const value = settings.get_int(key);
        const preset = presets.some(([v]) => v === value);
        if (preset && group.active_name !== String(value))
            group.active_name = String(value);
        else if (!preset)
            group.active = Gtk.INVALID_LIST_POSITION;
    };
    group.connect('notify::active-name', () => {
        const name = group.active_name;
        if (name && Number(name) !== settings.get_int(key))
            settings.set_int(key, Number(name));
    });
    connectWhile(row, settings, `changed::${key}`, sync);
    sync();
    return row;
}

/** The screen edge as four icon toggles. */
export function edgeRow(settings) {
    const row = new Adw.ActionRow({
        title: 'Screen edge',
    });
    const group = new Adw.ToggleGroup({valign: Gtk.Align.CENTER, css_classes: ['round']});
    for (const [name, tooltip] of [['bottom', 'Bottom'], ['top', 'Top'], ['left', 'Left'], ['right', 'Right']]) {
        group.add(new Adw.Toggle({
            name,
            tooltip,
            icon_name: `keel-edge-${name}-symbolic`,
        }));
    }
    settings.bind('position', group, 'active-name', Gio.SettingsBindFlags.DEFAULT);
    row.add_suffix(group);
    return row;
}

/** The clock as the panel shows it: [time, date] for the given style. */
function clockText(style) {
    const now = GLib.DateTime.new_now_local();
    const interface_ = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
    const twelveHour = interface_.get_string('clock-format') === '12h';
    const time = now.format(twelveHour ? '%l:%M %p' : '%R').trim();
    if (style === 'windows')
        return [time, now.format('%x')];
    // The stock clock: weekday, day and month, then the time.
    return [`${now.format('%a %e %b').replace(/\s+/g, ' ')}  ${time}`, null];
}

/** A dark sample of the bar's clock area for one clock style. */
function clockSample(style) {
    const bar = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        valign: Gtk.Align.CENTER,
        halign: Gtk.Align.FILL,
        css_classes: ['keel-sample-bar'],
    });
    const [time, date] = clockText(style);
    const align = style === 'windows' ? 1 : 0.5;
    bar.append(new Gtk.Label({label: time, xalign: align, css_classes: ['keel-clock-time']}));
    if (date)
        bar.append(new Gtk.Label({label: date, xalign: align, css_classes: ['keel-clock-date']}));
    return bar;
}

/** Two cards, one per clock style, that preview how the panel clock looks. */
export function clockPicker(settings) {
    const box = new Gtk.Box({spacing: 12, homogeneous: true, margin_top: 4});
    const choices = [
        ['gnome', 'GNOME', 'Date and time in one line'],
        ['windows', 'Windows', 'Time over date, like Windows 11'],
    ];
    const buttons = {};
    let first = null;
    for (const [value, title, subtitle] of choices) {
        const content = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 10});
        const stage = new Gtk.Box({height_request: 56, halign: Gtk.Align.CENTER});
        stage.append(clockSample(value));
        content.append(stage);
        const text = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 2});
        text.append(new Gtk.Label({label: title, css_classes: ['heading']}));
        text.append(new Gtk.Label({label: subtitle, css_classes: ['caption', 'dim-label'], wrap: true, justify: Gtk.Justification.CENTER}));
        content.append(text);
        const button = new Gtk.ToggleButton({child: content, css_classes: ['keel-choice'], group: first});
        first ??= button;
        button.connect('toggled', () => {
            if (button.active && settings.get_string('clock-style') !== value)
                settings.set_string('clock-style', value);
        });
        buttons[value] = button;
        box.append(button);
    }
    const sync = () => {
        const button = buttons[settings.get_string('clock-style')];
        if (button && !button.active)
            button.active = true;
    };
    connectWhile(box, settings, 'changed::clock-style', sync);
    sync();
    return box;
}

/** Rows for the Quick Settings module. */
export function quickSettingsRows(settings) {
    const power = switchRow(settings, 'show-power-icon', 'Power icon', 'Battery or shutdown icon');
    // GNOME's own setting, also in Settings → Power.
    const percentage = switchRow(new Gio.Settings({schema_id: 'org.gnome.desktop.interface'}),
        'show-battery-percentage', 'Battery percentage', 'Next to the power icon');
    settings.bind('show-power-icon', percentage, 'sensitive', Gio.SettingsBindFlags.GET);
    return [power, percentage];
}
