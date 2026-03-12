const PDFJS_VERSION = "4.10.38";
const PDFJS_CDN_BASE = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}`;
const PDFJS_CDN_MODULE_URL = `${PDFJS_CDN_BASE}/pdf.min.mjs`;
const PDFJS_CDN_WORKER_URL = `${PDFJS_CDN_BASE}/pdf.worker.min.mjs`;
// Optional local pdf.js (recommended for reliability on restricted networks):
// Put files here if you want to avoid CDN:
// `vendor/pdfjs/pdf.min.mjs` and `vendor/pdfjs/pdf.worker.min.mjs`
const PDFJS_LOCAL_MODULE_URL = "./vendor/pdfjs/pdf.min.mjs";
const PDFJS_LOCAL_WORKER_URL = "./vendor/pdfjs/pdf.worker.min.mjs";

const $ = (sel) => document.querySelector(sel);
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));

const DEFAULT_PDF_URL = "./หนังสือรุ่น.pdf";

const ui = {
  fileLabel: $("#fileLabel"),
  viewer: $("#viewer"),
  page3d: $("#page3d"),
  canvasA: $("#canvasA"),
  canvasB: $("#canvasB"),
  statusPill: $("#statusPill"),

  prevBtn: $("#prevBtn"),
  nextBtn: $("#nextBtn"),
  pageInput: $("#pageInput"),
  pageTotal: $("#pageTotal"),

  zoomOutBtn: $("#zoomOutBtn"),
  zoomInBtn: $("#zoomInBtn"),
  zoomRange: $("#zoomRange"),
  fullscreenBtn: $("#fullscreenBtn"),
  themeBtn: $("#themeBtn"),

  progressBar: $("#progressBar"),
  progressText: $("#progressText"),
};

const state = {
  pdfjs: null,
  pdf: null,
  numPages: 0,
  currentPage: 1,
  zoomPct: 100,
  baseFitScale: 1,
  rendering: false,
  renderNonce: 0,
  reducedMotion: window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false,
  pdfJsWorkerUrl: null,
  pdfJsMode: null, // "module" | "global"
  pendingNav: null,
};

function setStatus(msg) {
  ui.statusPill.textContent = msg;
}

function setTheme(theme) {
  document.body.dataset.theme = theme;
  localStorage.setItem("ebook_theme", theme);
  ui.themeBtn.textContent = theme === "light" ? "Dark" : "Light";
}

function initTheme() {
  const saved = localStorage.getItem("ebook_theme");
  if (saved === "light" || saved === "dark") return setTheme(saved);
  const prefersDark = window.matchMedia?.("(prefers-color-scheme: dark)")?.matches ?? true;
  setTheme(prefersDark ? "dark" : "light");
}

function parseUrlParams() {
  const p = new URLSearchParams(location.search);
  const page = parseInt(p.get("page") || "1", 10);
  return { page: Number.isFinite(page) ? page : 1 };
}

function updateUrl(page) {
  const p = new URLSearchParams(location.search);
  p.set("page", String(page));
  const next = `${location.pathname}?${p.toString()}`;
  history.replaceState({}, "", next);
}

function makeFlipSound() {
  // Short page-flip noise without shipping any audio file.
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    return () => {
      const dur = 0.085;
      const sr = ctx.sampleRate;
      const frames = Math.floor(dur * sr);
      const buffer = ctx.createBuffer(1, frames, sr);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < frames; i++) {
        const t = i / frames;
        const env = Math.pow(1 - t, 2.6);
        const noise = (Math.random() * 2 - 1) * 0.45;
        const hiss = (Math.random() * 2 - 1) * 0.12;
        data[i] = (noise + hiss) * env;
      }
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      const gain = ctx.createGain();
      gain.gain.value = 0.45;
      src.connect(gain).connect(ctx.destination);
      src.start();
    };
  } catch {
    return () => {};
  }
}

const playFlip = makeFlipSound();

class EbookError extends Error {
  constructor(code, message, cause) {
    super(message);
    this.name = "EbookError";
    this.code = code;
    this.cause = cause;
  }
}

function setButtonsEnabled() {
  ui.prevBtn.disabled = !state.pdf || state.currentPage <= 1 || state.rendering;
  ui.nextBtn.disabled = !state.pdf || state.currentPage >= state.numPages || state.rendering;
  ui.pageInput.disabled = !state.pdf || state.rendering;
}

function setProgress() {
  const pct = state.numPages ? (state.currentPage / state.numPages) * 100 : 0;
  ui.progressBar.style.width = `${pct}%`;
  ui.progressText.textContent = state.numPages
    ? `${state.currentPage.toLocaleString()} / ${state.numPages.toLocaleString()}`
    : "–";
}

function setPageInput() {
  ui.pageInput.value = String(state.currentPage);
  ui.pageTotal.textContent = state.numPages ? String(state.numPages) : "–";
}

async function loadPdfJs() {
  setStatus("กำลังโหลดตัวเรนเดอร์ PDF…");
  if (window.pdfjsLib) {
    state.pdfJsMode = "global";
    return window.pdfjsLib;
  }

  const moduleAttempts = [
    { moduleUrl: PDFJS_LOCAL_MODULE_URL, workerUrl: PDFJS_LOCAL_WORKER_URL, label: "local-mjs" },
    { moduleUrl: PDFJS_CDN_MODULE_URL, workerUrl: PDFJS_CDN_WORKER_URL, label: "cdn-mjs" },
  ];

  let lastErr = null;
  for (const a of moduleAttempts) {
    try {
      const mod = await import(a.moduleUrl);
      state.pdfJsWorkerUrl = a.workerUrl;
      state.pdfJsMode = "module";
      return mod;
    } catch (e) {
      lastErr = e;
      console.warn(`pdf.js import failed (${a.label})`, e);
    }
  }

  // Fallback to classic script build if present (better chance to work on `file://`).
  try {
    const ok = await loadPdfJsClassic();
    if (ok && window.pdfjsLib) {
      state.pdfJsMode = "global";
      return window.pdfjsLib;
    }
  } catch (e) {
    lastErr = e;
  }

  const msg =
    "โหลด pdf.js ไม่ได้: เครือข่ายอาจบล็อก CDN หรือยังไม่มีไฟล์ local ที่ vendor/pdfjs/ (เปิด Console จะเห็น error)";
  setStatus(msg);
  throw new EbookError("PDFJS_LOAD_FAILED", msg, lastErr);
}

async function loadPdfJsClassic() {
  // Requires `vendor/pdfjs/pdf.min.js` (classic build) to exist, or CDN classic build.
  const localClassic = "./vendor/pdfjs/pdf.min.js";
  const cdnClassic = `${PDFJS_CDN_BASE}/pdf.min.js`;

  const tryLoad = async (src) => {
    await new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src;
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error(`script load failed: ${src}`));
      document.head.appendChild(s);
    });
  };

  try {
    await tryLoad(localClassic);
    state.pdfJsWorkerUrl = "./vendor/pdfjs/pdf.worker.min.js";
    return true;
  } catch (e) {
    console.warn("pdf.js classic local failed", e);
  }

  await tryLoad(cdnClassic);
  state.pdfJsWorkerUrl = `${PDFJS_CDN_BASE}/pdf.worker.min.js`;
  return true;
}

async function openPdfSource(source, initialPage) {
  state.pdfjs = await loadPdfJs();
  const workerUrl = state.pdfJsWorkerUrl || PDFJS_CDN_WORKER_URL;
  if (state.pdfjs?.GlobalWorkerOptions) state.pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

  setStatus("กำลังเปิดไฟล์ PDF…");
  ui.fileLabel.textContent = source.label || "PDF";

  const isFile = location.protocol === "file:";
  let task;
  try {
    task = state.pdfjs.getDocument({
      ...(source.data ? { data: source.data } : { url: source.url }),
      enableXfa: false,
      // Workers often fail on `file://` due to security restrictions.
      ...(isFile ? { disableWorker: true } : {}),
    });
    state.pdf = await task.promise;
  } catch (e) {
    const msg = source.url
      ? `เปิด PDF ไม่ได้: ${source.url} (อาจ 404/บล็อก/ไฟล์ใหญ่เกิน หรือ CORS)`
      : "เปิด PDF ไม่ได้: ไฟล์จากเครื่องอาจเสียหรือไม่ใช่ PDF";
    setStatus(msg);
    throw new EbookError("PDF_LOAD_FAILED", msg, e);
  }
  state.numPages = state.pdf.numPages || 0;
  try {
    const p1 = await state.pdf.getPage(1);
    state._fitRefViewport = p1.getViewport({ scale: 1 });
  } catch {}

  state.currentPage = clamp(initialPage, 1, state.numPages || 1);
  updateUrl(state.currentPage);
  setPageInput();
  setProgress();
  setButtonsEnabled();
  setStatus("พร้อมใช้งาน");
  await computeFitScale();
  await renderCurrentFull();
}

function ensureCanvasSize(canvas, w, h) {
  // Only resize when needed to avoid clearing/flash.
  if (canvas.width === w && canvas.height === h) return;
  canvas.width = w;
  canvas.height = h;
}

async function computeFitScale() {
  if (!state.pdf) return;
  const rect = ui.page3d.getBoundingClientRect();
  const w = Math.max(10, rect.width);
  const h = Math.max(10, rect.height);

  // Use page 1 as reference size for fit scale; most PDFs are consistent.
  const v1 = state._fitRefViewport;
  if (!v1) return;
  const fit = Math.min(w / v1.width, h / v1.height);
  state.baseFitScale = Number.isFinite(fit) && fit > 0 ? fit : 1;
}

function desiredScale({ quality }) {
  const zoom = clamp(state.zoomPct, 50, 200) / 100;
  const dpr = Math.max(1, Math.min(2.25, window.devicePixelRatio || 1));
  const qualityFactor = quality === "fast" ? 0.55 : 1;
  let scale = state.baseFitScale * zoom * dpr * qualityFactor;

  // Cap render size to reduce lag on big pages.
  const maxDim = 2400;
  if (state._lastPageUnitViewport) {
    const vw = state._lastPageUnitViewport.width * scale;
    const vh = state._lastPageUnitViewport.height * scale;
    const worst = Math.max(vw, vh);
    if (worst > maxDim) scale *= maxDim / worst;
  }
  return scale;
}

function drawPlaceholder(canvas, label) {
  const rect = ui.page3d.getBoundingClientRect();
  const dpr = Math.max(1, Math.min(2.25, window.devicePixelRatio || 1));
  const w = Math.max(320, Math.floor(rect.width * dpr));
  const h = Math.max(320, Math.floor(rect.height * dpr));
  ensureCanvasSize(canvas, w, h);
  const ctx = canvas.getContext("2d", { alpha: false });
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--pageBg") || "#fff";
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "rgba(0,0,0,0.65)";
  ctx.font = `${Math.max(14, Math.floor(18 * dpr))}px ui-sans-serif, system-ui, -apple-system, Segoe UI, Arial, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(`Loading ${label}…`, Math.floor(w / 2), Math.floor(h / 2));
}

async function renderPage(pageNumber, canvas, { quality, background = false }) {
  if (!state.pdf) return;
  const nonce = ++state.renderNonce;
  if (!background) {
    state.rendering = true;
    setButtonsEnabled();
  }

  try {
    const page = await state.pdf.getPage(pageNumber);
    if (nonce !== state.renderNonce) return;

    const unit = page.getViewport({ scale: 1 });
    state._lastPageUnitViewport = unit;
    const viewport = page.getViewport({ scale: desiredScale({ quality }) });
    const ctx = canvas.getContext("2d", { alpha: false });
    ensureCanvasSize(canvas, Math.floor(viewport.width), Math.floor(viewport.height));

    const renderTask = page.render({
      canvasContext: ctx,
      viewport,
      renderInteractiveForms: false,
    });
    await renderTask.promise;
  } finally {
    if (!background && nonce === state.renderNonce) {
      state.rendering = false;
      setButtonsEnabled();
      setPageInput();
      setProgress();
    }
  }
}

async function renderCurrentFull() {
  setStatus("Rendering…");
  await renderPage(state.currentPage, ui.canvasA, { quality: "full" });
  setStatus("Ready");
  // Opportunistic pre-render for smoother Next.
  const next = state.currentPage + 1;
  if (state.pdf && next <= state.numPages) {
    setTimeout(() => {
      if (state.currentPage + 1 !== next) return;
      void renderPage(next, ui.canvasB, { quality: "fast", background: true });
    }, 120);
  }
}

async function flipTo(nextPage) {
  if (!state.pdf) return;
  if (nextPage === state.currentPage) return;
  nextPage = clamp(nextPage, 1, state.numPages);
  if (state.rendering) return;

  const forward = nextPage > state.currentPage;
  setStatus(`Loading page ${nextPage}…`);

  state.rendering = true;
  setButtonsEnabled();

  // Start flip animation immediately (don't block on render).
  if (!state.reducedMotion) {
    playFlip();
    ui.page3d.classList.remove("flipAnim", "back");
    void ui.page3d.offsetWidth;
    ui.page3d.classList.add("flipAnim");
    if (!forward) ui.page3d.classList.add("back");
  }

  // Fast render for the flip.
  drawPlaceholder(ui.canvasB, `${nextPage}`);
  const fastRender = renderPage(nextPage, ui.canvasB, { quality: "fast", background: true }).catch(() => {});

  const animDone = () =>
    new Promise((resolve) => {
      if (state.reducedMotion) return resolve();
      const onEnd = () => {
        ui.page3d.removeEventListener("animationend", onEnd);
        resolve();
      };
      ui.page3d.addEventListener("animationend", onEnd, { once: true });
    });

  await animDone();

  // Commit next page as current (keep DOM stable, avoid 3D state glitches).
  copyCanvas(ui.canvasB, ui.canvasA);
  state.currentPage = nextPage;
  updateUrl(state.currentPage);
  setStatus("Refining…");
  setPageInput();
  setProgress();

  // Then refine with full render on the current face.
  await fastRender;
  await renderCurrentFull();
}

function copyCanvas(src, dst) {
  ensureCanvasSize(dst, src.width, src.height);
  const ctx = dst.getContext("2d", { alpha: false });
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(src, 0, 0);
}

async function goToPage(page) {
  page = clamp(page, 1, state.numPages || 1);
  // Coalesce rapid nav requests.
  if (state.pendingNav) state.pendingNav = page;
  else state.pendingNav = page;
  if (state._navLoopRunning) return;
  state._navLoopRunning = true;
  try {
    while (state.pendingNav != null) {
      const target = state.pendingNav;
      state.pendingNav = null;
      await flipTo(target);
    }
  } finally {
    state._navLoopRunning = false;
  }
}

async function toggleFullscreen() {
  const el = ui.viewer;
  if (!document.fullscreenElement) {
    try {
      await el.requestFullscreen();
    } catch {}
  } else {
    try {
      await document.exitFullscreen();
    } catch {}
  }
}

function adjustZoom(deltaPct) {
  const pct = clamp(parseInt(ui.zoomRange.value, 10) + deltaPct, 50, 200);
  ui.zoomRange.value = String(pct);
  void applyZoomFromRange();
}

async function applyZoomFromRange() {
  const pct = clamp(parseInt(ui.zoomRange.value, 10) || 100, 50, 200);
  state.zoomPct = pct;
  setStatus(`Zoom ${pct}%…`);
  await renderCurrentFull();
}

function wireUi() {
  ui.prevBtn.addEventListener("click", () => void goToPage(state.currentPage - 1));
  ui.nextBtn.addEventListener("click", () => void goToPage(state.currentPage + 1));

  ui.pageInput.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    const n = parseInt(ui.pageInput.value, 10);
    if (!Number.isFinite(n)) return;
    void goToPage(n);
  });

  ui.zoomOutBtn.addEventListener("click", () => adjustZoom(-10));
  ui.zoomInBtn.addEventListener("click", () => adjustZoom(10));
  ui.zoomRange.addEventListener("input", () => {
    // Debounced-ish: schedule microtask to avoid re-render per pixel.
    clearTimeout(wireUi._zoomT);
    wireUi._zoomT = setTimeout(() => void applyZoomFromRange(), 120);
  });

  ui.fullscreenBtn.addEventListener("click", () => void toggleFullscreen());
  ui.themeBtn.addEventListener("click", () => {
    const t = document.body.dataset.theme === "light" ? "dark" : "light";
    setTheme(t);
  });

  window.addEventListener("keydown", (e) => {
    if (e.key === "ArrowLeft") return void goToPage(state.currentPage - 1);
    if (e.key === "ArrowRight") return void goToPage(state.currentPage + 1);
  });
}

function wireResize() {
  let t = null;
  const onChange = () => {
    clearTimeout(t);
    t = setTimeout(async () => {
      if (!state.pdf) return;
      const prevFit = state.baseFitScale;
      await computeFitScale();
      if (Math.abs(state.baseFitScale - prevFit) < 0.001) return;
      void renderCurrentFull();
    }, 120);
  };

  if ("ResizeObserver" in window) {
    const ro = new ResizeObserver(onChange);
    ro.observe(ui.page3d);
  } else {
    window.addEventListener("resize", onChange);
  }
}

async function main() {
  window.__ebook_booted = true;
  initTheme();
  wireUi();
  wireResize();

  const { page } = parseUrlParams();
  const fileUrl = DEFAULT_PDF_URL;

  try {
    await openPdfSource({ url: fileUrl, label: "Book.pdf" }, page);
  } catch (e) {
    console.warn(e);
    const code = e && typeof e === "object" && "code" in e ? e.code : null;
    if (code === "PDFJS_LOAD_FAILED") {
      setStatus("เริ่มระบบไม่สำเร็จ: โหลดตัวเรนเดอร์ PDF (pdf.js) ไม่ได้ (ดู Console / หรือใส่ไฟล์ไว้ที่ vendor/pdfjs)");
    } else if (code === "PDF_LOAD_FAILED") {
      setStatus("เริ่มระบบไม่สำเร็จ: โหลดไฟล์ PDF ไม่ได้ (เช็คว่าไฟล์อยู่บน Pages จริงและเปิดได้)");
    } else {
      setStatus("เริ่มระบบไม่สำเร็จ: มีข้อผิดพลาดระหว่างโหลด (เปิด Console เพื่อดูรายละเอียด)");
    }
    setButtonsEnabled();
    ui.pageTotal.textContent = "–";
    ui.progressText.textContent = "—";
    ui.fileLabel.textContent = fileUrl;
  }
}

main();
