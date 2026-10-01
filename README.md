# Find My Mouse

Press a hotkey. The screens go dim. A clear circle shows the cursor.
The ring shrinks onto the cursor. The overlay closes after 1.5 seconds.

![Find My Mouse running in Omarchy: the screen dims and a clear circle shrinks onto the cursor](demo.gif)

## Requirements

- Omarchy Quattro (the Quickshell-based shell) on Hyprland.
- `hyprctl`, which ships with Hyprland. The plugin uses it to read the cursor position and to add its layer rule.
- `gsettings` is optional. If it is missing, the plugin ignores the reduce-motion setting.
- No `sudo`, no network access, no extra packages, and no build step.

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
- Reduce motion: when `org.gnome.desktop.interface enable-animations` is `false`, the ring and the fade do not animate.
- On a light theme, the dim uses the dark foreground color, so it shows on white.

## What it touches

- It writes no files and does not edit your Hyprland config. You add the hotkey line yourself.
- When the plugin loads, it runs `hyprctl eval` once to add an in-memory layer rule for its own layer (`basantpandey-find-my-mouse`) that turns off the slide animation. A Hyprland config reload drops the rule.
- While the plugin is loaded, `gsettings monitor` watches the reduce-motion setting.
- While the overlay is open, `hyprctl -j cursorpos` reads the cursor at 30 Hz.

## License

MIT. See `LICENSE`.
