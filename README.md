# Battle Report Editor

> **Beware:** This is totally just vibe coded. I don't think it's easy to maintain this code manually.

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
| `js/drawing.js` | Shapes shared by model drawings and drawn buildings |
| `js/unit-art.js` | Model drawings for units |
| `js/drawing-editor.js` | The drawing editor (models and buildings) |
| `icons/` | Toolbar and logo icons |
| `symbols/*.svg` | Unit symbols, one file each |
| `symbols/symbols.json` | Picker groups and order |
| `terrain/buildings/*.svg` | Energy generator, landing platform, cathedral ruin |
| `terrain/sprites/*.svg` | Pieces scattered in woods, rock fields, cacti and crystal fields |
| `terrain/terrain.json` | Which building and sprite files are used |

Hills, lakes, marshes, craters, the buildings with adjustable wall thickness, rivers, roads and walls are still generated in `js/editor.js`.

## Terrain tips

- The Terrain tool stays on after you place something, so you can place many pieces in a row.
- Drag on the map to draw terrain. A single click places a default-size piece.
  - Woods, rocks, cacti, crystals and marshes: drag around an area and it fills.
  - Hills, lakes and craters: drag around an area and they take its shape.
  - Buildings and other fixed pieces: drag a box and they fill it. Hold Shift to keep their proportions.
  - Rivers, roads and walls: drag along the route.
- **Trace building** works like tracing a model: click the outline on the map, then add details in the drawing editor. **Draw building…** starts from a blank canvas. In the editor, building shapes have their own colours and edge styles (solid, ruined walls, hazard stripes).

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

## Model drawings

In the unit panel, set **Look** to **Model drawing** to show a unit as a drawing (for example a top-down tank) instead of a counter. There are three ways to get one:

- **Draw new…** opens the drawing editor. It has rectangle, ellipse, polygon and line tools. You can rotate shapes (orange handle, or the ↺/↻ buttons), make mirrored copies, and load a photo to trace over. **Download SVG** saves the drawing.
- **Trace on map** lets you click the model's outline on the map or reference photo. The drawing editor then opens with the photo behind it.
- **Upload SVG…** uses an SVG file. Single-colour SVGs are recoloured with the faction colour.

To save a placed unit as an SVG file, select it and click **Download SVG**.

Drawn models use relative colours (faction colour, darker, lighter), so one drawing works for every army. Models face right.

## Library

Buildings you trace, model drawings you draw or trace, and anything you choose "Save to library" for are kept in your browser and offered in every battle. Browsers store this per address: `http://localhost:8000` and `http://localhost:8001` have separate libraries. To back up the library or move it to another browser or computer, use **Export library…** and **Import library…** in the Terrain tool.
