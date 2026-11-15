import * as Main from 'resource:///org/gnome/shell/ui/main.js';

/**
 * Options of the Quick Settings panel module: hides the power indicator
 * (battery / shutdown icon and percentage) when show-power-icon is off.
 *
 * The indicator shows itself again whenever one of its icons changes
 * visibility (SystemIndicator._syncIndicatorsVisible), so keep hiding it.
 * Quick Settings creates its indicators asynchronously, so at login it may
 * not exist yet: wait for it to be added.
 */
export class QuickSettingsOptions {
    constructor(settings) {
        this._settings = settings;
        this._power = null;
    }

    enable() {
        this._settings.connectObject('changed::show-power-icon', () => this._sync(), this);
        const quickSettings = Main.panel.statusArea.quickSettings;
        quickSettings?._indicators?.connectObject('child-added', () => this._sync(), this);
        this._sync();
    }

    disable() {
        this._settings.disconnectObject(this);
        Main.panel.statusArea.quickSettings?._indicators?.disconnectObject(this);
        this._release();
    }

    _sync() {
        const power = Main.panel.statusArea.quickSettings?._system;
        if (!power)
            return;
        if (this._settings.get_boolean('show-power-icon')) {
            this._release();
            return;
        }
        if (this._power === power)
            return;
        this._release();
        this._power = power;
        power.connectObject('notify::visible', () => {
            if (power.visible)
                power.hide();
        }, this);
        power.hide();
    }

    _release() {
        if (!this._power)
            return;
        this._power.disconnectObject(this);
        // The same rule the indicator uses itself.
        this._power.visible = this._power.get_children().some(child => child.visible);
        this._power = null;
    }
}
