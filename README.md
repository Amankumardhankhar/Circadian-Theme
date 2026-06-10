# Circadian Theme

A color theme engine that moves with the sun. Crisp and clear when you're focused during the day, warm and soft after sunset — so your eyes stay comfortable from morning to midnight.

The palette is computed from the sun's real position (sunrise, solar noon, golden hour, sunset, dusk, midnight) and applied to a small set of CSS custom properties. Any site that consumes those tokens gets a coherent, time-aware look without manually swapping themes.

## Demo

The `demo/` folder is a standalone page that shows the palette in motion: a 24-hour dial you can scrub, a live token readout, and a "Use my location" button that swaps the IST default for your real sunrise/sunset.

Live demo: deployed on Vercel.

## Project layout

```
src/          color math, solar anchors, token engine, CSS writer
demo/         standalone interactive demo (built to dist/ for prod)
test/         test suites + scenario validator
ARCHITECTURE.md   how the engine is wired
INTEGRATION.md    how to drop the tokens into another site
CHANGELOG.md      release notes
```

## Running locally

Install:

```bash
npm install
```

Run the tests:

```bash
npm test          # full suite
npm run validate  # end-to-end scenarios A–G
```

Run the demo with hot rebuilds:

```bash
npm run demo:watch    # rebuilds demo/demo.js on file change
npm run demo:serve    # serves demo/ on http://localhost:5173
```

Build the production demo (minified, no sourcemap, self-contained in `dist/`):

```bash
npm run demo:build:prod
```

## Deployment

The repo includes a `vercel.json` that points Vercel at `demo:build:prod` and the `dist/` output. Import the repo into Vercel and it deploys with no extra configuration.

## License

ISC
