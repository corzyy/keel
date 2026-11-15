UUID := keel@local
SRC := src
DEST := $(HOME)/.local/share/gnome-shell/extensions/$(UUID)

.PHONY: all schemas install uninstall pack clean watch nested logs

all: schemas

schemas: $(SRC)/schemas/gschemas.compiled

$(SRC)/schemas/gschemas.compiled: $(SRC)/schemas/*.gschema.xml
	glib-compile-schemas --strict $(SRC)/schemas

install: schemas
	tools/install.sh $(SRC) $(DEST) $(UUID)

uninstall:
	-gnome-extensions disable $(UUID)
	rm -rf $(DEST)

pack: schemas
	mkdir -p dist
	gnome-extensions pack $(SRC) --force --extra-source=features --extra-source=lib --out-dir=dist

clean:
	rm -rf dist $(SRC)/schemas/gschemas.compiled

watch: install
	tools/watch.sh

# Throwaway GNOME Shell in a window, for testing without logging out.
# Note: it shares your dconf, so enabling extensions there enables them for real too.
nested: install
	MUTTER_DEBUG_DUMMY_MODE_SPECS=1600x900 dbus-run-session gnome-shell --devkit --wayland

logs:
	journalctl --user -f -o cat /usr/bin/gnome-shell | grep -i --line-buffered keel
