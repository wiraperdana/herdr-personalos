# herdr-personalos

A [Herdr](https://herdr.dev) layout: the Files panel on the left, and drag a file or folder from Files into a terminal to type its path. Click a file to open it in its own tab.

## Install

Copy the files into your Herdr home, then switch to the layout:

```sh
cp layouts/PersonalOS.json ~/.config/herdr-app/layouts/
cp -R mods/personalos-files mods/personalos-viewer ~/.config/herdr-app/mods/
herdr-app check ~/.config/herdr-app/mods/personalos-files
herdr-app do layout.switch '{"name":"PersonalOS"}'
```

Or ask the agent inside Herdr to add `herdr.dev/layouts/wiraperdana/herdr-personalos`. `ctrl-shift-l` switches back to your previous layout.

See [RECIPE.md](RECIPE.md) for how it is built.

## License

Apache-2.0. The `personalos-files` mod is derived from Herdr's `files` mod. See [NOTICE](NOTICE).
