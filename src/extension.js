import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {PanelButtonStyle} from './features/panel/buttonStyle.js';
import {PanelClock} from './features/panel/clock.js';
import {EvenButtonPadding} from './features/panel/evenPadding.js';
import {PanelContextMenu} from './features/panel/contextMenu.js';
import {PanelLayout} from './features/panel/layout.js';
import {QuickSettingsOptions} from './features/panel/quickSettings.js';
import {OsdPlacement} from './features/panel/osd.js';
import {OverviewWorkArea} from './features/panel/overview.js';
import {VerticalPanel} from './features/panel/vertical.js';
import {PanelPlacement} from './features/panel/placement.js';
import {Taskbar} from './features/taskbar/taskbar.js';

// Order matters: features are enabled top to bottom and disabled in reverse.
const FEATURES = [
    PanelPlacement,
    Taskbar,
    PanelLayout,   // after Taskbar: it moves the taskbar around
    VerticalPanel, // after PanelLayout: moves the panel's boxes into a column for left/right
    PanelClock,
    OsdPlacement,
    OverviewWorkArea,
    QuickSettingsOptions,
    PanelContextMenu,
    PanelButtonStyle,
    EvenButtonPadding, // after PanelButtonStyle: its stylesheet makes jh-fixes re-apply
];

export default class KeelExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this.panelModules = new Map();   // module id -> actor, for modules Keel creates itself
        this._features = [];
        for (const Feature of FEATURES) {
            try {
                const feature = new Feature(this._settings, this);
                this._features.push(feature);
                feature.enable();
            } catch (e) {
                console.error(`keel: ${Feature.name} failed to enable`, e);
            }
        }
    }

    disable() {
        for (const feature of this._features.reverse()) {
            try {
                feature.disable();
            } catch (e) {
                console.error(`keel: ${feature.constructor.name} failed to disable`, e);
            }
        }
        this._features = null;
        this._settings = null;
        this.panelModules = null;
    }
}
