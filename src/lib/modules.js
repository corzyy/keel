import GLib from 'gi://GLib';

// Shared by the shell side (features/panel/layout.js) and prefs.js, so it must
// not import anything from the shell.

/**
 * Panel modules that can be placed in the left / center / right section or hidden.
 * Modules with an `extension` belong to another extension and only exist while it runs.
 * Modules with a `page` have settings of their own on that prefs page; the layout editor links to it.
 */
export const MODULES = [
    {id: 'arcmenu', label: 'ArcMenu', icon: 'start-here-symbolic', extension: 'arcmenu@arcmenu.com'},
    {id: 'weather', label: 'Weather (Vane)', icon: 'weather-few-clouds-symbolic', extension: 'vane@local'},
    {id: 'activities', label: 'Activities', icon: 'view-dual-symbolic'},
    {id: 'taskbar', label: 'Taskbar', icon: 'view-app-grid-symbolic', page: 'taskbar'},
    {id: 'clock', label: 'Clock', icon: 'preferences-system-time-symbolic', page: 'status'},
    {id: 'indicators', label: 'Indicators', icon: 'input-keyboard-symbolic'},
    {id: 'quickSettings', label: 'Quick Settings', icon: 'emblem-system-symbolic', page: 'status'},
];

export const ZONES = ['left', 'center', 'right'];

const KNOWN = new Set(MODULES.map(m => m.id));

/** The panel-layout setting as {left, center, right}: known ids only, each at most once. */
export function readLayout(settings) {
    const raw = settings.get_value('panel-layout').recursiveUnpack();
    const seen = new Set();
    const layout = {};
    for (const zone of ZONES) {
        const ids = Array.isArray(raw[zone]) ? raw[zone] : [];
        layout[zone] = ids.filter(id => KNOWN.has(id) && !seen.has(id) && seen.add(id));
    }
    return layout;
}

export function writeLayout(settings, layout) {
    settings.set_value('panel-layout', new GLib.Variant('a{sas}', layout));
}

/** Known modules that are in no section. */
export function hiddenModules(layout) {
    const placed = new Set(ZONES.flatMap(zone => layout[zone]));
    return MODULES.filter(m => !placed.has(m.id)).map(m => m.id);
}

/**
 * Returns a copy of layout with module id moved to position index of zone.
 * zone 'hidden' (or anything that isn't a section) just removes it.
 */
export function moveModule(layout, id, zone, index) {
    const next = {};
    for (const z of ZONES)
        next[z] = layout[z].filter(m => m !== id);
    if (ZONES.includes(zone))
        next[zone].splice(Math.max(0, Math.min(index, next[zone].length)), 0, id);
    return next;
}
