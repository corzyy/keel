# Keel

My own take on a "Dash to Panel": one bar at the bottom of the screen that holds
the stock top bar (clock, Quick Settings, tray), an app grid button and a taskbar.

## Install

Needs GNOME Shell 51, `git` and `make`.

    make install

Log out and back in the first time (new extensions are only discovered at login), then:

    gnome-extensions disable dash-to-panel@jderose9.github.com   # they fight over the panel
    gnome-extensions enable keel@local

After that, `make install` (or `make watch`) reloads the running extension directly.
Settings: `gnome-extensions prefs keel@local`.

## Developing

    make watch    # reinstall + reload on every save in src/ or loader/
    make logs     # follow GNOME Shell's log, filtered to keel
    make nested   # GNOME Shell in a window (shares your dconf!)

## How it works

- **Panel placement** (`features/panel/placement.js`): moves `Main.layoutManager.panelBox`
  to the bottom edge by wrapping `LayoutManager._updateBoxes`. The box is tracked with
  `affectsStruts`, so the work area follows. Panel menus flip upwards on their own.
- **Vertical panel** (`features/panel/vertical.js`): for a left / right panel the stock
  panel is hidden and its three boxes (same objects, so statusArea keeps working) move into
  a column, stacked top / center / bottom. Panel buttons get stacked content, padding on
  their content (they ignore their own) and fill the column; the clock shows time over
  date; menus open sideways. `PanelPlacement` keeps pointer barriers at panel size.
- **Panel layout** (`features/panel/layout.js`): moves the modules (Activities, taskbar,
  clock, status indicators, Quick Settings) into the left / center / right box per the
  `panel-layout` setting and hides the rest. Re-applied after `Panel._updatePanel`, which
  resets the stock indicators on every session-mode change. Prefs edits it as drag & drop
  columns (`lib/modules.js` is shared by both sides).
- **Clock** (`features/panel/clock.js`): `clock-style` is `gnome` (stock label) or
  `windows` (Windows 11 layout: time over the locale's short date, right-aligned,
  in the panel's own font like the stock clock). A left / right panel always gets time over a short date, centered.
  The stock label stays hidden next to Keel's and drives its updates.
- **OSDs** (`features/panel/osd.js`): volume / brightness popups are placed in the work
  area instead of the whole monitor, so they sit clear of the panel on any edge.
- **Quick Settings options** (`features/panel/quickSettings.js`): `show-power-icon` hides
  the power indicator (it re-shows itself, so it's kept hidden). In prefs, the click menu
  of a module with a `page` in the layout editor links to that settings page.
- **Overview** (`features/panel/overview.js`): the stock overview layout only expects a
  top panel (full monitor height, x = 0), so it's constrained to the work area and its
  work area box set to all of it: the dash and workspaces stay clear of the panel.
- **Button padding** (`features/panel/evenPadding.js`): pins the horizontal padding of Quick
  Settings and the clock to the theme's (jh-fixes' `panel-clock-gap` moves it into margin,
  which made Keel's highlight lopsided) and resets added margins in the same notify.
  The clock has no padding on the right (its left padding is a margin on its content).
- **Context menu** (`features/panel/contextMenu.js`): right click on empty panel space
  opens "Keel Settings". A `Clutter.ClickGesture` on the panel that only handles presses
  whose target is the panel itself, so buttons keep their own right click.
- **Taskbar** (`features/taskbar/`): show-apps button + one button per pinned/running
  app inserted into the panel's left box. Left click focuses / minimizes, middle click
  opens a new window, right click shows the normal app menu. Dots = open windows.
  Buttons can be dragged to reorder them (`DND.makeDraggable`). The button itself slides
  along the bar (translation, kept within its group); DND only moves an invisible stand-in; the drop target is an empty stage-sized actor, so only
  the pointer's position along the bar counts. Pinned and unpinned apps are separate groups, and a button only moves within its
  own group: over a button of the other group the drag is blocked (no-drop cursor, a
  drop there snaps back), so dragging never pins or unpins. Pinned order is written to `favorite-apps`;
  unpinned order lives in memory. Rebuilds are held back while a drag is running.
- **Settings** (`prefs.js`, `prefs/`): four pages. *Panel*: screen edge and size first,
  then the layout as four columns (left, center, right, hidden) whose chips are dragged or
  moved from a click menu (which also links to the module's own page). *Taskbar*: apps
  (app grid button, pinned, grouping), appearance (icon size, labels) and window previews.
  *Clock & Status*: clock style cards and Quick Settings options. *About*: build, source
  checkout, reset all. Sizes and delays are preset toggles (no sliders); options that do
  nothing in the current state (labels on a vertical bar, preview options with previews off)
  are greyed out. Own icons live in `icons/` (added to the icon theme search path), the
  stylesheet in `prefs/style.css`.
- **Window previews** (`features/taskbar/windowPreview.js`): hovering a button for
  `preview-delay` ms shows live thumbnails (`Clutter.Clone`s) of its windows in one shared
  popup (top chrome); click to switch, middle click / × to close. Moving to another button
  while it's open switches at once. `window-previews`, `preview-size` in prefs.

## Layout

    loader/   thin entry points installed next to metadata.json; they import the
              real code from builds/<id>/ so that updates load without a re-login
    src/      the extension itself
      features/  one directory per feature (panel, taskbar)
      lib/       shared helpers (modules.js is also used by prefs.js)
      schemas/   GSettings schema
    tools/    install.sh, watch.sh

## Ideas / next steps

- [x] window previews on hover
- [ ] group vs. ungroup windows per app, show window titles
- [ ] drag & drop to reorder / pin apps
- [ ] panel on every monitor
- [ ] intellihide (auto-hide when a window touches the panel)
- [ ] scroll on an app to cycle its windows
- [x] position: left / right (vertical panel)
