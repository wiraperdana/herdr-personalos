# herdr-personalos

A [Herdr](https://herdr.dev) layout: the Files panel on the left, and drag a file or folder from Files into a terminal to type its path. Click a file to open it in its own tab: raw, rendered (Markdown, HTML, images), editable with safe saves (also on remote machines), or in the macOS default app. Right-click a file or folder for a VS Code style menu: new file and folder, cut, copy, paste, duplicate, copy path, rename, and delete to the Trash. Drag rows onto a folder to move them, or drop files from Finder to copy them in.

## Install

Copy the files into your Herdr home, then switch to the layout:

```sh
cp layouts/PersonalOS.json ~/.config/herdr-app/layouts/
cp -R mods/personalos-files mods/personalos-viewer ~/.config/herdr-app/mods/
herdr-app check ~/.config/herdr-app/mods/personalos-files
herdr-app check ~/.config/herdr-app/mods/personalos-viewer
herdr-app do layout.switch '{"name":"PersonalOS"}'
```

Then merge the viewer's shortcuts (⌘E, ⌘R, ⌘S, ⌘O while a viewer has focus) from `mods/personalos-viewer/keys.json` into `~/.config/herdr-app/keys.json`. Add the `mod:personalos-viewer` section; don't replace your other keys. Editing `keys.json` makes it yours, so Herdr stops adding new default shortcuts to it on upgrade.

Tests for the pure logic: `node --test tests/lib.test.mjs tests/ops.test.mjs` (Node 18 or newer).

Or ask the agent inside Herdr to add `herdr.dev/layouts/wiraperdana/herdr-personalos`. `ctrl-shift-l` switches back to your previous layout.

See [RECIPE.md](RECIPE.md) for how it is built.

## License

Apache-2.0. The `personalos-files` mod and parts of `personalos-viewer` are derived from Herdr's `files` mod. See [NOTICE](NOTICE).
