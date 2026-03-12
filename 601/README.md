# PDF Viewer (Single PDF)

This is a lightweight PDF viewer designed for GitHub Pages. It auto-opens a single PDF file: `หนังสือรุ่น.pdf`.

## Deploy to GitHub Pages

1. Create a repo and upload all files in this folder (including `หนังสือรุ่น.pdf`).
2. Go to `Settings` -> `Pages`.
3. Set `Source` to deploy from a branch, choose `main` and `/(root)`.
4. Open the Pages URL.

## Usage

- Next/Prev: buttons or keyboard arrows.
- Go to page: type a number and press Enter.
- Zoom: slider or +/-.
- Fullscreen: button.
- Theme: Dark/Light toggle.

## Notes

- The UI keeps the PDF aspect ratio (no stretching). It fits-to-screen and reflows on resize/orientation changes.
- Page turns render a fast preview first, then refine for sharpness to reduce "stuck" feeling on large PDFs.
- Service Worker/PWA caching is disabled by default to avoid stale-cache issues on GitHub Pages. If you previously had an SW, the current `sw.js` will auto-unregister and clear caches when it activates.

