import {InjectionManager} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {isVertical} from '../../lib/panel.js';

/**
 * Moves layoutManager.panelBox to the configured screen edge and sizes it.
 * panelBox is tracked with affectsStruts, so moving it is enough for the work
 * area (and maximized windows) to follow, on any edge.
 *
 * Top / bottom: the stock panel inside it, with the configured height.
 * Left / right: a full-height column, panel-height wide (its content is
 * handled by VerticalPanel).
 */
export class PanelPlacement {
    constructor(settings) {
        this._settings = settings;
        this._injections = new InjectionManager();
    }

    enable() {
        const settings = this._settings;
        const layout = Main.layoutManager;

        this._injections.overrideMethod(layout, '_updateBoxes', original => function () {
            original.call(this);
            const monitor = this.primaryMonitor;
            if (!monitor)
                return;
            const thickness = settings.get_int('panel-height');
            switch (settings.get_string('position')) {
            case 'bottom':
                // Main.panel has a fixed height (see _syncHeight), so no need to wait for allocation.
                this.panelBox.set_position(monitor.x, monitor.y + monitor.height - Main.panel.height);
                break;
            case 'left':
                this.panelBox.set_position(monitor.x, monitor.y);
                this.panelBox.set_size(thickness, monitor.height);
                break;
            case 'right':
                this.panelBox.set_position(monitor.x + monitor.width - thickness, monitor.y);
                this.panelBox.set_size(thickness, monitor.height);
                break;
            }
        });

        // The panel barrier and the hot corner barriers are sized from
        // panelBox.height, meant for a top bar. For a full-height column they'd
        // run along the whole screen edge (blocking the way to a neighbouring
        // monitor). The stock handler is bound at startup, so fix up after it.
        layout.panelBox.connectObject('notify::allocation', () => this._fixBarriers(), this);
        layout.connectObject('hot-corners-changed', () => this._fixBarriers(), this);

        settings.connectObject(
            'changed::position', () => this._update(),
            'changed::panel-height', () => this._syncHeight(),
            this);

        this._syncHeight();
    }

    disable() {
        this._settings.disconnectObject(this);
        Main.layoutManager.panelBox.disconnectObject(this);
        Main.layoutManager.disconnectObject(this);
        this._injections.clear();

        Main.panel.set_height(-1);
        Main.layoutManager._updateBoxes();
        Main.layoutManager._panelBoxChanged();
    }

    _fixBarriers() {
        if (!isVertical(this._settings))
            return;
        const layout = Main.layoutManager;
        layout._destroyPanelBarrier();
        const size = this._settings.get_int('panel-height');
        layout.hotCorners.forEach(corner => corner?.setBarrierSize(size));
    }

    _syncHeight() {
        Main.panel.set_height(this._settings.get_int('panel-height'));
        this._update();
    }

    _update() {
        Main.layoutManager._updateBoxes();
        Main.layoutManager._panelBoxChanged();
        this._fixBarriers();
    }
}
