# Battle Report Editor

Beware: This is totally just vibe coded. I don't think it's easy to maintain this code manually. 

## Start it

The editor reads its unit symbols and terrain from SVG files, so it has to be opened through a local web server. Double-clicking `index.html` won't work.

```bash
cd battle-report-editor
python3 -m http.server 8000
```

Then open http://localhost:8000/ in your browser. Stop the server with Ctrl+C.

## Folders

| Path | What it is |
|---|---|
| `index.html` | Page layout |
| `css/editor.css` | Styles |
| `js/editor.js` | Editor code |
| `icons/` | Toolbar and logo icons |
| `symbols/*.svg` | Unit symbols, one file each |
| `symbols/symbols.json` | Picker groups and order |
| `terrain/buildings/*.svg` | Energy generator, landing platform, cathedral ruin |
| `terrain/sprites/*.svg` | Pieces scattered in woods, rock fields, cacti and crystal fields |
| `terrain/terrain.json` | Which building and sprite files are used |

Hills, lakes, marshes, craters, the buildings with adjustable wall thickness, rivers, roads and walls are still generated in `js/editor.js`.

## Editing the SVGs

Reload the page after saving a file.

**Unit symbols**
- They are drawn on a 24×24 canvas.
- Every colour is replaced by the faction's symbol colour.
- Anything in a group or Inkscape layer named `cut` (`data-layer="cut"`) gets the counter colour instead.
- To add a symbol, put the file in `symbols/` and add its name to `symbols/symbols.json`.

**Buildings** are stretched to the size you place them at.

**Sprites**
- Each file is centred on its viewBox, and the editor scales and rotates it.
- Listing several files for one sprite in `terrain.json` gives random variety.
- Groups or layers named with `data-layer` are drawn layer by layer across all pieces. This is how tree canopies merge.

Projects you save (`.battle.json`) store symbol names only. If you change a symbol file, every project that uses it picks up the change.
