/**
 * Taskbar (and panel button, see features/panel/buttonStyle.js) sizes derived from the panel height, Windows 11 style: square
 * buttons with a small gap above and below, icons at ~70% of the button.
 * At the default 48px panel: 40px buttons, 28px icons, 4px gaps.
 *
 * icon-size is an upper limit, so icons never crowd their button.
 */
export function taskbarMetrics(settings) {
    const height = settings.get_int('panel-height');
    const margin = Math.max(2, Math.round(height * 0.08));
    const side = height - 2 * margin;
    // Even height so the radius (St rounds radii to whole pixels) is exactly
    // half of it and the ends come out as half circles.
    const pillHeight = Math.max(4, 2 * Math.round(height / 24));
    return {
        side,
        icon: Math.min(settings.get_int('icon-size'), Math.round(side * 0.7)),
        radius: Math.max(4, Math.round(side * 0.15)),
        spacing: Math.max(2, Math.round(height / 12)),
        // Length of a button that shows a label (window title or app name) next to its icon.
        labelLength: Math.round(side * 4),
        // Running indicator: a short pill on the panel's outer edge, longer when focused.
        pill: {
            height: pillHeight,
            running: 2 * pillHeight,
            focused: Math.round(side * 0.4),
            inset: Math.max(1, Math.round(margin / 2)),
        },
    };
}
