import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const ROLES = ['quickSettings', 'dateMenu'];

/**
 * Owns the horizontal padding of the Quick Settings and clock buttons.
 *
 * jh-fixes' panel-clock-gap (made for dash-to-panel) narrows the gap between
 * Quick Settings and the clock by turning part of their horizontal padding
 * into margin. Keel draws its highlight inside an even border on every side
 * (PanelButtonStyle), so the highlight then hugs the icons on one side only.
 *
 * Undoing that afterwards (on a timer) turns into a tug of war that makes
 * the buttons jump. Instead the padding fields that PanelMenu.ButtonBox lays
 * out with are pinned (writes are ignored), and margins added to the
 * buttons' containers are reset in the same notify, before the next frame.
 *
 * Quick Settings keeps the theme's padding on both sides. The clock has none
 * on the right (it sits at the end of the panel): ButtonBox pads both sides
 * the same, so its padding is 0 and the left part becomes a margin on its
 * content instead.
 */
export class EvenButtonPadding {
    constructor() {
        this._buttons = [];
    }

    enable() {
        for (const role of ROLES) {
            const button = Main.panel.statusArea[role];
            if (!button?.container)
                continue;
            this._buttons.push(button);
            const clock = role === 'dateMenu';

            for (const [field, cssKey] of [['_natHPadding', '-natural-hpadding'], ['_minHPadding', '-minimum-hpadding']]) {
                let last = button[field] ?? 0;
                Object.defineProperty(button, field, {
                    configurable: true,
                    get() {
                        if (clock)
                            return 0;
                        try {
                            last = this.get_theme_node().get_length(cssKey);
                        } catch {}   // not on the stage for a moment (moved between boxes)
                        return last;
                    },
                    set(_value) {},
                });
            }

            if (clock) {
                // Follows the theme, which PanelButtonStyle changes (0 on a vertical panel).
                const syncMargin = () => {
                    const content = button.get_first_child();
                    if (!content)
                        return;
                    try {
                        content.margin_left = button.get_theme_node().get_length('-natural-hpadding');
                    } catch {}
                };
                button.connectObject('style-changed', syncMargin, this);
                syncMargin();
            }

            const container = button.container;
            container.connectObject(
                'notify::margin-left', () => container.margin_left && (container.margin_left = 0),
                'notify::margin-right', () => container.margin_right && (container.margin_right = 0),
                this);
            container.margin_left = container.margin_right = 0;
            button.queue_relayout();
        }
    }

    disable() {
        for (const button of this._buttons) {
            button.disconnectObject(this);
            button.container.disconnectObject(this);
            if (button === Main.panel.statusArea.dateMenu)
                button.get_first_child()?.set({margin_left: 0});
            delete button._natHPadding;
            delete button._minHPadding;
            button._onStyleChanged?.(button);   // back to plain fields, read from the theme
            button.queue_relayout();
        }
        this._buttons = [];
    }
}
