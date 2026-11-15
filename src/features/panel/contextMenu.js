import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {menuSide} from '../../lib/panel.js';

/**
 * Right click on an empty spot of the panel opens a small menu with
 * "Keel Settings", opened at the pointer like the desktop background menu.
 */
export class PanelContextMenu {
    constructor(settings, extension) {
        this._settings = settings;
        this._extension = extension;
    }

    enable() {
        this._menuManager = new PopupMenu.PopupMenuManager(Main.panel);
        this._createMenu();
        // The menu opens away from the panel, so rebuild it when the panel changes edge.
        this._settings.connectObject('changed::position', () => {
            this._menu.destroy();
            this._createMenu();
        }, this);

        this._gesture = new Clutter.ClickGesture({
            name: 'keel-panel-context-menu',
            required_button: Clutter.BUTTON_SECONDARY,
            recognize_on_press: true,
        });
        // Only take part for presses on the panel itself (empty space). Buttons,
        // the taskbar and status menus are reactive children and keep their own
        // right click.
        this._gesture.connect('should-handle-sequence', (_gesture, event) => {
            const target = global.stage.get_event_actor(event);
            // The stock panel, or VerticalPanel's column standing in for it.
            return target === Main.panel || Boolean(target?._keelPanel);
        });
        this._gesture.connect('recognize', () => {
            const {x, y} = this._gesture.get_coords_abs();
            Main.layoutManager.setDummyCursorGeometry(x, y, 0, 0);
            this._menu.open();
        });
        // On panelBox, the parent of both panels, so it works on every edge.
        Main.layoutManager.panelBox.add_action(this._gesture);
    }

    _createMenu() {
        this._menu = new PopupMenu.PopupMenu(Main.layoutManager.dummyCursor, 0, menuSide(this._settings));
        this._menu.addAction('Keel Settings', () => this._extension.openPreferences());
        this._menu.actor.add_style_class_name('background-menu');
        this._menu.actor.hide();
        Main.layoutManager.uiGroup.add_child(this._menu.actor);
        this._menuManager.addMenu(this._menu);
    }

    disable() {
        this._settings.disconnectObject(this);
        Main.layoutManager.panelBox.remove_action(this._gesture);
        this._gesture = null;
        this._menu.destroy();   // also removes it from the menu manager
        this._menu = this._menuManager = null;
    }
}
