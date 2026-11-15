import St from 'gi://St';

const SIDES = {top: St.Side.TOP, bottom: St.Side.BOTTOM, left: St.Side.LEFT, right: St.Side.RIGHT};

/** Screen edge the panel is on, as an St.Side. Also the side popups point to, so they open away from it. */
export function menuSide(settings) {
    return SIDES[settings.get_string('position')] ?? St.Side.BOTTOM;
}

/** Whether the panel runs along the left or right edge. */
export function isVertical(settings) {
    const position = settings.get_string('position');
    return position === 'left' || position === 'right';
}
