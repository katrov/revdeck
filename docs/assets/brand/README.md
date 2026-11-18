# revdeck brand assets

Logo and icon files used by the README, documentation and the web UI.

## Logo (wordmark)

| File | Use |
|---|---|
| `logo.svg` | light backgrounds, README/docs |
| `logo-dark.svg` | dark backgrounds (`prefers-color-scheme: dark`) |
| `logo.png` | 1819×512 raster fallback, light backgrounds |
| `logo-dark.png` | 1819×512 raster fallback, dark backgrounds |

The SVG wordmark uses outlined Inter glyphs (SIL Open Font License 1.1). Keep the icon and the
wordmark together; do not stretch, recolor or add effects.

## Icon

| File | Use |
|---|---|
| `icon.svg` | favicon and scalable UI icon (64×64 viewBox) |
| `icon-32.png` | 32×32 favicon fallback |
| `icon-64.png` | 64×64 UI |
| `icon-128.png` | 128×128 UI / Apple touch icon |
| `icon-256.png` | 256×256 |
| `icon-512.png` | 512×512 |
| `icon-1024.png` | 1024×1024 source asset |

## Palette

| Token | Value |
|---|---|
| blue | `#3B6EF5` |
| violet | `#7C5CFF` |
| pale blue | `#D7E3FF` |
| light text | `#16191D` |
| dark text | `#E6E9EE` |

Clear space around the mark: at least half the icon's corner radius. Minimum icon size: 24 px.

## Where it is used

- `README.md` / `README.ru.md` — centered logo with a dark-mode variant;
- `docs/README.md` / `docs/ru/README.md` — icon in the documentation index;
- `ui/public/favicon.svg`, `ui/public/icon-32.png`, `ui/public/icon-128.png` — browser tab,
  bookmarks and Apple touch icon;
- `ui/src/App.svelte` — sidebar brand icon.

The assets are part of the package through the `docs` and `dist/ui` entries in `package.json`.
