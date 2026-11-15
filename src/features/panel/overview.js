import {InjectionManager} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Layout from 'resource:///org/gnome/shell/ui/layout.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

/**
 * Keeps the overview (search, workspaces, app grid, dash) out of the panel.
 *
 * The overview covers the whole primary monitor and its ControlsManagerLayout
 * only expects a panel at the top: it moves its content down by the work
 * area's top inset but keeps the monitor's full height, and always starts at
 * x = 0. So with a bottom panel the dash and workspaces go under it, and with
 * a left / right one everything does.
 *
 * Instead the overview is constrained to the work area (which the panel
 * reserves), and the layout's work area box becomes the whole of it.
 */
export class OverviewWorkArea {
    constructor() {
        this._injections = new InjectionManager();
        this._constraint = null;
    }

    enable() {
        const overview = Main.overview._overview;
        const layout = overview?._controls?.layout_manager;
        if (!overview || !layout?._workAreaBox)
            return;
        this._layout = layout;

        this._constraint = overview.get_constraints()
            .find(c => c instanceof Layout.MonitorConstraint && !c.work_area) ?? null;
        if (this._constraint)
            this._constraint.work_area = true;

        // Its signal handlers call this._updateWorkAreaBox(), so this override is used.
        this._injections.overrideMethod(layout, '_updateWorkAreaBox', () => function () {
            const monitor = Main.layoutManager.primaryMonitor;
            if (!monitor)
                return;
            const workArea = Main.layoutManager.getWorkAreaForMonitor(monitor.index);
            this._workAreaBox.set_origin(0, 0);
            this._workAreaBox.set_size(workArea.width, workArea.height);
        });
        this._refresh();
    }

    disable() {
        this._injections.clear();
        if (this._constraint)
            this._constraint.work_area = false;
        this._constraint = null;
        this._refresh();
        this._layout = null;
    }

    _refresh() {
        if (!this._layout)
            return;
        this._layout._updateWorkAreaBox();
        this._layout.layout_changed();
    }
}
