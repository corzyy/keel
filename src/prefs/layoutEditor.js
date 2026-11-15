import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk';
import Pango from 'gi://Pango';

import {MODULES, ZONES, hiddenModules, moveModule, readLayout, writeLayout} from '../lib/modules.js';

const TITLES = {
    horizontal: {left: 'Left', center: 'Center', right: 'Right', hidden: 'Hidden'},
    vertical: {left: 'Top', center: 'Middle', right: 'Bottom', hidden: 'Hidden'},
};

/**
 * The panel-layout setting as the bar's three sections side by side and the
 * hidden modules below. Modules are chips that can be dragged between and within
 * columns, or clicked for a menu that does the same.
 */
export class LayoutEditor {
    /** openPage(name) shows a prefs page; chips of modules with a `page` link to it. */
    constructor(settings, openPage = null) {
        this._settings = settings;
        this._openPage = openPage;
        this._dragging = null;   // id of the chip being dragged
        // Modules of other extensions only show up when that extension is installed.
        this._available = new Set(MODULES
            .filter(m => !m.extension || extensionInstalled(m.extension))
            .map(m => m.id));

        // The three sections side by side, the hidden modules in a row below.
        this.widget = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 6, css_classes: ['keel-layout']});
        // Not homogeneous: each section gets room by its items.
        const sections = new Gtk.Box({spacing: 6});
        this.widget.append(sections);
        this._columns = {};
        for (const zone of ZONES) {
            this._columns[zone] = new Column(this, zone);
            sections.append(this._columns[zone].box);
        }
        this._columns.hidden = new Column(this, 'hidden');
        this.widget.append(this._columns.hidden.box);

        const ids = ['changed::panel-layout', 'changed::position']
            .map(signal => settings.connect(signal, () => this._queueSync()));
        this.widget.connect('destroy', () => {
            ids.forEach(id => settings.disconnect(id));
            if (this._syncId)
                GLib.source_remove(this._syncId);
        });
        this._sync();
    }

    get dragging() {
        return this._dragging;
    }

    // Rebuilding destroys the chip being dragged, so never do it from inside a drag signal.
    _queueSync() {
        if (this._syncId)
            return;
        this._syncId = GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            this._syncId = 0;
            this._sync();
            return GLib.SOURCE_REMOVE;
        });
    }

    _sync() {
        const position = this._settings.get_string('position');
        const titles = TITLES[position === 'left' || position === 'right' ? 'vertical' : 'horizontal'];
        const layout = readLayout(this._settings);
        const available = ids => ids.filter(id => this._available.has(id));
        for (const zone of ZONES)
            this._columns[zone].set(titles[zone], available(layout[zone]));
        this._columns.hidden.set(titles.hidden, available(hiddenModules(layout)));
    }

    /** Where module id is: [zone or 'hidden', index]. */
    _find(id) {
        const layout = readLayout(this._settings);
        for (const zone of ZONES) {
            const index = layout[zone].indexOf(id);
            if (index >= 0)
                return [zone, index, layout[zone].length];
        }
        return ['hidden', -1, 0];
    }

    moveModule(id, zone, index) {
        const layout = readLayout(this._settings);
        writeLayout(this._settings, moveModule(layout, id, zone, index));
    }

    createChip(id) {
        const module = MODULES.find(m => m.id === id);
        const content = new Gtk.Box({spacing: 8});
        content.append(new Gtk.Image({icon_name: module.icon}));
        content.append(new Gtk.Label({label: module.label, ellipsize: Pango.EllipsizeMode.END, xalign: 0, hexpand: true}));
        const chip = new Gtk.Button({
            child: content,
            tooltip_text: module.label,
            cursor: Gdk.Cursor.new_from_name('grab', null),
            css_classes: ['keel-chip'],
        });
        chip._keelModule = id;
        chip.connect('clicked', () => this._showMenu(chip, id));

        const source = new Gtk.DragSource({actions: Gdk.DragAction.MOVE});
        source.connect('prepare', () => Gdk.ContentProvider.new_for_value(id));
        source.connect('drag-begin', src => {
            src.set_icon(Gtk.WidgetPaintable.new(chip),
                Math.floor(chip.get_width() / 2), Math.floor(chip.get_height() / 2));
            this._dragging = id;
            chip.add_css_class('dragging');
            this.widget.add_css_class('dragging');
        });
        source.connect('drag-end', () => {
            this._dragging = null;
            chip.remove_css_class('dragging');
            this.widget.remove_css_class('dragging');
        });
        chip.add_controller(source);
        return chip;
    }

    /** A small menu to move the module without dragging. */
    _showMenu(chip, id) {
        const [zone, index, count] = this._find(id);
        const position = this._settings.get_string('position');
        const vertical = position === 'left' || position === 'right';
        const titles = TITLES[vertical ? 'vertical' : 'horizontal'];

        const box = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 2});
        const popover = new Gtk.Popover({child: box, css_classes: ['menu']});
        const add = (label, action) => {
            const button = new Gtk.Button({
                child: new Gtk.Label({label, xalign: 0}),
                css_classes: ['flat'],
            });
            button.connect('clicked', () => {
                popover.popdown();
                action();
            });
            box.append(button);
        };

        if (zone !== 'hidden') {
            if (index > 0)
                add(vertical ? 'Move Up' : 'Move Left', () => this.moveModule(id, zone, index - 1));
            if (index < count - 1)
                add(vertical ? 'Move Down' : 'Move Right', () => this.moveModule(id, zone, index + 1));
            if (box.get_first_child())
                box.append(new Gtk.Separator({margin_top: 4, margin_bottom: 4}));
        }
        for (const target of ZONES) {
            if (target !== zone)
                add(`Move to ${titles[target]}`, () => this.moveModule(id, target, Infinity));
        }
        if (zone !== 'hidden')
            add('Hide', () => this.moveModule(id, 'hidden', 0));

        const module = MODULES.find(m => m.id === id);
        if (module.page && this._openPage) {
            box.append(new Gtk.Separator({margin_top: 4, margin_bottom: 4}));
            add(`${module.label} Settings…`, () => this._openPage(module.page));
        }

        popover.set_parent(chip);
        popover.connect('closed', () => GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            popover.unparent();
            return GLib.SOURCE_REMOVE;
        }));
        popover.popup();
    }
}

/** One column: a titled list of chips that accepts drops. */
class Column {
    constructor(editor, zone) {
        this._editor = editor;
        this._zone = zone;
        this._ordered = zone !== 'hidden';   // hidden modules have no order
        this._chips = [];

        // A section: title over its chips, one per line; the section is as wide as
        // its widest chip. Hidden: title beside a row of chips that wraps.
        this.box = new Gtk.Box({
            orientation: this._ordered ? Gtk.Orientation.VERTICAL : Gtk.Orientation.HORIZONTAL,
            spacing: this._ordered ? 3 : 8,
            hexpand: true,
            css_classes: ['keel-column', ...(this._ordered ? [] : ['hidden-column'])],
        });
        this._title = new Gtk.Label({
            xalign: 0,
            valign: this._ordered ? Gtk.Align.START : Gtk.Align.CENTER,
            css_classes: ['keel-column-title'],
        });
        this.box.append(this._title);
        this._list = this._ordered
            ? new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 3, valign: Gtk.Align.START})
            : new Adw.WrapBox({child_spacing: 4, line_spacing: 4, hexpand: true, valign: Gtk.Align.CENTER});
        this.box.append(this._list);
        this._marker = new Gtk.Box({visible: false, css_classes: ['keel-marker']});
        this._list.append(this._marker);
        this._empty = new Gtk.Label({
            label: this._ordered ? 'Empty' : 'Nothing hidden',
            css_classes: ['keel-empty'],
        });
        this._list.append(this._empty);

        const target = Gtk.DropTarget.new(GObject.TYPE_STRING, Gdk.DragAction.MOVE);
        target.connect('enter', (_t, x, y) => this._hover(x, y));
        target.connect('motion', (_t, x, y) => this._hover(x, y));
        target.connect('leave', () => this._unhover());
        target.connect('drop', (_t, id, x, y) => {
            const index = this._indexAt(x, y, id);
            this._unhover();
            this._editor.moveModule(id, this._zone, index);
            return true;
        });
        this.box.add_controller(target);
    }

    set(title, ids) {
        this._title.label = title;
        for (const chip of this._chips)
            this._list.remove(chip);
        this._chips = ids.map(id => this._editor.createChip(id));
        for (const chip of this._chips) {
            if (!this._ordered)
                chip.hexpand = false;   // natural width, not the label's expand
            this._list.append(chip);
        }
        this._syncEmpty();
    }

    _syncEmpty() {
        this._empty.visible = this._chips.length === 0 && !this._marker.visible;
    }

    /**
     * Where a drop at (x, y) lands, counting only the chips that stay in place.
     * In a section, chips above the pointer come before it; in the wrapping
     * hidden row, chips earlier in reading order do.
     */
    _indexAt(x, y, draggedId) {
        let index = 0;
        for (const chip of this._chips) {
            if (chip._keelModule === draggedId)
                continue;
            const [ok, rect] = chip.compute_bounds(this.box);
            if (!ok)
                continue;
            const top = rect.get_y(), bottom = top + rect.get_height();
            const before = this._ordered
                ? y > top + rect.get_height() / 2
                : y >= bottom || (y >= top && x > rect.get_x() + rect.get_width() / 2);
            if (before)
                index++;
        }
        return index;
    }

    _hover(x, y) {
        this.box.add_css_class('drop-hover');
        if (this._ordered) {
            const dragged = this._editor.dragging;
            const others = this._chips.filter(chip => chip._keelModule !== dragged);
            const index = this._indexAt(x, y, dragged);
            this._list.reorder_child_after(this._marker, index > 0 ? others[index - 1] : null);
            this._marker.visible = true;
        }
        this._syncEmpty();
        return Gdk.DragAction.MOVE;
    }

    _unhover() {
        this._marker.visible = false;
        this.box.remove_css_class('drop-hover');
        this._syncEmpty();
    }
}

/**
 * Whether an extension is installed for this user or system-wide. Checked on
 * disk: prefs run inside the org.gnome.Shell.Extensions service, so asking it
 * over D-Bus would just wait for ourselves.
 */
function extensionInstalled(uuid) {
    const dirs = [GLib.get_user_data_dir(), ...GLib.get_system_data_dirs()];
    return dirs.some(dir => GLib.file_test(
        GLib.build_filenamev([dir, 'gnome-shell', 'extensions', uuid, 'metadata.json']),
        GLib.FileTest.EXISTS));
}
