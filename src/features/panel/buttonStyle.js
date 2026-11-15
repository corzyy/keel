import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {taskbarMetrics} from '../../lib/metrics.js';

/**
 * Gives every panel button (clock, Quick Settings, indicators, Activities,
 * ArcMenu and other extensions' buttons) the same highlight as the taskbar
 * buttons: a rounded rectangle as tall as a taskbar button, same colors.
 *
 * The stock theme draws the highlight as an inset shadow inside a 3px
 * transparent border with a 999px radius, which is sized for the 32px stock
 * top bar; on a taller panel it becomes a tall pill. Sizes follow the panel
 * height, so the CSS is generated and loaded as an extra stylesheet.
 *
 * With the panel at the bottom it also fixes where panel menus (calendar,
 * ArcMenu, indicators) open: the theme gives them margin-bottom: 1.75em to keep
 * top-bar menus off the screen's bottom edge, which on a bottom panel ends up
 * as a 26px gap between menu and panel. Quick Settings sets its own and is fine.
 */
export class PanelButtonStyle {
    constructor(settings) {
        this._settings = settings;
    }

    enable() {
        Main.panel.add_style_class_name('keel-panel');
        this._settings.connectObject(
            'changed::panel-height', () => this._load(),
            'changed::position', () => this._load(),
            this);
        // No need to watch for theme changes: Main.loadTheme() copies custom
        // stylesheets onto the new theme. (Don't listen to ThemeContext::changed
        // here: it also fires for our own (un)loads and loops.)
        this._load();
    }

    disable() {
        this._settings.disconnectObject(this);
        this._unload();
        Main.panel.remove_style_class_name('keel-panel');
    }

    _load() {
        this._unload();
        this._unloadStale();
        const dir = stylesheetDir();
        GLib.mkdir_with_parents(dir, 0o700);
        // New name every time: St may keep a parsed stylesheet cached per file.
        this._file = Gio.File.new_for_path(GLib.build_filenamev([dir, `panel-${GLib.uuid_string_random()}.css`]));
        this._file.replace_contents(new TextEncoder().encode(this._css()), null, false,
            Gio.FileCreateFlags.REPLACE_DESTINATION, null);
        currentTheme().load_stylesheet(this._file);
    }

    // Stylesheets of earlier builds that never got unloaded (crash, hot reload)
    // stay in the theme until re-login; they're all ours if they live in our dir.
    _unloadStale() {
        const prefix = GLib.build_filenamev([stylesheetDir(), 'panel-']);
        const theme = currentTheme();
        for (const file of theme.get_custom_stylesheets()) {
            if (file.get_path()?.startsWith(prefix))
                theme.unload_stylesheet(file);
        }
    }

    _unload() {
        if (!this._file)
            return;
        // The current theme, not the one we loaded into: a theme change moves it over.
        currentTheme().unload_stylesheet(this._file);
        try {
            this._file.delete(null);
        } catch {}
        this._file = null;
    }

    _css() {
        const {side, radius} = taskbarMetrics(this._settings);
        const height = this._settings.get_int('panel-height');
        // The transparent border insets the highlight to the taskbar button height;
        // the inner (highlight) radius is the outer radius minus the border.
        const inset = Math.max(0, Math.round((height - side) / 2));
        const outer = radius + inset;
        const shadow = color => `box-shadow: inset 0 0 0 100px ${color} !important;`;
        const button = '#panel.keel-panel .panel-button';
        const position = this._settings.get_string('position');
        const menus = position === 'top' ? '' : `
/* Menus open upwards / sideways. BoxPointer places the menu by its size
   *including* margins but the margin always ends up below it, so any vertical
   margin is a gap (or an offset). With none, the stock 6px arrow rise leaves
   the same 6px gap Quick Settings has. */
.popup-menu.panel-menu {
    margin-top: 0 !important;
    margin-bottom: 0 !important;
}
`;
        // Left / right: no horizontal padding (it would overflow the column);
        // icons stacked with even gaps. The vertical padding is set on each
        // button's content by VerticalPanel (buttons ignore their own).
        const vpad = Math.round(side * 0.2);
        const vertical = position !== 'left' && position !== 'right' ? '' : `
${button} {
    -natural-hpadding: 0 !important;
    -minimum-hpadding: 0 !important;
}
${button} .system-status-icon,
${button} .panel-status-indicators-box > .system-status-icon {
    padding: ${Math.round(vpad / 2)}px 0 !important;
}
${button} .clock-display-box { spacing: 0; }
`;
        // A hairline on the edge facing the desktop, like the edge highlight
        // libadwaita draws around dark windows, a touch fainter: 1px of white at 4.5%. Off where the
        // panel is transparent (overview, lock / login screen).
        const edge = {
            bottom: '0 1px', top: '0 -1px', left: '-1px 0', right: '1px 0',
        }[position] ?? '0 1px';
        const border = `
#panel.keel-panel { box-shadow: inset ${edge} 0 0 rgba(255, 255, 255, 0.045) !important; }
#panel.keel-panel:overview,
#panel.keel-panel.lock-screen,
#panel.keel-panel.unlock-screen,
#panel.keel-panel.login-screen { box-shadow: none !important; }
`;
        return `${menus}${vertical}${border}
${button} {
    border: ${inset}px solid transparent !important;
    border-radius: ${outer}px !important;
    background: none !important;
    ${shadow('transparent')}
}
${button}:hover, ${button}:focus { ${shadow('rgba(255, 255, 255, 0.08)')} }
${button}:active, ${button}:checked { ${shadow('rgba(255, 255, 255, 0.11)')} }
${button}:active:hover, ${button}:checked:hover { ${shadow('rgba(255, 255, 255, 0.15)')} }

/* The clock draws its highlight on the inner label instead; move it to the button. */
${button}.clock-display .clock,
${button}.clock-display:hover .clock,
${button}.clock-display:focus .clock,
${button}.clock-display:active .clock,
${button}.clock-display:checked .clock {
    border: none !important;
    box-shadow: none !important;
}
`;
    }
}

function currentTheme() {
    return St.ThemeContext.get_for_stage(global.stage).get_theme();
}

function stylesheetDir() {
    return GLib.build_filenamev([GLib.get_user_runtime_dir(), 'keel']);
}
