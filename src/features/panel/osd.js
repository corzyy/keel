import * as Layout from 'resource:///org/gnome/shell/ui/layout.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

/**
 * OSDs (volume, brightness, keyboard layout...) sit at the bottom of the
 * monitor, sized to the whole monitor, so with the panel at the bottom they
 * end up on top of it. Constrain them to the work area instead: the panel
 * reserves its edge (affectsStruts), so they move clear of it on any edge.
 */
export class OsdPlacement {
    constructor() {
        this._changed = new Set();   // MonitorConstraints we switched to the work area
    }

    enable() {
        // New monitors get new OSD windows. The OSD manager creates them in its own
        // monitors-changed handler, which was connected first and so runs before ours.
        Main.layoutManager.connectObject('monitors-changed', () => this._apply(), this);
        this._apply();
    }

    disable() {
        Main.layoutManager.disconnectObject(this);
        for (const constraint of this._changed) {
            if (constraint.get_actor())   // OSDs of unplugged monitors are gone
                constraint.work_area = false;
        }
        this._changed.clear();
    }

    _apply() {
        for (const osd of Main.osdWindowManager._osdWindows ?? []) {
            for (const constraint of osd?.get_constraints() ?? []) {
                if (!(constraint instanceof Layout.MonitorConstraint) || constraint.work_area)
                    continue;
                constraint.work_area = true;
                this._changed.add(constraint);
            }
        }
    }
}
