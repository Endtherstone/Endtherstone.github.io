# PDF Viewer

Lightweight PDF viewer for GitHub Pages. By default it auto-opens `หนังสือรุ่น.pdf`.

## Deploy to GitHub Pages

1. Create a GitHub repo.
2. Upload all files in this folder (including `หนังสือรุ่น.pdf`) using Git (recommended) or GitHub Desktop.
3. Go to `Settings` -> `Pages`.
4. Deploy from branch `main`, folder `/(root)`.

## Split PDF (Virtual Merge)

If the PDF is too large to upload via the GitHub web UI, split it into multiple smaller PDFs (for example `part1.pdf`, `part2.pdf`) and the viewer will treat them as one book.

- Open with: `?parts=part1.pdf,part2.pdf`
- Example: `https://<user>.github.io/<repo>/?parts=part1.pdf,part2.pdf`

If you split into Thai names `ส่วน1.pdf`, `ส่วน2.pdf`, `ส่วน3.pdf`, `ส่วน4.pdf`, the viewer will auto-load them in order by default (no URL params needed).

## Usage

- Next/Prev: buttons or keyboard arrows.
- Go to page: type a number and press Enter.
- Zoom: slider or +/-.
- Fullscreen: button.
- Theme: Dark/Light toggle.

## Notes

- Keeps PDF aspect ratio (no stretching), and re-fits on resize/orientation change.
- Page turns render a fast preview first, then refine for sharpness to reduce perceived lag.
- Service Worker/PWA caching is disabled by default to avoid stale-cache issues on GitHub Pages. If you previously had an SW, `sw.js` will try to unregister and clear caches when it activates.
