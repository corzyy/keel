import Clutter from 'gi://Clutter';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {taskbarMetrics} from '../../lib/metrics.js';
import {isVertical, menuSide} from '../../lib/panel.js';

/**
 * Left / right panel.
 *
 * Main.panel lays its left / center / right box out side by side in its own
 * vfunc_allocate, which can't be replaced. So for a vertical panel the stock
 * panel is hidden and its three boxes (the same objects, so statusArea,
 * _updatePanel, addToStatusArea and PanelLayout keep working) are moved into
 * a column of our own, stacked top / center / bottom.
 *
 * What's in them is turned on its side too: horizontal box layouts inside
 * panel buttons (Quick Settings icons, ArcMenu, Activities dots...) become
 * vertical (PanelClock gives the clock a two-line label), and every panel
 * menu opens sideways, away from the panel. The taskbar handles its own orientation.
 */
export class VerticalPanel {
    constructor(settings) {
        this._settings = settings;
        this._column = null;
        this._oriented = new Map();      // BoxLayout -> original orientation
        this._padded = new Map();        // panel button -> {content, style, xAlign, xExpand} to restore
        this._menuSides = new Map();     // BoxPointer -> original arrow side
    }

    enable() {
        this._settings.connectObject(
            'changed::position', () => this._sync(),
            // Paddings derive from the thickness: rebuild.
            'changed::panel-height', () => {
                if (this._column) {
                    this._leave();
                    this._sync();
                }
            },
            this);
        this._sync();
    }

    disable() {
        this._settings.disconnectObject(this);
        this._leave();
        this._syncMenus();   // back to the original sides
    }

    _sync() {
        const vertical = isVertical(this._settings);
        if (vertical && !this._column)
            this._enter();
        else if (!vertical && this._column)
            this._leave();
        else if (vertical)
            this._syncMenus();   // left <-> right
    }

    _boxes() {
        const panel = Main.panel;
        return [
            [panel._leftBox, Clutter.ActorAlign.START],
            [panel._centerBox, Clutter.ActorAlign.CENTER],
            [panel._rightBox, Clutter.ActorAlign.END],
        ];
    }

    _enter() {
        const panel = Main.panel;
        // name 'panel' so the theme's (and other extensions') #panel rules apply.
        this._column = new St.Widget({
            name: 'panel',
            reactive: true,
            x_expand: true,
            y_expand: true,
            layout_manager: new Clutter.BinLayout(),
        });
        this._column._keelPanel = true;
        const syncStyle = () => {
            this._column.style_class = panel.style_class;
            this._column.pseudo_class = panel.pseudo_class;
        };
        panel.connectObject('notify::style-class', syncStyle, 'notify::pseudo-class', syncStyle, this);
        syncStyle();

        this._saved = new Map();
        for (const [box, align] of this._boxes()) {
            this._saved.set(box, {
                x_expand: box.x_expand, y_expand: box.y_expand,
                x_align: box.x_align, y_align: box.y_align,
                orientation: box.orientation,
            });
            panel.remove_child(box);
            this._column.add_child(box);
            // BinLayout only honors x/y_align for children that expand.
            box.set({
                orientation: Clutter.Orientation.VERTICAL,
                x_expand: true,
                y_expand: true,
                x_align: Clutter.ActorAlign.FILL,
                y_align: align,
            });
            box.connectObject('child-added', (_box, child) => {
                this._turn(child);
                this._syncMenus();
            }, this);
            box.get_children().forEach(child => this._turn(child));
        }

        panel.hide();
        Main.layoutManager.panelBox.add_child(this._column);
        this._syncMenus();
    }

    _leave() {
        if (!this._column)
            return;
        const panel = Main.panel;
        panel.disconnectObject(this);

        for (const [box] of this._boxes()) {
            box.disconnectObject(this);
            this._column.remove_child(box);
            panel.add_child(box);
            box.set(this._saved.get(box));
        }
        this._saved = null;

        for (const [layout, orientation] of this._oriented)
            layout.orientation = orientation;
        this._oriented.clear();
        for (const [button, {content, style, xAlign, xExpand}] of this._padded) {
            content.style = style;
            button.x_align = xAlign;
            button.x_expand = xExpand;
        }
        this._padded.clear();

        this._column.destroy();
        this._column = null;
        panel.show();
        this._syncMenus();
    }

    /** Turns the horizontal box layouts inside a panel item vertical. */
    _turn(actor, depth = 0) {
        if (depth > 4 || actor.has_style_class_name?.('keel-taskbar'))
            return;   // the taskbar lays itself out
        if (depth === 0) {
            // Box children are the indicators' containers (St.Bin around the button).
            const button = actor.get_first_child?.();
            if (button?.has_style_class_name?.('panel-button'))
                this._pad(button);
        }
        if (actor instanceof St.BoxLayout && actor.orientation === Clutter.Orientation.HORIZONTAL &&
            !this._oriented.has(actor)) {
            this._oriented.set(actor, actor.orientation);
            actor.orientation = Clutter.Orientation.VERTICAL;
        }
        for (const child of actor.get_children())
            this._turn(child, depth + 1);
    }

    /**
     * Panel buttons (PanelMenu.ButtonBox) size their height from their content
     * alone and ignore their own CSS padding: in a horizontal panel the panel
     * height decides. In a column they'd be squeezed to the content, so pad
     * the content instead. The highlight (inset by the transparent border from
     * PanelButtonStyle) then gets the same gap around the content as a taskbar
     * icon, and is never shorter than a taskbar button.
     */
    _pad(button) {
        const content = button.get_first_child();
        if (!content || this._padded.has(button))
            return;
        const {side} = taskbarMetrics(this._settings);
        const inset = Math.round((this._settings.get_int('panel-height') - side) / 2);
        const gap = Math.round(side * 0.2);
        this._padded.set(button, {content, style: content.style, xAlign: button.x_align, xExpand: button.x_expand});
        content.style = `${content.style ?? ''} padding-top: ${inset + gap}px; padding-bottom: ${inset + gap}px; min-height: ${side - 2 * gap}px;`;
        // Some buttons (ArcMenu: x_expand false) sit centered at their natural
        // width, as the container only stretches expanding children. Fill the
        // column instead, so the highlight is as wide as a taskbar button and
        // menus (anchored to the button) open beside the panel, not over it.
        button.x_align = Clutter.ActorAlign.FILL;
        button.x_expand = true;
    }

    /** Panel menus open away from the panel: sideways for a vertical one, stock otherwise. */
    _syncMenus() {
        const vertical = Boolean(this._column);
        const side = menuSide(this._settings);
        for (const indicator of Object.values(Main.panel.statusArea)) {
            if (!indicator)
                continue;
            // .menu for stock indicators, ArcMenu keeps its menus elsewhere.
            for (const menu of [indicator.menu, indicator.arcMenu, indicator.arcMenuContextMenu]) {
                const pointer = menu?._boxPointer;
                if (!pointer)
                    continue;
                if (vertical) {
                    if (!this._menuSides.has(pointer))
                        this._menuSides.set(pointer, pointer._userArrowSide);
                    pointer._userArrowSide = pointer._arrowSide = side;
                } else if (this._menuSides.has(pointer)) {
                    pointer._userArrowSide = pointer._arrowSide = this._menuSides.get(pointer);
                }
            }
        }
        if (!vertical)
            this._menuSides.clear();
    }
}
