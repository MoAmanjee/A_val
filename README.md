# Ahmed Rides

A small single-page website for Ahmed — dad, cyclist, hill climber.

## What's in it

- An animated hero with a rolling-wheel illustration drawn in SVG
- Ride stats that count up as they scroll into view
- Four favourite routes with elevation profiles and a difficulty meter
- A working ride calculator (average speed, pace, estimated calories, cake slices) with metric/imperial switching
- Light and dark themes, remembered between visits and defaulting to the system setting
- Responsive down to phone widths, keyboard accessible, and quiet when `prefers-reduced-motion` is set

Everything is drawn with CSS and inline SVG, so there are no image files to host or break.

## Running it

It's a static site with no build step. Open `index.html` directly, or serve the folder:

```bash
python3 -m http.server 8000
```

Then visit <http://localhost:8000>.

## Publishing

Push to GitHub and enable GitHub Pages on the repository (Settings → Pages → deploy from branch, root folder). The site is served from `index.html`.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Page content and SVG artwork |
| `assets/styles.css` | Theme tokens, layout, animations |
| `assets/main.js` | Theme toggle, scroll reveals, counters, ride calculator |
