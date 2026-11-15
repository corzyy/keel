import Clutter from 'gi://Clutter';
import Graphene from 'gi://Graphene';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Meta from 'gi://Meta';
import Mtk from 'gi://Mtk';
import Pango from 'gi://Pango';
import St from 'gi://St';
import * as DND from 'resource:///org/gnome/shell/ui/dnd.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {AppMenu} from 'resource:///org/gnome/shell/ui/appMenu.js';

import {isVertical, menuSide} from '../../lib/panel.js';

const PILL_ANIMATION_MS = 200;

// Windows 11 feedback when one of the app's windows is minimized / restored:
// the icon dips towards the screen edge / hops away from it, once, and springs
// back. Starts right away, together with the window animation.
const BOUNCE_OUT_MS = 110;
const BOUNCE_BACK_MS = 260;

// Every `make install` loads this file again from a new builds/<id>/ path, and
// GType names must be unique per process, so make the name unique per build.
const BUILD = GLib.compute_checksum_for_string(GLib.ChecksumType.MD5, import.meta.url, -1).slice(0, 12);

export const TaskbarButton = GObject.registerClass({
    GTypeName: `KeelTaskbarButton_${BUILD}`,
}, class KeelTaskbarButton extends St.Button {
    /**
     * window: the one window this button stands for (ungrouped taskbar), or
     * null for a button that stands for the whole app.
     * label: show a label (window title, else app name) next to the icon.
     */
    _init(app, settings, menuManager, metrics, previews, {window = null, label = false} = {}) {
        super._init({
            style_class: 'keel-task',
            can_focus: true,
            track_hover: true,
            button_mask: St.ButtonMask.PRIMARY | St.ButtonMask.MIDDLE | St.ButtonMask.SECONDARY,
        });
        this.app = app;
        this.window = window;
        this._metrics = metrics;
        this._previews = previews;

        // Icon centered, running pill on the panel's outer edge (the screen edge side),
        // both on the visible square (see styleTaskButton).
        const content = createTaskFace();
        this._face = content;
        this.child = content;
        /** Size along the bar (the drag code lays out with it). */
        this.length = label ? metrics.labelLength : metrics.side;
        styleTaskButton(this, metrics, isVertical(settings), this.length);
        this._icon = app.create_icon_texture(metrics.icon);
        this._icon.set({
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
            pivot_point: new Graphene.Point({x: 0.5, y: 0.5}),
        });
        // Where the icon and the running pill go: the whole face, or with a
        // label a square slot at its start, so the pill sits under the icon.
        let iconSlot = content;
        if (label) {
            // Icon (in its slot) at the start, label after it, ellipsized to the button's length.
            const pad = Math.round((metrics.side - metrics.icon) / 2);
            const row = new St.BoxLayout({
                x_expand: true,
                y_expand: true,
                style: `padding-right: ${pad}px;`,
            });
            iconSlot = new St.Widget({
                layout_manager: new Clutter.BinLayout(),
                width: metrics.side,
                // Explicitly not: the pill's x_expand would otherwise propagate up and
                // make the slot share the label's spare room, pushing the icon inwards.
                x_expand: false,
                y_expand: true,
            });
            iconSlot.add_child(this._icon);
            row.add_child(iconSlot);
            this._label = new St.Label({
                style_class: 'keel-task-label',
                x_expand: true,
                y_align: Clutter.ActorAlign.CENTER,
            });
            this._label.clutter_text.ellipsize = Pango.EllipsizeMode.END;
            row.add_child(this._label);
            content.add_child(row);
        } else {
            content.add_child(this._icon);
        }
        this._syncTitle();
        window?.connectObject(
            'notify::title', () => this._syncTitle(),
            'unmanaged', () => (this._gone = true),
            this);

        const side = menuSide(settings);
        const edge = {[St.Side.TOP]: 'top', [St.Side.BOTTOM]: 'bottom', [St.Side.LEFT]: 'left', [St.Side.RIGHT]: 'right'}[side];
        // Pill runs along the panel: horizontal on a top/bottom panel, vertical on a left/right one.
        this._pillAxis = side === St.Side.LEFT || side === St.Side.RIGHT ? 'height' : 'width';
        const thickAxis = this._pillAxis === 'width' ? 'height' : 'width';
        const START = Clutter.ActorAlign.START, END = Clutter.ActorAlign.END, CENTER = Clutter.ActorAlign.CENTER;
        // Nudge the icon away from the pill so the bigger icon doesn't touch it.
        // inward: +1 / -1, the direction pointing away from the screen edge.
        const nudge = metrics.pill.height / 2;
        this._bounceAxis = side === St.Side.TOP || side === St.Side.BOTTOM ? 'translation_y' : 'translation_x';
        this._inward = side === St.Side.TOP || side === St.Side.LEFT ? 1 : -1;
        this._restOffset = this._inward * nudge;
        this._icon[this._bounceAxis] = this._restOffset;
        if (this._label)
            this._label[this._bounceAxis] = this._restOffset;
        // BinLayout only honors a child's x/y_align when the child expands.
        this._pill = new St.Widget({
            style_class: 'keel-task-pill',
            x_expand: true,
            y_expand: true,
            x_align: side === St.Side.LEFT ? START : side === St.Side.RIGHT ? END : CENTER,
            y_align: side === St.Side.TOP ? START : side === St.Side.BOTTOM ? END : CENTER,
            [thickAxis]: metrics.pill.height,
            [this._pillAxis]: metrics.pill.running,
            visible: false,
            // Real length (not a scale) so the ends stay fully round at every length.
            style: `border-radius: ${metrics.pill.height / 2}px; margin-${edge}: ${metrics.pill.inset}px;`,
        });
        iconSlot.add_child(this._pill);

        // Windows 11-like press feedback: the icon briefly shrinks.
        this.connect('notify::pressed', () => {
            this._icon.ease({
                scale_x: this.pressed ? 0.85 : 1,
                scale_y: this.pressed ? 0.85 : 1,
                duration: 100,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            });
        });

        this._menu = new AppMenu(this, menuSide(settings), {
            favoritesSection: true,
            showSingleWindow: true,
        });
        this._menu.setApp(app);
        // Point the menu at the visible square, not at the whole (panel-thick) button.
        const boxPointer = this._menu._boxPointer;
        const setPosition = boxPointer.setPosition.bind(boxPointer);
        boxPointer.setPosition = (_actor, alignment) => setPosition(this._face, alignment);
        this._menu.actor.hide();
        Main.uiGroup.add_child(this._menu.actor);
        menuManager.addMenu(this._menu);
        this._menu.connect('open-state-changed', (_menu, open) => {
            if (open)
                this._previews?.dismiss(this);
            if (open)
                this.add_style_pseudo_class('active');
            else
                this.remove_style_pseudo_class('active');
        });

        app.connectObject('windows-changed', () => this.sync(), this);
        const ownWindow = actor => this._ownWindows().includes(actor.meta_window);
        global.window_manager.connectObject(
            'minimize', (_wm, actor) => ownWindow(actor) && this._bounce(-1),
            'unminimize', (_wm, actor) => ownWindow(actor) && this._bounce(1),
            this);
        this.connect('clicked', (_self, button) => this._onClicked(button));

        // Drag to reorder. The Taskbar is the drop target and slides this button itself
        // along the bar; DND only moves an invisible stand-in (see getDragActor).
        this._delegate = this;
        this.draggable = DND.makeDraggable(this);
        this.draggable.connect('drag-begin', () => {
            this._previews?.dismiss(this);
            this._menu.close();
        });
        this.connect('notify::hover', () => this._previews?.hover(this, this.hover));
        this.connect('notify::pressed', () => {
            if (this.pressed)
                this._previews?.dismiss(this);
        });
        this.connect('notify::allocation', () => this.queueIconGeometry());
        this.connect('notify::mapped', () => this.queueIconGeometry());
        this.connect('destroy', () => {
            app.disconnectObject(this);
            window?.disconnectObject(this);
            global.window_manager.disconnectObject(this);
            this._previews?.forget(this);
            this._icon.remove_all_transitions();
            this._menu.destroy();
            if (this._geometryLater)
                global.compositor.get_laters().remove(this._geometryLater);
            this._setIconGeometry(null);
        });
    }

    /**
     * Minimize / unminimize animations shrink windows into (and grow them out
     * of) their icon geometry, so point it at this button. Done before the next
     * redraw because transformed positions are only final after allocation.
     */
    queueIconGeometry() {
        if (this._geometryLater)
            return;
        this._geometryLater = global.compositor.get_laters().add(Meta.LaterType.BEFORE_REDRAW, () => {
            this._geometryLater = 0;
            this._updateIconGeometry();
            return false;
        });
    }

    _updateIconGeometry() {
        if (!this.is_mapped()) {
            // Hidden (e.g. the taskbar module is hidden): let the shell fall back to its default.
            this._setIconGeometry(null);
            return;
        }
        const [x, y] = this._face.get_transformed_position();
        const [width, height] = this._face.get_transformed_size();
        this._setIconGeometry(new Mtk.Rectangle({
            x: Math.round(x),
            y: Math.round(y),
            width: Math.round(width),
            height: Math.round(height),
        }));
    }

    _setIconGeometry(rect) {
        for (const window of this._ownWindows())
            window.set_icon_geometry(rect);
    }

    /** All windows this button stands for, taskbar or not. */
    _ownWindows() {
        if (this.window)
            return this._gone ? [] : [this.window];
        return this.app.get_windows();
    }

    _syncTitle() {
        const title = this.window?.title || this.app.get_name();
        this.accessible_name = title;
        if (this._label)
            this._label.text = title;
    }

    /** Moves the icon away from (direction 1) or towards (-1) the screen edge and springs it back. */
    _bounce(direction) {
        if (!this.is_mapped())
            return;
        const distance = Math.max(2, Math.round(this._metrics.side * 0.07));
        this._icon.remove_transition(this._bounceAxis);
        this._icon[this._bounceAxis] = this._restOffset;
        this._icon.ease({
            [this._bounceAxis]: this._restOffset + direction * this._inward * distance,
            duration: BOUNCE_OUT_MS,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => {
                this._icon.ease({
                    [this._bounceAxis]: this._restOffset,
                    duration: BOUNCE_BACK_MS,
                    mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                });
            },
        });
    }

    /**
     * DND: an invisible stand-in that follows the pointer. What the user sees move is
     * the button itself, kept on the bar by the Taskbar (a visible copy positioned by
     * DND would have to be forced back onto the bar on every motion, and flickers).
     */
    getDragActor() {
        return new Clutter.Actor({width: this.width, height: this.height, opacity: 0});
    }

    getDragActorSource() {
        return this;
    }

    closeMenu() {
        this._menu.close();
    }

    get menuOpen() {
        return this._menu.isOpen;
    }

    /** The app's windows that belong in a taskbar, most recently used first. */
    windows() {
        return this._ownWindows().filter(w => !w.skip_taskbar);
    }

    sync() {
        this.queueIconGeometry();   // new windows need it too
        this._syncPill();
    }

    setFocused(focused) {
        if (focused === this._focused)
            return;
        this._focused = focused;
        if (focused)
            this.add_style_class_name('focused');
        else
            this.remove_style_class_name('focused');
        this._syncPill();
    }

    _syncPill() {
        const running = this.windows().length > 0;
        const {pill} = this._metrics;
        if (!running) {
            this._pill.remove_all_transitions();
            this._pill.hide();
            return;
        }
        const length = this._focused ? pill.focused : pill.running;
        // Only animate a pill that is already on screen: an actor that hasn't
        // been painted yet has no stage view, so its timeline never ticks and
        // the ease would get stuck at the start value. Appearing is instant.
        const animate = this._pill.visible && this._pill.peek_stage_views().length > 0;
        this._pill.show();
        this._pill.ease({
            [this._pillAxis]: length,
            duration: animate ? PILL_ANIMATION_MS : 0,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
    }

    _onClicked(button) {
        if (button === Clutter.BUTTON_SECONDARY) {
            this._menu.toggle();
            return;
        }

        const windows = this.windows();

        if (button === Clutter.BUTTON_MIDDLE || windows.length === 0) {
            if (button === Clutter.BUTTON_MIDDLE && this.app.can_open_new_window())
                this.app.open_new_window(-1);
            else
                this.app.activate();
            Main.overview.hide();
            return;
        }

        // One window: minimize it if it's focused, else bring it up.
        if (this.window) {
            if (!Main.overview.visible && this._focused && this.window.can_minimize())
                this.window.minimize();
            else
                Main.activateWindow(this.window);
            Main.overview.hide();
            return;
        }

        // Clicking the focused app minimizes it, otherwise bring its last-used window up.
        const focusWindow = global.display.focus_window;
        if (!Main.overview.visible && windows.includes(focusWindow)) {
            for (const w of windows) {
                if (w.can_minimize())
                    w.minimize();
            }
            return;
        }

        // get_windows() is sorted most-recently-used first.
        Main.activateWindow(windows[0]);
        Main.overview.hide();
    }
});

/**
 * The visible part of a taskbar button: a square that draws the highlight and
 * holds the icon. Set as the button's child; sized by styleTaskButton.
 */
export function createTaskFace(child = null) {
    const face = new St.Widget({
        style_class: 'keel-task-face',
        layout_manager: new Clutter.BinLayout(),
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
    });
    if (child)
        face.add_child(child);
    return face;
}

/**
 * Square, rounded button sized from the panel height (also used for the app
 * grid button). Only the face (see createTaskFace) is a square: the button
 * itself spans the panel's whole thickness, so the pointer pushed against the
 * screen edge (Fitts's law) or in the gap between button and panel border
 * still hits it.
 */
export function styleTaskButton(button, metrics, vertical, length = metrics.side) {
    const {FILL, CENTER} = Clutter.ActorAlign;
    const face = button.child;
    face.set_size(vertical ? metrics.side : length, vertical ? length : metrics.side);
    face.set_style(`border-radius: ${metrics.radius}px;`);
    button.set_size(vertical ? -1 : length, vertical ? length : -1);
    button.x_align = vertical ? FILL : CENTER;
    button.y_align = vertical ? CENTER : FILL;
}
