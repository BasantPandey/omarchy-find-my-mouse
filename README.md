# Find My Mouse

Press a hotkey. The screens go dim. A clear circle shows the cursor.
The ring shrinks onto the cursor. The overlay closes after 1.5 seconds.

## Install

```bash
omarchy plugin add https://github.com/BasantPandey/omarchy-find-my-mouse.git --enable
```

## Hotkey

Add this line to `~/.config/hypr/bindings.lua`:

```lua
o.bind("SUPER + CTRL + M", "Find my mouse", "omarchy-shell shell toggle io.github.basantpandey.find-my-mouse")
```

Some Omarchy builds reject `{ panel = id }` in `o.bind`. Use the plain command above.

## Test without a hotkey

```bash
omarchy-shell shell toggle io.github.basantpandey.find-my-mouse '{}'
```

## Remove

```bash
omarchy plugin remove io.github.basantpandey.find-my-mouse
```

Then delete the hotkey line.

## Known limits

- A Hyprland config reload can bring back the layer slide animation until the next shell restart.
- The plugin reads the cursor with `hyprctl`, at 30 Hz, only while it shows.
