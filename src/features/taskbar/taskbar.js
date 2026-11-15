import Clutter from 'gi://Clutter';
import Graphene from 'gi://Graphene';
import Shell from 'gi://Shell';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as DND from 'resource:///org/gnome/shell/ui/dnd.js';
import * as AppFavorites from 'resource:///org/gnome/shell/ui/appFavorites.js';
import {PopupMenuManager} from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {taskbarMetrics} from '../../lib/metrics.js';
import {isVertical} from '../../lib/panel.js';
import {TaskbarButton, createTaskFace, styleTaskButton} from './taskbarButton.js';
import {WindowPreviews} from './windowPreview.js';

const REORDER_ANIMATION_MS = 150;
const ZOOM_MS = 200;          // buttons appearing / disappearing: zoom + fade
const ZOOM_SCALE = 0.5;

const REBUILD_KEYS = ['show-favorites', 'show-apps-button', 'icon-size', 'panel-height', 'position',
    'group-windows', 'show-labels'];

/**
 * App launcher button + one button per pinned/running app, inserted into the
 * panel's left box right after the Activities button (PanelLayout may move it).
 */
export class Taskbar {
    constructor(settings, extension) {
        this._settings = settings;
        this._extension = extension;
        this._buttons = new Map();   // item key (see _wantedItems) -> TaskbarButton
        this._order = [];            // ids of running non-favorites, in launch order (or as dragged)
        this._pinnedCount = 0;       // the first _pinnedCount buttons belong to favorites
        this._drag = null;           // {button, pinned, original: [buttons]} while reordering
        this._leaving = new Set();   // removed buttons, still zooming out (see _zoomOut)
    }

    enable() {
        this._box = new St.BoxLayout({style_class: 'keel-taskbar', y_expand: true});
        this._menuManager = new PopupMenuManager(this._box);
        this._previews = new WindowPreviews(this._settings);

        this._showAppsIcon = new St.Icon({
            icon_name: 'view-app-grid-symbolic',
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
            x_expand: true,
            y_expand: true,
        });
        this._showApps = new St.Button({
            style_class: 'keel-task keel-show-apps',
            can_focus: true,
            track_hover: true,
            accessible_name: 'Show Apps',
            child: createTaskFace(this._showAppsIcon),
        });
        this._showApps.connect('clicked', () => this._toggleAppGrid());
        this._box.add_child(this._showApps);

        this._apps = new St.BoxLayout({style_class: 'keel-taskbar-apps'});
        this._box.add_child(this._apps);

        const leftBox = Main.panel._leftBox;
        const activities = Main.panel.statusArea.activities?.container;
        if (activities?.get_parent() === leftBox)
            leftBox.insert_child_above(this._box, activities);
        else
            leftBox.insert_child_at_index(this._box, 0);
        this._extension.panelModules.set('taskbar', this._box);

        Shell.AppSystem.get_default().connectObject(
            'app-state-changed', () => this._queueRebuild(), this);
        AppFavorites.getAppFavorites().connectObject(
            'changed', () => this._queueRebuild(), this);
        Shell.WindowTracker.get_default().connectObject(
            'notify::focus-app', () => this._syncFocus(),
            // Windows coming and going (one button per window when ungrouped).
            'tracked-windows-changed', () => this._queueRebuild(), this);
        global.display.connectObject(
            'window-created', () => this._queueRebuild(),
            'notify::focus-window', () => this._syncFocus(),
            'restacked', () => this._syncFocus(), this);
        // Buttons keep their local allocation when the whole taskbar or panel moves
        // (other section, other screen edge), so refresh the minimize targets then too.
        this._box.connect('notify::allocation', () => this._queueIconGeometry());
        Main.layoutManager.panelBox.connectObject(
            'notify::allocation', () => this._queueIconGeometry(), this);
        for (const key of REBUILD_KEYS)
            this._settings.connectObject(`changed::${key}`, () => this._rebuild(true), this);

        this._rebuild(true);
    }

    disable() {
        if (this._rebuildId) {
            clearTimeout(this._rebuildId);
            this._rebuildId = 0;
        }
        this._settings.disconnectObject(this);
        Main.layoutManager.panelBox.disconnectObject(this);
        global.display.disconnectObject(this);
        Shell.WindowTracker.get_default().disconnectObject(this);
        AppFavorites.getAppFavorites().disconnectObject(this);
        Shell.AppSystem.get_default().disconnectObject(this);

        this._extension.panelModules.delete('taskbar');
        this._stopDrag();
        this._clearLeaving();
        this._buttons.clear();
        this._box.destroy();   // also destroys the buttons and their menus
        this._previews.destroy();
        this._previews = null;
        this._box = this._apps = this._showApps = this._showAppsIcon = this._menuManager = null;
    }

    _toggleAppGrid() {
        if (Main.overview.visible && Main.overview.dash.showAppsButton.checked)
            Main.overview.hide();
        else
            Main.overview.showApps();
    }

    // Several app-state/window signals tend to arrive together; coalesce them.
    _queueRebuild() {
        if (this._rebuildId)
            return;
        this._rebuildId = setTimeout(() => {
            this._rebuildId = 0;
            this._rebuild(false);
        }, 50);
    }

    /**
     * The buttons to show, in order: {key, app, window, label}. Grouped, one per
     * app (window null). Ungrouped, one per window, in the app's slot, in the
     * order they were opened; apps without windows still get one (window null).
     * With labels on, only buttons with open windows get one: pinned apps that
     * aren't open stay icons. The key changes with that, so the button is
     * recreated when an app opens or closes its last window.
     */
    _wantedItems() {
        const grouped = this._settings.get_boolean('group-windows');
        const expand = app => {
            const windows = grouped ? [] : app.get_windows()
                .filter(w => !w.skip_taskbar)
                .sort((a, b) => a.get_stable_sequence() - b.get_stable_sequence());
            if (windows.length === 0) {
                const label = this._labels && app.get_windows().some(w => !w.skip_taskbar);
                return [{key: label ? `${app.get_id()}#label` : app.get_id(), app, window: null, label}];
            }
            return windows.map(window => ({
                key: `${app.get_id()}#${window.get_stable_sequence()}`, app, window, label: this._labels,
            }));
        };
        const apps = this._wantedApps();
        const pinned = apps.slice(0, this._pinnedCount).flatMap(expand);
        const items = [...pinned, ...apps.slice(this._pinnedCount).flatMap(expand)];
        this._pinnedCount = pinned.length;
        return items;
    }

    _wantedApps() {
        const favorites = this._settings.get_boolean('show-favorites')
            ? AppFavorites.getAppFavorites().getFavorites() : [];
        const favoriteIds = new Set(favorites.map(app => app.get_id()));

        const running = Shell.AppSystem.get_default().get_running()
            .filter(app => !favoriteIds.has(app.get_id()));
        const runningIds = new Set(running.map(app => app.get_id()));

        // Keep a stable order for running apps: old ones keep their slot, new ones go last.
        this._order = this._order.filter(id => runningIds.has(id));
        for (const app of running) {
            if (!this._order.includes(app.get_id()))
                this._order.push(app.get_id());
        }
        const byId = new Map(running.map(app => [app.get_id(), app]));
        this._pinnedCount = favorites.length;
        return [...favorites, ...this._order.map(id => byId.get(id))];
    }

    _rebuild(recreate) {
        // Don't move or replace buttons under a drag; catch up when it ends.
        if (this._drag && !recreate) {
            this._rebuildPending = true;
            return;
        }
        this._stopDrag();
        this._rebuildPending = false;

        if (recreate) {
            this._clearLeaving();
            for (const button of this._buttons.values())
                button.destroy();
            this._buttons.clear();
            this._metrics = taskbarMetrics(this._settings);
            const {icon, spacing} = this._metrics;
            // Labels need room along the bar: top / bottom only.
            this._labels = this._settings.get_boolean('show-labels') && !isVertical(this._settings);
            const vertical = isVertical(this._settings);
            styleTaskButton(this._showApps, this._metrics, vertical);
            // Symbolic icons look heavier than app icons at the same size.
            this._showAppsIcon.icon_size = Math.round(icon * 0.85);
            this._showApps.visible = this._settings.get_boolean('show-apps-button');
            const orientation = vertical ? Clutter.Orientation.VERTICAL : Clutter.Orientation.HORIZONTAL;
            this._box.orientation = this._apps.orientation = orientation;
            // Fill the panel across its thickness, not along it (that would push other items away).
            this._box.x_expand = vertical;
            this._box.y_expand = !vertical;
            this._box.set_style(`spacing: ${spacing}px; padding: ${vertical ? `${spacing}px 0` : `0 ${spacing}px`};`);
            this._apps.set_style(`spacing: ${spacing}px;`);
        }

        const items = this._wantedItems();
        const wanted = new Set(items.map(item => item.key));
        // Apps whose button is swapped for a new one (it gained or lost its label, its
        // last window closed while pinned...): not really going or coming, no animation.
        const added = new Set(items.filter(item => !this._buttons.has(item.key)).map(item => item.app));
        const swapped = new Set();

        for (const [key, button] of this._buttons) {
            if (wanted.has(key))
                continue;
            this._buttons.delete(key);
            if (added.has(button.app)) {
                swapped.add(button.app);
                button.destroy();
            } else {
                this._zoomOut(button);
            }
        }

        // Placed after the previous wanted button rather than at an index: buttons
        // that are still zooming out stay in the bar until they're done.
        let previous = null;
        for (const {key, app, window, label} of items) {
            let button = this._buttons.get(key);
            if (!button) {
                button = new TaskbarButton(app, this._settings, this._menuManager, this._metrics, this._previews,
                    {window, label});
                button.draggable.connect('drag-begin', () => this._onDragBegin(button));
                button.draggable.connect('drag-cancelled', () => this._onDragCancelled(button));
                button.draggable.connect('drag-end', () => this._onDragEnd(button));
                this._buttons.set(key, button);
                if (previous)
                    this._apps.insert_child_above(button, previous);
                else
                    this._apps.insert_child_below(button, null);
                if (!recreate && !swapped.has(app))
                    this._zoomIn(button);
            } else if (this._livePrevious(button) !== previous) {
                if (previous)
                    this._apps.set_child_above_sibling(button, previous);
                else
                    this._apps.set_child_below_sibling(button, null);
            }
            button.sync();
            previous = button;
        }

        this._syncFocus();
    }

    /** The closest button before this one that isn't on its way out. */
    _livePrevious(button) {
        let sibling = button.get_previous_sibling();
        while (sibling && this._leaving.has(sibling))
            sibling = sibling.get_previous_sibling();
        return sibling;
    }

    /**
     * A new button grows and fades in where it lands. The ease starts once the
     * button is on a stage view: before that its timeline wouldn't tick and the
     * button would stay invisible. If that never happens (taskbar hidden), the
     * button is simply shown.
     */
    _zoomIn(button) {
        if (!this._apps.is_mapped())
            return;
        button.set({
            pivot_point: new Graphene.Point({x: 0.5, y: 0.5}),
            opacity: 0,
            scale_x: ZOOM_SCALE,
            scale_y: ZOOM_SCALE,
        });
        let fallbackId = 0;
        const start = () => {
            button.disconnectObject(this);
            clearTimeout(fallbackId);
            button.ease({
                opacity: 255,
                scale_x: 1,
                scale_y: 1,
                duration: ZOOM_MS,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            });
        };
        button.connectObject(
            'stage-views-changed', () => button.peek_stage_views().length > 0 && start(),
            'destroy', () => clearTimeout(fallbackId),
            this);
        fallbackId = setTimeout(() => {
            button.disconnectObject(this);
            button.set({opacity: 255, scale_x: 1, scale_y: 1});
        }, 1000);
    }

    /**
     * A removed button shrinks and fades out in its place, then leaves the bar
     * (the ones after it move up then).
     */
    _zoomOut(button) {
        if (!button.is_mapped()) {
            button.destroy();
            return;
        }
        this._previews?.forget(button);
        button.closeMenu();
        button.reactive = false;
        this._leaving.add(button);
        let done = false;
        // Once only: destroying the button stops its ease, which lands here again.
        button._finishLeaving = () => {
            if (done)
                return;
            done = true;
            this._leaving?.delete(button);
            button.destroy();
        };
        button.pivot_point = new Graphene.Point({x: 0.5, y: 0.5});
        button.ease({
            opacity: 0,
            scale_x: ZOOM_SCALE,
            scale_y: ZOOM_SCALE,
            duration: ZOOM_MS,
            mode: Clutter.AnimationMode.EASE_IN_QUAD,
            onStopped: () => button._finishLeaving(),
        });
    }

    _clearLeaving() {
        for (const button of [...this._leaving])
            button._finishLeaving();
        this._leaving.clear();
    }

    // --- Drag to reorder -------------------------------------------------------
    // Pinned and unpinned apps are two separate groups: a button only moves
    // within its own group, so dragging never pins or unpins an app.

    _onDragBegin(button) {
        // The drag code counts slots by index: no half-gone buttons in between.
        this._clearLeaving();
        const children = this._apps.get_children();
        const index = children.indexOf(button);
        if (index < 0)
            return;
        // Where the pointer grabbed the button, relative to its slot, so the button
        // keeps that spot under the pointer as it slides.
        const [px, py] = global.get_pointer();
        const grab = this._axisPos(px, py) - this._offsets(children)[index];
        this._drag = {button, pinned: index < this._pinnedCount, original: children, grab};

        // The drop target for the whole drag: an empty actor over the entire stage, so
        // the pointer can stray off the bar without the drag leaving it. Only the
        // position along the bar counts (see handleDragOver).
        this._catcher = new Clutter.Actor({
            width: global.stage.width,
            height: global.stage.height,
        });
        this._catcher._delegate = this;
        Main.uiGroup.add_child(this._catcher);
    }

    _stopDrag() {
        this._drag = null;
        this._catcher?.destroy();
        this._catcher = null;
    }

    _onDragCancelled(button) {
        if (this._drag?.button !== button)
            return;
        // Slide everything back where it was. drag-end follows after DND's snap-back.
        this._drag.cancelled = true;
        this._slideToOrder(this._drag.original);
    }

    _onDragEnd(button) {
        if (this._drag?.button !== button)
            return;
        this._stopDrag();
        // Let the button settle into its slot.
        this._ease(button, this._translationProp(), 0);
        if (this._rebuildPending)
            this._rebuild(false);
    }

    /**
     * Where each of the buttons starts along the bar if laid out in this order.
     * Buttons differ in length (labelled or not), so slots follow from the order.
     */
    _offsets(buttons) {
        let offset = 0;
        return buttons.map(button => {
            const start = offset;
            offset += button.length + this._metrics.spacing;
            return start;
        });
    }

    _translationProp() {
        return this._apps.orientation === Clutter.Orientation.VERTICAL ? 'translation_y' : 'translation_x';
    }

    /** A stage point's position along the bar, in this._apps' coordinates. */
    _axisPos(stageX, stageY) {
        const [, x, y] = this._apps.transform_stage_point(stageX, stageY);
        return this._apps.orientation === Clutter.Orientation.VERTICAL ? y : x;
    }

    _ease(actor, prop, value) {
        actor.ease({
            [prop]: value,
            duration: REORDER_ANIMATION_MS,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
    }

    /** Index range [start, end) of the dragged button's group among this._apps' children. */
    _dragGroup() {
        const count = this._apps.get_n_children();
        return this._drag.pinned ? [0, this._pinnedCount] : [this._pinnedCount, count];
    }

    handleDragOver(source, _actor, x, y) {
        if (!this._drag || source !== this._drag.button)
            return DND.DragMotionResult.CONTINUE;
        if (this._drag.cancelled)
            return DND.DragMotionResult.NO_DROP;

        // x / y are stage coordinates (the catcher covers the stage). Only the position
        // along the bar matters, wherever the pointer is across it.
        const pos = this._axisPos(x, y);
        const [start, end] = this._dragGroup();
        const children = this._apps.get_children();
        const from = children.indexOf(source);
        if (from < start || from >= end)
            return DND.DragMotionResult.NO_DROP;

        // Where the button would start in each slot of its group (index in children).
        const others = children.filter(child => child !== source);
        const otherOffsets = this._offsets(others);
        const slotStart = index => index < others.length
            ? otherOffsets[index]
            : this._offsets(children).at(-1) + children.at(-1).length - source.length;
        // The button follows the pointer, but only along its own group: it can't
        // leave the bar or slide into the other group. It takes the slot it is nearest to.
        const visual = Math.max(slotStart(start), Math.min(slotStart(end - 1), pos - this._drag.grab));
        let to = start;
        for (let i = start + 1; i < end; i++) {
            if (Math.abs(slotStart(i) - visual) < Math.abs(slotStart(to) - visual))
                to = i;
        }
        if (to !== from) {
            const order = [...others];
            order.splice(to, 0, source);
            this._slideToOrder(order, source);
        }
        const prop = this._translationProp();
        source.remove_transition(prop);
        source[prop] = visual - slotStart(to);

        // Pointer over a button of the other group: blocked, a drop there is refused
        // (and snaps back). Empty space past either end just keeps the edge slot.
        const laidOut = this._apps.get_children();
        const offsets = this._offsets(laidOut);
        const half = this._metrics.spacing / 2;
        const slot = laidOut.findIndex((child, i) =>
            pos >= offsets[i] - half && pos < offsets[i] + child.length + half);
        const otherStart = this._drag.pinned ? end : 0;
        const otherEnd = this._drag.pinned ? children.length : start;
        this._drag.blocked = slot >= otherStart && slot < otherEnd;
        return this._drag.blocked ? DND.DragMotionResult.NO_DROP : DND.DragMotionResult.MOVE_DROP;
    }

    /**
     * Puts the buttons in the given order. Each one starts from where it is on
     * screen and glides into its new slot, except `skip` (positioned by the caller).
     */
    _slideToOrder(order, skip = null) {
        const prop = this._translationProp();
        const before = this._apps.get_children();
        const beforeOffsets = this._offsets(before);
        const shown = new Map(before.map((child, i) => [child, beforeOffsets[i] + child[prop]]));
        order.forEach((child, i) => {
            if (child.get_parent() === this._apps)
                this._apps.set_child_at_index(child, i);
        });
        const after = this._apps.get_children();
        const afterOffsets = this._offsets(after);
        after.forEach((child, i) => {
            if (child === skip || !shown.has(child))
                return;
            child.remove_transition(prop);
            child[prop] = shown.get(child) - afterOffsets[i];
            this._ease(child, prop, 0);
        });
    }

    acceptDrop(source) {
        if (!this._drag || source !== this._drag.button || this._drag.blocked)
            return false;

        const [start, end] = this._dragGroup();
        // Ungrouped, an app has a button per window: its first one sets its place.
        const ids = [...new Set(this._apps.get_children().slice(start, end).map(button => button.app.get_id()))];
        if (this._drag.pinned)
            this._setFavoriteOrder(ids);
        else
            this._order = ids;
        return true;
    }

    /**
     * Writes the favorites in the given order. Favorites that aren't shown
     * (e.g. uninstalled apps) keep their slots in the setting.
     */
    _setFavoriteOrder(ids) {
        const shown = new Set(ids);
        const current = global.settings.get_strv('favorite-apps');
        let next = 0;
        const updated = current.map(id => shown.has(id) ? ids[next++] : id);
        if (updated.some((id, i) => id !== current[i]))
            global.settings.set_strv('favorite-apps', updated);
    }

    _queueIconGeometry() {
        for (const button of this._buttons.values())
            button.queueIconGeometry();
    }

    _syncFocus() {
        const focusApp = Shell.WindowTracker.get_default().focus_app;
        // A dialog's button is its parent window's.
        let focusWindow = global.display.focus_window;
        while (focusWindow?.get_transient_for())
            focusWindow = focusWindow.get_transient_for();
        for (const button of this._buttons.values())
            button.setFocused(button.window ? button.window === focusWindow : button.app === focusApp);
    }
}

