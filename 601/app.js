import { BOOK } from "./book.config.js";

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

const ui = {
  bookTitle: $("#bookTitle"),
  fileLabel: $("#fileLabel"),
  wherePill: $("#wherePill"),
  viewer: $("#viewer"),
  page3d: $("#page3d"),
  canvasA: $("#canvasA"),
  canvasB: $("#canvasB"),
  statusPill: $("#statusPill"),

  tocBtn: $("#tocBtn"),
  thumbBtn: $("#thumbBtn"),

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

  drawer: $("#drawer"),
  scrim: $("#scrim"),
  drawerCloseBtn: $("#drawerCloseBtn"),
  tabToc: $("#tabToc"),
  tabThumb: $("#tabThumb"),
  tabAbout: $("#tabAbout"),
  paneToc: $("#paneToc"),
  paneThumb: $("#paneThumb"),
  paneAbout: $("#paneAbout"),
  tocList: $("#tocList"),
  thumbGrid: $("#thumbGrid"),

  aboutTitle: $("#aboutTitle"),
  aboutSubtitle: $("#aboutSubtitle"),
  aboutFiles: $("#aboutFiles"),
  aboutPages: $("#aboutPages"),
};

const state = {
  pdfjs: null,
  pdfs: [], // [{ pdf, label, numPages, startPage }]
  totalPages: 0,
  currentPage: 1,
  zoomPct: 100,
  baseFitScale: 1,
  rendering: false,
  renderNonce: 0,
  reducedMotion: window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false,
  pdfJsWorkerUrl: null,
  pendingNav: null,
  navLoopRunning: false,

  drawerOpen: false,
  thumbObserver: null,
  thumbRendered: new Set(), // global page numbers
  unitViewport: null, // for render caps
  fitRefViewport: null,
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

function resolvePdfSources() {
  // Override order/filenames via:
  // `?parts=a.pdf,b.pdf,c.pdf,d.pdf`
  const p = new URLSearchParams(location.search);
  const parts = p.get("parts");
  if (parts) {
    const items = parts
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (items.length) return items.map((url, i) => ({ url, label: `ส่วน${i + 1}` }));
  }

  return (BOOK?.parts?.length ? BOOK.parts : []).map((x) => ({ url: x.url, label: x.label })) || [];
}

function normalizeUrl(url) {
  if (!url) return url;
  if (url.startsWith("./")) return encodeURI(url);
  return url;
}

function setButtonsEnabled() {
  const ready = state.pdfs.length > 0 && state.totalPages > 0;
  ui.prevBtn.disabled = !ready || state.currentPage <= 1 || state.rendering;
  ui.nextBtn.disabled = !ready || state.currentPage >= state.totalPages || state.rendering;
  ui.pageInput.disabled = !ready || state.rendering;
  ui.zoomRange.disabled = !ready;
  ui.zoomInBtn.disabled = !ready;
  ui.zoomOutBtn.disabled = !ready;
}

function setProgress() {
  const pct = state.totalPages ? (state.currentPage / state.totalPages) * 100 : 0;
  ui.progressBar.style.width = `${pct}%`;
  ui.progressText.textContent = state.totalPages
    ? `${state.currentPage.toLocaleString()} / ${state.totalPages.toLocaleString()}`
    : "–";
  setWherePill();
  highlightActiveThumb();
}

function setPageInput() {
  ui.pageInput.value = String(state.currentPage);
  ui.pageTotal.textContent = state.totalPages ? String(state.totalPages) : "–";
}

function currentPartInfo() {
  let acc = 0;
  for (let i = 0; i < state.pdfs.length; i++) {
    const d = state.pdfs[i];
    const start = acc + 1;
    const end = acc + d.numPages;
    if (state.currentPage >= start && state.currentPage <= end) {
      return {
        partIndex: i,
        partLabel: d.label,
        pageInPart: state.currentPage - acc,
        partPages: d.numPages,
        startGlobal: start,
        endGlobal: end,
      };
    }
    acc += d.numPages;
  }
  return null;
}

function setWherePill() {
  const info = currentPartInfo();
  if (!info) {
    ui.wherePill.textContent = "–";
    return;
  }
  ui.wherePill.textContent = `${info.partLabel} · หน้า ${info.pageInPart}/${info.partPages}`;
}

function openDrawer(tabKey) {
  state.drawerOpen = true;
  ui.drawer.classList.add("open");
  ui.drawer.setAttribute("aria-hidden", "false");
  ui.scrim.classList.add("show");
  ui.scrim.setAttribute("aria-hidden", "false");
  selectTab(tabKey);
}

function closeDrawer() {
  state.drawerOpen = false;
  ui.drawer.classList.remove("open");
  ui.drawer.setAttribute("aria-hidden", "true");
  ui.scrim.classList.remove("show");
  ui.scrim.setAttribute("aria-hidden", "true");
}

function selectTab(key) {
  const all = [
    { tab: ui.tabToc, pane: ui.paneToc, key: "toc" },
    { tab: ui.tabThumb, pane: ui.paneThumb, key: "thumb" },
    { tab: ui.tabAbout, pane: ui.paneAbout, key: "about" },
  ];
  for (const t of all) {
    const active = t.key === key;
    t.tab.classList.toggle("active", active);
    t.tab.setAttribute("aria-selected", active ? "true" : "false");
    t.pane.classList.toggle("hidden", !active);
  }
  if (key === "thumb") ensureThumbsBuilt();
}

function makeItem(title, meta) {
  const div = document.createElement("div");
  div.className = "item";
  div.innerHTML = `
    <div class="itemTitle"></div>
    <div class="itemMeta"></div>
  `;
  div.querySelector(".itemTitle").textContent = title;
  div.querySelector(".itemMeta").textContent = meta || "";
  return div;
}

function buildToc() {
  ui.tocList.textContent = "";
  if (!state.pdfs.length) return;

  const frag = document.createDocumentFragment();
  let acc = 0;
  for (let i = 0; i < state.pdfs.length; i++) {
    const d = state.pdfs[i];
    const start = acc + 1;
    const end = acc + d.numPages;
    const item = makeItem(d.label, `หน้า ${start}–${end}`);
    item.addEventListener("click", () => {
      closeDrawer();
      void goToPage(start);
    });
    frag.appendChild(item);
    acc += d.numPages;
  }

  if (Array.isArray(BOOK?.bookmarks) && BOOK.bookmarks.length) {
    const sep = document.createElement("div");
    sep.className = "paneHint";
    sep.style.marginTop = "10px";
    sep.textContent = "บุ๊กมาร์ก";
    frag.appendChild(sep);
    for (const b of BOOK.bookmarks) {
      const page = clamp(parseInt(b.page, 10) || 1, 1, state.totalPages);
      const item = makeItem(b.title || "—", `หน้า ${page}`);
      item.addEventListener("click", () => {
        closeDrawer();
        void goToPage(page);
      });
      frag.appendChild(item);
    }
  }

  ui.tocList.appendChild(frag);
}

function buildAbout() {
  ui.aboutTitle.textContent = BOOK?.title || "หนังสือรุ่น";
  ui.aboutSubtitle.textContent = BOOK?.subtitle || "E-Book";
  ui.aboutFiles.textContent = state.pdfs.length ? state.pdfs.map((d) => d.label).join(", ") : "–";
  ui.aboutPages.textContent = state.totalPages ? `${state.totalPages.toLocaleString()} หน้า` : "–";
}

async function loadPdfJs() {
  setStatus("กำลังโหลดตัวเรนเดอร์ PDF…");
  const attempts = [
    { moduleUrl: PDFJS_LOCAL_MODULE_URL, workerUrl: PDFJS_LOCAL_WORKER_URL, label: "local" },
    { moduleUrl: PDFJS_CDN_MODULE_URL, workerUrl: PDFJS_CDN_WORKER_URL, label: "cdn" },
  ];

  let lastErr = null;
  for (const a of attempts) {
    try {
      const mod = await import(a.moduleUrl);
      state.pdfJsWorkerUrl = a.workerUrl;
      return mod;
    } catch (e) {
      lastErr = e;
      console.warn(`pdf.js import failed (${a.label})`, e);
    }
  }

  setStatus("โหลด pdf.js ไม่ได้ (เช็คเน็ต หรือวางไฟล์ไว้ที่ vendor/pdfjs)");
  throw lastErr || new Error("pdf.js import failed");
}

async function openPdfSources(sources, initialPage) {
  if (!sources.length) throw new Error("No PDF sources");
  state.pdfjs = await loadPdfJs();
  if (state.pdfjs?.GlobalWorkerOptions) state.pdfjs.GlobalWorkerOptions.workerSrc = state.pdfJsWorkerUrl || PDFJS_CDN_WORKER_URL;

  state.pdfs = [];
  state.totalPages = 0;
  state.fitRefViewport = null;
  state.unitViewport = null;
  state.thumbRendered.clear();

  setButtonsEnabled();
  setStatus("กำลังเปิดไฟล์…");

  const isFile = location.protocol === "file:";
  for (let i = 0; i < sources.length; i++) {
    const src = sources[i];
    const label = src.label || `ส่วน${i + 1}`;
    ui.fileLabel.textContent = `${label} (${i + 1}/${sources.length})`;

    const resolvedUrl = new URL(normalizeUrl(src.url), location.href).toString();
    const task = state.pdfjs.getDocument({
      url: resolvedUrl,
      enableXfa: false,
      ...(isFile ? { disableWorker: true } : {}),
      disableRange: false,
      disableStream: false,
      rangeChunkSize: 262144,
    });

    task.onProgress = (p) => {
      if (!p) return;
      const loaded = typeof p.loaded === "number" ? p.loaded : 0;
      const total = typeof p.total === "number" ? p.total : 0;
      if (total > 0) {
        const pct = Math.max(0, Math.min(100, Math.round((loaded / total) * 100)));
        setStatus(`กำลังดาวน์โหลด ${label}… ${pct}%`);
      } else if (loaded > 0) {
        const mb = Math.round((loaded / (1024 * 1024)) * 10) / 10;
        setStatus(`กำลังดาวน์โหลด ${label}… ${mb} MB`);
      }
    };

    const pdf = await task.promise;
    const numPages = pdf.numPages || 0;
    const startPage = state.totalPages + 1;
    state.pdfs.push({ pdf, label, numPages, startPage });
    state.totalPages += numPages;

    if (!state.fitRefViewport) {
      try {
        const p1 = await pdf.getPage(1);
        state.fitRefViewport = p1.getViewport({ scale: 1 });
      } catch {}
    }
  }

  state.currentPage = clamp(initialPage, 1, state.totalPages || 1);
  updateUrl(state.currentPage);
  setPageInput();
  setProgress();
  setButtonsEnabled();
  setStatus("พร้อมใช้งาน");

  buildToc();
  buildAbout();
  await computeFitScale();
  await renderCurrentFull();
}

function resolveDocPage(globalPage) {
  let page = clamp(globalPage, 1, state.totalPages || 1);
  for (const d of state.pdfs) {
    const start = d.startPage;
    const end = d.startPage + d.numPages - 1;
    if (page >= start && page <= end) {
      return { pdf: d.pdf, pageInDoc: page - d.startPage + 1, partLabel: d.label };
    }
  }
  const last = state.pdfs[state.pdfs.length - 1];
  return { pdf: last.pdf, pageInDoc: last.numPages, partLabel: last.label };
}

function ensureCanvasSize(canvas, w, h) {
  if (canvas.width === w && canvas.height === h) return;
  canvas.width = w;
  canvas.height = h;
}

async function computeFitScale() {
  if (!state.fitRefViewport) return;
  const rect = ui.page3d.getBoundingClientRect();
  const w = Math.max(10, rect.width);
  const h = Math.max(10, rect.height);
  const fit = Math.min(w / state.fitRefViewport.width, h / state.fitRefViewport.height);
  state.baseFitScale = Number.isFinite(fit) && fit > 0 ? fit : 1;
}

function desiredScale({ quality }) {
  const zoom = clamp(state.zoomPct, 50, 200) / 100;
  const dpr = Math.max(1, Math.min(2.0, window.devicePixelRatio || 1));
  const qualityFactor = quality === "fast" ? 0.55 : 1;
  let scale = state.baseFitScale * zoom * dpr * qualityFactor;

  // Cap render size to reduce lag on big pages.
  const maxDim = 2400;
  if (state.unitViewport) {
    const vw = state.unitViewport.width * scale;
    const vh = state.unitViewport.height * scale;
    const worst = Math.max(vw, vh);
    if (worst > maxDim) scale *= maxDim / worst;
  }
  return scale;
}

function drawPlaceholder(canvas, label) {
  const rect = ui.page3d.getBoundingClientRect();
  const dpr = Math.max(1, Math.min(2.0, window.devicePixelRatio || 1));
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
  ctx.fillText(`กำลังโหลดหน้า ${label}…`, Math.floor(w / 2), Math.floor(h / 2));
}

async function renderPage(globalPage, canvas, { quality, background = false }) {
  if (!state.pdfs.length) return;
  const nonce = ++state.renderNonce;
  if (!background) {
    state.rendering = true;
    setButtonsEnabled();
  }

  try {
    const { pdf, pageInDoc } = resolveDocPage(globalPage);
    const page = await pdf.getPage(pageInDoc);
    if (nonce !== state.renderNonce) return;

    const unit = page.getViewport({ scale: 1 });
    state.unitViewport = unit;
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
  setStatus("กำลังเรนเดอร์…");
  await renderPage(state.currentPage, ui.canvasA, { quality: "full" });
  setStatus("พร้อมใช้งาน");

  const next = state.currentPage + 1;
  if (next <= state.totalPages) {
    setTimeout(() => {
      if (state.currentPage + 1 !== next) return;
      void renderPage(next, ui.canvasB, { quality: "fast", background: true });
    }, 120);
  }
}

function copyCanvas(src, dst) {
  ensureCanvasSize(dst, src.width, src.height);
  const ctx = dst.getContext("2d", { alpha: false });
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(src, 0, 0);
}

function makeFlipSound() {
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

async function flipTo(nextPage) {
  if (!state.pdfs.length) return;
  if (nextPage === state.currentPage) return;
  nextPage = clamp(nextPage, 1, state.totalPages);
  if (state.rendering) return;

  const forward = nextPage > state.currentPage;
  setStatus(`กำลังไปหน้า ${nextPage}…`);

  state.rendering = true;
  setButtonsEnabled();

  if (!state.reducedMotion) {
    playFlip();
    ui.page3d.classList.remove("flipAnim", "back");
    void ui.page3d.offsetWidth;
    ui.page3d.classList.add("flipAnim");
    if (!forward) ui.page3d.classList.add("back");
  }

  drawPlaceholder(ui.canvasB, `${nextPage}`);
  const fastRender = renderPage(nextPage, ui.canvasB, { quality: "fast", background: true }).catch(() => {});

  const animDone = () =>
    new Promise((resolve) => {
      if (state.reducedMotion) return resolve();
      const onEnd = () => resolve();
      ui.page3d.addEventListener("animationend", onEnd, { once: true });
    });

  await animDone();
  copyCanvas(ui.canvasB, ui.canvasA);
  state.currentPage = nextPage;
  updateUrl(state.currentPage);
  setPageInput();
  setProgress();

  await fastRender;
  await renderCurrentFull();
}

async function goToPage(page) {
  page = clamp(page, 1, state.totalPages || 1);
  state.pendingNav = page;
  if (state.navLoopRunning) return;
  state.navLoopRunning = true;
  try {
    while (state.pendingNav != null) {
      const target = state.pendingNav;
      state.pendingNav = null;
      await flipTo(target);
    }
  } finally {
    state.navLoopRunning = false;
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
  setStatus(`ซูม ${pct}%…`);
  await renderCurrentFull();
}

function wireResize() {
  let t = null;
  const onChange = () => {
    clearTimeout(t);
    t = setTimeout(async () => {
      if (!state.pdfs.length) return;
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

function wireDrawer() {
  ui.tocBtn.addEventListener("click", () => openDrawer("toc"));
  ui.thumbBtn.addEventListener("click", () => openDrawer("thumb"));
  ui.drawerCloseBtn.addEventListener("click", () => closeDrawer());
  ui.scrim.addEventListener("click", () => closeDrawer());

  ui.tabToc.addEventListener("click", () => selectTab("toc"));
  ui.tabThumb.addEventListener("click", () => selectTab("thumb"));
  ui.tabAbout.addEventListener("click", () => selectTab("about"));
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
    clearTimeout(wireUi._zoomT);
    wireUi._zoomT = setTimeout(() => void applyZoomFromRange(), 120);
  });

  ui.fullscreenBtn.addEventListener("click", () => void toggleFullscreen());
  ui.themeBtn.addEventListener("click", () => {
    const t = document.body.dataset.theme === "light" ? "dark" : "light";
    setTheme(t);
  });

  window.addEventListener("keydown", (e) => {
    if (state.drawerOpen) return;
    if (e.key === "ArrowLeft") return void goToPage(state.currentPage - 1);
    if (e.key === "ArrowRight") return void goToPage(state.currentPage + 1);
    if (e.key === "Escape") return void closeDrawer();
  });
}

function ensureThumbsBuilt() {
  if (!state.totalPages) return;
  if (ui.thumbGrid.childElementCount === state.totalPages) return;

  ui.thumbGrid.textContent = "";
  const frag = document.createDocumentFragment();
  for (let p = 1; p <= state.totalPages; p++) {
    const el = document.createElement("div");
    el.className = "thumb";
    el.dataset.page = String(p);
    el.innerHTML = `
      <canvas class="thumbCanvas" width="10" height="10"></canvas>
      <div class="thumbMeta"><span>#${p}</span><span></span></div>
    `;
    el.addEventListener("click", () => {
      closeDrawer();
      void goToPage(p);
    });
    frag.appendChild(el);
  }
  ui.thumbGrid.appendChild(frag);

  if (state.thumbObserver) state.thumbObserver.disconnect();
  state.thumbObserver = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        const page = parseInt(e.target.dataset.page || "0", 10);
        if (!page || state.thumbRendered.has(page)) continue;
        const canvas = e.target.querySelector("canvas");
        state.thumbRendered.add(page);
        void renderThumb(page, canvas).catch(() => {});
      }
    },
    { root: ui.drawer.querySelector(".drawerBody"), rootMargin: "120px 0px", threshold: 0.01 }
  );

  for (const el of ui.thumbGrid.children) state.thumbObserver.observe(el);
  highlightActiveThumb();
}

function highlightActiveThumb() {
  if (!state.drawerOpen) return;
  if (!ui.thumbGrid || !ui.thumbGrid.childElementCount) return;
  const current = String(state.currentPage);
  for (const el of ui.thumbGrid.children) {
    el.classList.toggle("thumbActive", el.dataset.page === current);
  }
}

async function renderThumb(globalPage, canvas) {
  const { pdf, pageInDoc } = resolveDocPage(globalPage);
  const page = await pdf.getPage(pageInDoc);
  const unit = page.getViewport({ scale: 1 });
  const targetW = 220;
  const scale = Math.min(1, targetW / unit.width);
  const viewport = page.getViewport({ scale });
  const ctx = canvas.getContext("2d", { alpha: false });
  ensureCanvasSize(canvas, Math.floor(viewport.width), Math.floor(viewport.height));
  const task = page.render({ canvasContext: ctx, viewport, renderInteractiveForms: false });
  await task.promise;
}

async function main() {
  window.__ebook_booted = true;

  ui.bookTitle.textContent = BOOK?.title || "หนังสือรุ่น";
  ui.fileLabel.textContent = BOOK?.subtitle || "E-Book";

  initTheme();
  wireUi();
  wireDrawer();
  wireResize();

  // Best-effort cleanup in case an older version registered a Service Worker.
  try {
    if ("serviceWorker" in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    }
    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
  } catch {}

  const { page } = parseUrlParams();
  const sources = resolvePdfSources();

  try {
    await openPdfSources(sources, page);
  } catch (e) {
    console.warn(e);
    setStatus("เริ่มระบบไม่สำเร็จ: โหลดไฟล์ PDF ไม่ได้ (เช็คชื่อไฟล์/พาธ/CORS)");
    setButtonsEnabled();
    ui.pageTotal.textContent = "–";
    ui.progressText.textContent = "—";
    ui.fileLabel.textContent = "—";
    openDrawer("about");
  }
}

main();
