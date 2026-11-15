import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Pango from 'gi://Pango';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {isVertical, menuSide} from '../../lib/panel.js';

const HIDE_DELAY_MS = 300;    // grace period to move the pointer from button to preview
const FADE_MS = 120;
const MOVE_MS = 150;
const GAP = 8;                // between panel and preview, and preview and screen edge
// Thumbnails take the shape of their window. Along a top / bottom panel they
// share one height, preview-size * 9/16, so a 16:9 window is preview-size wide;
// along a left / right panel they share the width, preview-size. The other side
// follows the window's aspect ratio, within these limits (width / height):
const THUMB_RATIO = 9 / 16;
const MIN_ASPECT = 0.6;       // portrait windows: no thinner than this
const MAX_ASPECT = 2.4;       // very wide windows: no wider than this
const MIN_SIZE = 60;          // smallest shared side when many windows have to fit

/**
 * Windows 11 style window previews: hovering a taskbar button for a moment
 * shows live thumbnails of the app's windows next to it (nothing for apps
 * without windows). Click a thumbnail to switch to that window, middle
 * click or the × to close it. While a preview is open, hovering another
 * button switches to its windows right away.
 *
 * One preview popup is shared by all buttons of the taskbar.
 */
export class WindowPreviews {
    constructor(settings) {
        this._settings = settings;
        this._button = null;      // button the preview is open for
        this._pending = null;     // button waiting for the show delay
        this._suppressed = null;  // button clicked while hovered: no preview until the pointer leaves
        this._showId = 0;
        this._hideId = 0;

        this._actor = new St.BoxLayout({
            style_class: 'keel-preview',
            reactive: true,
            track_hover: true,
            visible: false,
        });
        this._actor.connect('notify::hover', () => {
            if (this._actor.hover)
                this._cancelHide();
            else
                this._queueHide();
        });
        // The size measured when placing it is only a guess until the popup has
        // been laid out (styles, titles, the content of another app): follow
        // the real size, so it stays centered on its button and on screen.
        // (Its own moves land here too; _place ignores an unchanged target.)
        this._actor.connectObject(
            'notify::allocation', () => this._queueReplace(),
            this);
        this._target = null;   // [x, y] the popup is at or moving to
        Main.layoutManager.addTopChrome(this._actor);

        this._settings.connectObject('changed::window-previews', () => this.close(), this);
        Main.overview.connectObject('showing', () => this.close(), this);
    }

    destroy() {
        this._cancelShow();
        this._cancelHide();
        if (this._replaceLater)
            global.compositor.get_laters().remove(this._replaceLater);
        this._replaceLater = 0;
        this._settings.disconnectObject(this);
        Main.overview.disconnectObject(this);
        this._unwatch();
        Main.layoutManager.removeChrome(this._actor);
        this._actor.disconnectObject(this);
        this._actor.destroy();
        this._actor = this._button = this._pending = this._suppressed = null;
    }

    /** Called by the buttons when the pointer enters or leaves them. */
    hover(button, hovering) {
        if (!hovering) {
            if (this._suppressed === button)
                this._suppressed = null;
            if (this._pending === button)
                this._cancelShow();
            if (this._button)
                this._queueHide();
            return;
        }
        if (!this._settings.get_boolean('window-previews') || this._suppressed === button)
            return;
        this._cancelHide();
        if (this._button) {
            if (this._button !== button)
                this._open(button);   // already browsing: switch right away
            return;
        }
        this._cancelShow();
        this._pending = button;
        this._showId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, this._settings.get_int('preview-delay'), () => {
            this._showId = 0;
            this._pending = null;
            if (button.hover && !button.menuOpen)
                this._open(button);
            return GLib.SOURCE_REMOVE;
        });
    }

    /** The button was clicked or its menu opened: get out of the way until the pointer leaves it. */
    dismiss(button) {
        this._suppressed = button;
        this._cancelShow();
        this.close();
    }

    /** The button is going away. */
    forget(button) {
        if (this._pending === button)
            this._cancelShow();
        if (this._suppressed === button)
            this._suppressed = null;
        if (this._button === button)
            this.close(false);
    }

    close(animate = true) {
        this._cancelHide();
        if (!this._button)
            return;
        this._unwatch();
        this._button = null;
        this._target = null;
        this._actor.remove_all_transitions();
        if (!animate) {
            this._actor.hide();
            this._actor.destroy_all_children();
            return;
        }
        this._actor.ease({
            opacity: 0,
            duration: FADE_MS,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => {
                this._actor.hide();
                this._actor.destroy_all_children();
            },
        });
    }

    _unwatch() {
        this._button?.app.disconnectObject(this);
        for (const actor of this._watched ?? [])
            actor.disconnectObject(this);
        this._watched = [];
    }

    _cancelShow() {
        if (this._showId)
            GLib.source_remove(this._showId);
        this._showId = 0;
        this._pending = null;
    }

    _queueHide() {
        if (this._hideId)
            return;
        this._hideId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, HIDE_DELAY_MS, () => {
            this._hideId = 0;
            if (!this._actor.hover && !this._button?.hover)
                this.close();
            return GLib.SOURCE_REMOVE;
        });
    }

    _cancelHide() {
        if (this._hideId)
            GLib.source_remove(this._hideId);
        this._hideId = 0;
    }

    _open(button) {
        if (button.windows().length === 0) {
            this.close();   // apps without windows get no preview
            return;
        }
        const wasOpen = this._actor.visible && this._button !== null;
        this._unwatch();
        this._button = button;
        // The button moves when others come and go, or the taskbar / panel moves.
        this._watched = [button, button.get_parent(), Main.layoutManager.panelBox].filter(Boolean);
        for (const actor of this._watched)
            actor.connectObject('notify::allocation', () => this._queueReplace(), this);
        // Windows opening / closing while the preview is up.
        button.app.connectObject('windows-changed', () => {
            if (this._button !== button)
                return;
            if (button.windows().length === 0)
                this.close();
            else
                this._fill(button, true);
        }, this);
        this._fill(button, wasOpen);

        this._actor.remove_transition('opacity');
        if (!wasOpen) {
            this._actor.opacity = 0;
            this._actor.show();
            this._actor.ease({opacity: 255, duration: FADE_MS, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
        } else {
            this._actor.opacity = 255;
        }
    }

    /** (Re)builds the content for button and moves the popup next to it. */
    _fill(button, animateMove) {
        this._actor.destroy_all_children();
        const vertical = isVertical(this._settings);
        this._actor.orientation = vertical ? Clutter.Orientation.VERTICAL : Clutter.Orientation.HORIZONTAL;

        const windows = button.windows();
        const sizes = this._thumbSizes(windows, vertical);
        windows.forEach((window, i) =>
            this._actor.add_child(this._item(button.app, window, ...sizes[i])));
        this._place(button, animateMove);
    }

    /**
     * Thumbnail sizes [width, height], one per window, shaped like the window
     * (see THUMB_RATIO). All shrink together if they wouldn't fit along the panel.
     */
    _thumbSizes(windows, vertical) {
        const workArea = this._workArea();
        const size = this._settings.get_int('preview-size');
        const aspects = windows.map(window => {
            const {width, height} = window.get_frame_rect();
            const aspect = width > 0 && height > 0 ? width / height : 1 / THUMB_RATIO;
            return Math.max(MIN_ASPECT, Math.min(MAX_ASPECT, aspect));
        });
        const extra = 24;   // item padding + popup padding / spacing per thumbnail, roughly
        const header = 32;
        // Shared side: the height of every thumbnail along a horizontal panel,
        // the width along a vertical one. Lengths along the panel are proportional to it.
        let shared = vertical ? size : Math.round(size * THUMB_RATIO);
        const perShared = vertical
            ? aspects.reduce((sum, a) => sum + 1 / a, 0)
            : aspects.reduce((sum, a) => sum + a, 0);
        const available = vertical
            ? workArea.height - 2 * GAP - windows.length * (extra + header)
            : workArea.width - 2 * GAP - windows.length * extra;
        shared = Math.max(MIN_SIZE, Math.min(shared, Math.floor(available / perShared)));
        return aspects.map(a => vertical
            ? [shared, Math.round(shared / a)]
            : [Math.round(shared * a), shared]);
    }

    _item(app, window, width, height) {
        const item = new St.Button({
            style_class: 'keel-preview-item',
            track_hover: true,
            can_focus: true,
            button_mask: St.ButtonMask.PRIMARY | St.ButtonMask.MIDDLE,
        });
        const box = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL});
        item.child = box;

        const header = new St.BoxLayout({style_class: 'keel-preview-header', width});
        header.add_child(app.create_icon_texture(16));
        const title = new St.Label({
            style_class: 'keel-preview-title',
            text: window.title ?? app.get_name(),
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        title.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        header.add_child(title);
        const close = new St.Button({
            style_class: 'keel-preview-close',
            child: new St.Icon({icon_name: 'window-close-symbolic', icon_size: 12}),
            opacity: 0,
            y_align: Clutter.ActorAlign.CENTER,
        });
        close.connect('clicked', () => window.delete(global.get_current_time()));
        header.add_child(close);
        box.add_child(header);

        const frame = new St.Widget({
            style_class: 'keel-preview-thumbnail',
            width,
            height,
            clip_to_allocation: true,
        });
        const source = window.get_compositor_private();
        if (source) {
            // Scale the window's frame (not its buffer, which includes the
            // client-side shadow) to fit the thumbnail, centered; only when the
            // aspect ratio was clamped is there any empty space left.
            const rect = window.get_frame_rect();
            const buffer = window.get_buffer_rect();
            const scale = Math.min(width / rect.width, height / rect.height);
            const offsetX = (width - rect.width * scale) / 2;
            const offsetY = (height - rect.height * scale) / 2;
            frame.add_child(new Clutter.Clone({
                source,
                x: Math.round(offsetX + (buffer.x - rect.x) * scale),
                y: Math.round(offsetY + (buffer.y - rect.y) * scale),
                width: Math.round(buffer.width * scale),
                height: Math.round(buffer.height * scale),
            }));
        }
        box.add_child(frame);

        window.connectObject('notify::title', () => {
            title.text = window.title ?? app.get_name();
        }, item);
        item.connect('notify::hover', () => {
            close.ease({opacity: item.hover ? 255 : 0, duration: 100, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
        });
        item.connect('clicked', (_item, mouseButton) => {
            if (mouseButton === Clutter.BUTTON_MIDDLE) {
                window.delete(global.get_current_time());
                return;
            }
            Main.activateWindow(window);
            this.close();
        });
        return item;
    }

    _workArea() {
        const index = this._button
            ? Main.layoutManager.findIndexForActor(this._button)
            : Main.layoutManager.primaryIndex;
        return Main.layoutManager.getWorkAreaForMonitor(index);
    }

    // Allocation notifies arrive mid-layout, when positions aren't final yet.
    _queueReplace() {
        if (this._replaceLater)
            return;
        this._replaceLater = global.compositor.get_laters().add(Meta.LaterType.BEFORE_REDRAW, () => {
            this._replaceLater = 0;
            this._replace();
            return GLib.SOURCE_REMOVE;
        });
    }

    _replace() {
        if (!this._button || !this._actor.visible)
            return;
        // Keep gliding if it is on its way somewhere, else jump.
        const moving = Boolean(this._actor.get_transition('x') || this._actor.get_transition('y'));
        this._place(this._button, moving, this._actor.get_size());
    }

    /**
     * Next to the button, away from the panel, centered on it and kept on screen.
     * size: the popup's size, its preferred size if not given.
     */
    _place(button, animate, size = null) {
        const workArea = this._workArea();
        const [bx, by] = button.get_transformed_position();
        const [bw, bh] = button.get_transformed_size();
        const [width, height] = size ?? this._actor.get_preferred_size().slice(2);

        let x = bx + bw / 2 - width / 2;
        let y = by + bh / 2 - height / 2;
        switch (menuSide(this._settings)) {
        case St.Side.BOTTOM: y = workArea.y + workArea.height - height - GAP; break;
        case St.Side.TOP: y = workArea.y + GAP; break;
        case St.Side.LEFT: x = workArea.x + GAP; break;
        case St.Side.RIGHT: x = workArea.x + workArea.width - width - GAP; break;
        }
        const clamp = (v, min, max) => Math.max(min, Math.min(v, max));
        x = Math.round(clamp(x, workArea.x + GAP, workArea.x + workArea.width - width - GAP));
        y = Math.round(clamp(y, workArea.y + GAP, workArea.y + workArea.height - height - GAP));

        const target = this._target;
        if (target && target[0] === x && target[1] === y)
            return;
        this._target = [x, y];
        this._actor.remove_transition('x');
        this._actor.remove_transition('y');
        if (animate) {
            this._actor.ease({x, y, duration: MOVE_MS, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
        } else {
            this._actor.set_position(x, y);
        }
    }
}
