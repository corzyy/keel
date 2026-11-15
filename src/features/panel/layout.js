import Clutter from 'gi://Clutter';
import {InjectionManager} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {MODULES, ZONES, readLayout} from '../../lib/modules.js';

// The stock status icons that make up the 'indicators' module, in shell order.
const INDICATOR_ROLES = ['screenRecording', 'screenSharing', 'dwellClick', 'a11y', 'keyboard'];

// statusArea roles of the modules other extensions add.
const FOREIGN_ROLES = {arcmenu: 'ArcMenu', weather: 'Vane'};

/**
 * Moves the panel modules (Activities, taskbar, clock, indicators, Quick
 * Settings) into the left / center / right box as configured in panel-layout,
 * and hides the ones that are in no section.
 *
 * Status icons added by other extensions are left alone: left and center
 * modules go first in their box, right modules go last, so foreign icons end
 * up next to them.
 *
 * Modules from other extensions (ArcMenu) come and go, and put themselves back
 * where their own settings say, so re-apply whenever one is added or moved.
 */
export class PanelLayout {
    constructor(settings, extension) {
        this._settings = settings;
        this._extension = extension;
        this._injections = new InjectionManager();
        this._hidden = new Set();   // actors we hid, so we know which ones to show again
        this._watched = new Set();  // foreign actors we listen to for parent changes
    }

    enable() {
        const self = this;
        // The shell puts every stock indicator back in its default box whenever the
        // session mode changes (e.g. after unlocking), so re-apply after it.
        this._injections.overrideMethod(Main.panel, '_updatePanel', original => function () {
            original.call(this);
            self._apply();
        });
        this._injections.overrideMethod(Main.panel, 'addToStatusArea', original => function (role, ...args) {
            const indicator = original.call(this, role, ...args);
            if (Object.values(FOREIGN_ROLES).includes(role))
                self._queueApply();
            return indicator;
        });
        this._settings.connectObject('changed::panel-layout', () => this._apply(), this);
        this._apply();
    }

    disable() {
        this._settings.disconnectObject(this);
        this._injections.clear();
        if (this._applyId) {
            clearTimeout(this._applyId);
            this._applyId = 0;
        }
        for (const actor of this._watched)
            actor.disconnectObject(this);
        this._watched.clear();

        for (const actor of this._hidden)
            actor.show();
        this._hidden.clear();
        // Puts the stock indicators back where (and as visible as) the session mode wants them.
        Main.panel._updatePanel();
    }

    _actorsFor(id) {
        const area = Main.panel.statusArea;
        let actors;
        switch (id) {
        case 'activities': actors = [area.activities?.container]; break;
        case 'clock': actors = [area.dateMenu?.container]; break;
        case 'quickSettings': actors = [area.quickSettings?.container]; break;
        case 'indicators': actors = INDICATOR_ROLES.map(role => area[role]?.container); break;
        case 'taskbar': actors = [this._extension.panelModules?.get('taskbar')]; break;
        default: actors = [area[FOREIGN_ROLES[id]]?.container];
        }
        return actors.filter(Boolean);
    }

    // Coalesces the burst of remove/add an extension does when it repositions its button.
    _queueApply() {
        if (this._applyId)
            return;
        this._applyId = setTimeout(() => {
            this._applyId = 0;
            this._apply();
        }, 0);
    }

    _watch(actor) {
        if (this._watched.has(actor))
            return;
        this._watched.add(actor);
        actor.connectObject(
            'parent-set', () => this._queueApply(),
            'destroy', () => {
                this._watched.delete(actor);
                this._hidden.delete(actor);
            }, this);
    }

    _apply() {
        const panel = Main.panel;
        for (const id of Object.keys(FOREIGN_ROLES))
            this._actorsFor(id).forEach(actor => this._watch(actor));
        const layout = readLayout(this._settings);
        const boxes = {left: panel._leftBox, center: panel._centerBox, right: panel._rightBox};

        for (const zone of ZONES) {
            const box = boxes[zone];
            const actors = layout[zone].flatMap(id => this._actorsFor(id));
            actors.forEach((actor, i) => {
                if (this._hidden.delete(actor))
                    actor.show();
                if (zone === 'right')
                    this._append(actor, box);
                else
                    this._insert(actor, box, i);
            });
        }

        const placed = new Set(ZONES.flatMap(zone => layout[zone]));
        for (const {id} of MODULES) {
            if (placed.has(id))
                continue;
            for (const actor of this._actorsFor(id)) {
                actor.hide();
                this._hidden.add(actor);
            }
        }

        // Notifications pop up below/above the clock, like the stock shell does.
        const clockZone = ZONES.find(zone => layout[zone].includes('clock'));
        Main.messageTray.bannerAlignment = {
            left: Clutter.ActorAlign.START,
            right: Clutter.ActorAlign.END,
        }[clockZone] ?? Clutter.ActorAlign.CENTER;
    }

    _insert(actor, box, index) {
        const parent = actor.get_parent();
        if (parent === box) {
            if (box.get_child_at_index(index) !== actor)
                box.set_child_at_index(actor, index);
            return;
        }
        parent?.remove_child(actor);
        box.insert_child_at_index(actor, index);
    }

    _append(actor, box) {
        const parent = actor.get_parent();
        if (parent === box) {
            if (box.get_last_child() !== actor)
                box.set_child_above_sibling(actor, null);
            return;
        }
        parent?.remove_child(actor);
        box.add_child(actor);
    }
}
