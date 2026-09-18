import {
  app,
  BrowserWindow,
  ipcMain,
  protocol,
  screen,
  shell,
  net,
  type WebContents,
} from "electron";
import { spawn } from "node:child_process";
import {
  existsSync,
  chmodSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { join, normalize, extname } from "node:path";
import { pathToFileURL } from "node:url";
import { initMainSentry, setMainTelemetryEnabled } from "./sentry";
import { initAutoUpdater } from "./updater";
import {
  buildAppMenu,
  setRecentProjects,
  type MenuCommand,
  type RecentProject,
} from "./menu";
import {
  isDesktopLocale,
  resolveDesktopLocale,
  setDesktopLocale,
} from "./locale";

const isDev = !app.isPackaged;
const DEV_SERVER_URL = process.env.ELECTRON_START_URL ?? "http://localhost:3000";
const isMac = process.platform === "darwin";

type YouTubeImportResult = {
  name: string;
  type: string;
  data: ArrayBuffer;
};

type YouTubeImportProgress = {
  id: string;
  status: "starting" | "metadata" | "downloading" | "processing";
  percent: number | null;
  detail?: string;
};

type ActiveYouTubeImport = {
  child: ReturnType<typeof spawn>;
  outputDir: string;
};

type WindowMode = "compact" | "expanded";

/** The shell has two resting sizes: a small window for the upload screen, and a
 *  roomy one once the editor (transcript + preview + timeline) takes over. */
const WINDOW_SIZES: Record<WindowMode, { width: number; height: number }> = {
  compact: { width: 560, height: 400 },
  expanded: { width: 1080, height: 740 },
};
const MIN_SIZE = { width: 560, height: 400 };

/** Height of the in-page drag strip (`h-12`), used to centre the traffic lights. */
const TITLE_BAR_HEIGHT = 48;
/** macOS traffic light buttons are 12px tall. */
const TRAFFIC_LIGHT_HEIGHT = 12;

/** MIME types for the custom app:// protocol that serves the Next static export. */
const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".wasm": "application/wasm",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".map": "application/json",
  ".txt": "text/plain; charset=utf-8",
};

const MEDIA_MIME: Record<string, string> = {
  ".mp4": "video/mp4",
  ".m4v": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
};

const activeYouTubeImports = new Map<string, ActiveYouTubeImport>();
const MAX_YOUTUBE_IMPORT_DURATION_SECONDS = 4 * 60 * 60;
const MAX_YOUTUBE_IMPORT_BYTES = 2 * 1024 * 1024 * 1024;
const YTDLP_UNAVAILABLE_MESSAGE =
  "yt-dlp is not available. Bundle it with Rescript, set RESCRIPT_YTDLP_PATH, or install yt-dlp and try again.";

function executableName(base: string): string {
  return process.platform === "win32" ? `${base}.exe` : base;
}

// At module scope, before `app.whenReady()`: a crash while registering the
// protocol or resolving the static root happens before any window exists, and
// those are precisely the failures nothing else can report.
//
// This must also come *before* our own registerSchemesAsPrivileged call below.
// Electron's registerSchemesAsPrivileged replaces the scheme list rather than
// appending to it, and Sentry registers its own `sentry-ipc` scheme during
// init, then proxies the function so *later* calls merge its scheme back in.
// Registering `app` first therefore gets it silently overwritten, and the
// renderer's fetch() of app:// URLs fails with `URL scheme "app" is not
// supported` — which is how ffmpeg.wasm's core fails to load.
initMainSentry();

// Register before app ready so the scheme can be privileged (fetch, workers,
// SharedArrayBuffer via COOP/COEP headers we attach below).
protocol.registerSchemesAsPrivileged([
  {
    scheme: "app",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);

function staticRoot(): string {
  // Packaged: next export lives next to the compiled main process under
  // resources/app (asar) or we copy it beside electron-dist.
  return join(__dirname, "..", "out");
}

function resolveStaticPath(urlPath: string): string | null {
  const root = staticRoot();
  let pathname = decodeURIComponent(urlPath);
  if (pathname === "/" || pathname === "") pathname = "/index.html";
  // Strip leading slash and normalize; reject path escape attempts.
  const rel = normalize(pathname.replace(/^\/+/, ""));
  if (rel.startsWith("..")) return null;
  let filePath = join(root, rel);
  if (existsSync(filePath) && statSync(filePath).isDirectory()) {
    filePath = join(filePath, "index.html");
  }
  if (!existsSync(filePath) || !statSync(filePath).isFile()) return null;
  return filePath;
}

function registerAppProtocol(): void {
  protocol.handle("app", async (request) => {
    const { pathname } = new URL(request.url);
    const filePath = resolveStaticPath(pathname);
    if (!filePath) {
      return new Response("Not found", { status: 404, statusText: "Not Found" });
    }
    const fileUrl = pathToFileURL(filePath).toString();
    const response = await net.fetch(fileUrl);
    const headers = new Headers(response.headers);
    // Enable SharedArrayBuffer for ffmpeg.wasm + onnxruntime (same as Next
    // headers() in next.config.ts for the non-export server).
    headers.set("Cross-Origin-Opener-Policy", "same-origin");
    headers.set("Cross-Origin-Embedder-Policy", "require-corp");
    const type = MIME[extname(filePath).toLowerCase()];
    if (type) headers.set("Content-Type", type);
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  });
}

function bufferToArrayBuffer(buffer: Buffer): ArrayBuffer {
  return buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength
  ) as ArrayBuffer;
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function ytDlpPathEnv(): string {
  const extra =
    process.platform === "darwin"
      ? ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"]
      : ["/usr/local/bin", "/usr/bin", "/bin"];
  return [...extra, process.env.PATH ?? ""].filter(Boolean).join(":");
}

function platformResourceSegment(): string {
  return `${process.platform}-${process.arch}`;
}

function usableFile(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isFile();
  } catch {
    return false;
  }
}

function ensureExecutable(path: string): void {
  if (process.platform === "win32") return;
  try {
    chmodSync(path, 0o755);
  } catch {
    // If chmod fails, let spawn surface the real execution error below.
  }
}

function bundledYtDlpCandidates(): string[] {
  const name = executableName("yt-dlp");
  const segment = platformResourceSegment();
  const candidates: string[] = [];
  if (app.isPackaged) {
    candidates.push(join(process.resourcesPath, "yt-dlp", segment, name));
    candidates.push(join(process.resourcesPath, "yt-dlp", name));
  } else {
    candidates.push(join(process.cwd(), "build", "yt-dlp", segment, name));
    candidates.push(join(process.cwd(), "build", "yt-dlp", name));
  }
  return candidates;
}

function resolveYtDlpCommand(): { command: string; bundled: boolean } {
  const envPath = process.env.RESCRIPT_YTDLP_PATH;
  if (envPath && usableFile(envPath)) {
    ensureExecutable(envPath);
    return { command: envPath, bundled: true };
  }

  for (const candidate of bundledYtDlpCandidates()) {
    if (!usableFile(candidate)) continue;
    ensureExecutable(candidate);
    return { command: candidate, bundled: true };
  }

  return { command: "yt-dlp", bundled: false };
}

function formatDuration(seconds: number): string {
  const rounded = Math.round(seconds);
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function formatBytes(bytes: number): string {
  const units = ["B", "KB", "MB", "GB"] as const;
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

function emitYouTubeProgress(
  contents: WebContents,
  progress: YouTubeImportProgress
): void {
  if (!contents.isDestroyed()) contents.send("youtube:import-progress", progress);
}

function runYtDlpJson(
  id: string,
  url: string,
  outputDir: string
): Promise<Record<string, unknown>> {
  const ytDlp = resolveYtDlpCommand();
  const args = ["--dump-single-json", "--no-playlist", "--skip-download", url];

  return new Promise((resolve, reject) => {
    const child = spawn(ytDlp.command, args, {
      env: { ...process.env, PATH: ytDlpPathEnv() },
      windowsHide: true,
    });
    activeYouTubeImports.set(id, { child, outputDir });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (err) => {
      activeYouTubeImports.delete(id);
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        reject(new Error(YTDLP_UNAVAILABLE_MESSAGE));
        return;
      }
      reject(err);
    });
    child.on("close", (code) => {
      activeYouTubeImports.delete(id);
      if (child.killed && code !== 0) {
        reject(new Error("YouTube import was cancelled."));
        return;
      }
      if (code !== 0) {
        reject(
          new Error(stderr.trim() || `yt-dlp failed with exit code ${code ?? "unknown"}.`)
        );
        return;
      }
      try {
        resolve(JSON.parse(stdout) as Record<string, unknown>);
      } catch {
        reject(new Error("yt-dlp returned unreadable video metadata."));
      }
    });
  });
}

async function inspectYouTubeVideo(
  url: string,
  contents: WebContents,
  id: string,
  outputDir: string
): Promise<void> {
  emitYouTubeProgress(contents, {
    id,
    status: "metadata",
    percent: null,
    detail: "Reading video details...",
  });

  const metadata = await runYtDlpJson(id, url, outputDir);
  const title = typeof metadata.title === "string" ? metadata.title : null;
  const duration = typeof metadata.duration === "number" ? metadata.duration : null;
  const filesize =
    typeof metadata.filesize === "number"
      ? metadata.filesize
      : typeof metadata.filesize_approx === "number"
        ? metadata.filesize_approx
        : null;

  if (duration !== null && duration > MAX_YOUTUBE_IMPORT_DURATION_SECONDS) {
    throw new Error(
      `This video is ${formatDuration(duration)} long. Rescript currently imports YouTube videos up to ${formatDuration(MAX_YOUTUBE_IMPORT_DURATION_SECONDS)}.`
    );
  }
  if (filesize !== null && filesize > MAX_YOUTUBE_IMPORT_BYTES) {
    throw new Error(
      `This video is about ${formatBytes(filesize)}. Rescript currently imports YouTube videos up to ${formatBytes(MAX_YOUTUBE_IMPORT_BYTES)}.`
    );
  }

  emitYouTubeProgress(contents, {
    id,
    status: "metadata",
    percent: null,
    detail: title ? `Importing "${title}"...` : "Video details ready...",
  });
}

function parseYtDlpPercent(line: string): number | null {
  const match = line.match(/\[download\]\s+(\d+(?:\.\d+)?)%/);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? clamp(value, 0, 100) : null;
}

function cleanupImportDir(outputDir: string): void {
  try {
    rmSync(outputDir, { recursive: true, force: true });
  } catch (err) {
    console.warn("Failed to clean YouTube import directory.", err);
  }
}

function runYtDlp(
  id: string,
  url: string,
  outputDir: string,
  contents: WebContents
): Promise<void> {
  const args = [
    "--no-playlist",
    "--restrict-filenames",
    "--merge-output-format",
    "mp4",
    "-f",
    "bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/best",
    "-o",
    join(outputDir, "%(title).180B-%(id)s.%(ext)s"),
    url,
  ];

  return new Promise((resolve, reject) => {
    const ytDlp = resolveYtDlpCommand();
    emitYouTubeProgress(contents, {
      id,
      status: "starting",
      percent: null,
      detail: ytDlp.bundled ? "Starting bundled yt-dlp..." : "Starting yt-dlp...",
    });
    const child = spawn(ytDlp.command, args, {
      env: { ...process.env, PATH: ytDlpPathEnv() },
      windowsHide: true,
    });
    activeYouTubeImports.set(id, { child, outputDir });
    let stderr = "";
    let cancelled = false;
    let lastPercent: number | null = null;

    const handleOutput = (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      stderr += text;
      for (const line of text.split(/\r?\n/)) {
        const percent = parseYtDlpPercent(line);
        if (percent === null || percent === lastPercent) continue;
        lastPercent = percent;
        emitYouTubeProgress(contents, {
          id,
          status: "downloading",
          percent,
          detail: "Downloading video...",
        });
      }
      if (/\[Merger\]|\[ExtractAudio\]|\[VideoConvertor\]|\[Fixup\]/.test(text)) {
        emitYouTubeProgress(contents, {
          id,
          status: "processing",
          percent: 100,
          detail: "Preparing media...",
        });
      }
    };

    child.stdout.on("data", handleOutput);
    child.stderr.on("data", handleOutput);
    child.on("error", (err) => {
      activeYouTubeImports.delete(id);
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        reject(new Error(YTDLP_UNAVAILABLE_MESSAGE));
        return;
      }
      reject(err);
    });
    child.on("close", (code) => {
      activeYouTubeImports.delete(id);
      cancelled = child.killed && code !== 0;
      if (cancelled) {
        reject(new Error("YouTube import was cancelled."));
        return;
      }
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          stderr.trim() || `yt-dlp failed with exit code ${code ?? "unknown"}.`
        )
      );
    });
  });
}

async function importYouTubeVideo(
  id: string,
  url: string,
  contents: WebContents
): Promise<YouTubeImportResult> {
  const trimmed = url.trim();
  if (!isHttpUrl(trimmed)) throw new Error("Enter a valid YouTube URL.");

  const root = join(app.getPath("userData"), "youtube-imports");
  mkdirSync(root, { recursive: true });
  const outputDir = join(root, `${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(outputDir, { recursive: true });

  try {
    await inspectYouTubeVideo(trimmed, contents, id, outputDir);
    await runYtDlp(id, trimmed, outputDir, contents);

    const candidates = readdirSync(outputDir)
      .map((name) => {
        const path = join(outputDir, name);
        const stat = statSync(path);
        return { name, path, stat };
      })
      .filter(({ name, stat }) => stat.isFile() && MEDIA_MIME[extname(name).toLowerCase()])
      .sort((a, b) => b.stat.size - a.stat.size);

    const downloaded = candidates[0];
    if (!downloaded) throw new Error("yt-dlp finished, but no supported media file was found.");

    emitYouTubeProgress(contents, {
      id,
      status: "processing",
      percent: 100,
      detail: "Loading media into Rescript...",
    });

    const ext = extname(downloaded.name).toLowerCase();
    return {
      name: downloaded.name,
      type: MEDIA_MIME[ext] ?? "application/octet-stream",
      data: bufferToArrayBuffer(readFileSync(downloaded.path)),
    };
  } catch (err) {
    cleanupImportDir(outputDir);
    throw err;
  }
}

/** Tracks each window's current mode so repeated requests are no-ops. */
const windowModes = new WeakMap<BrowserWindow, WindowMode>();

/** Renderers that have mounted and subscribed to menu commands. A freshly
 *  created (or reloading) window isn't listening yet, so its commands wait. */
const readyRenderers = new WeakSet<WebContents>();
const pendingCommands = new WeakMap<WebContents, MenuCommand[]>();

function deliverMenuCommand(contents: WebContents, command: MenuCommand): void {
  if (command.type === "open-file") {
    // Chromium only opens a file chooser under user activation, which an IPC
    // message doesn't carry — the click() is silently dropped. executeJavaScript
    // can grant one, so the picker is driven that way instead.
    void contents
      .executeJavaScript("window.rescriptOpenFilePicker?.()", true)
      .catch((err: unknown) => console.error("Failed to open the file picker.", err));
    return;
  }
  contents.send("menu:command", command);
}

function flushPendingCommands(contents: WebContents): void {
  const queued = pendingCommands.get(contents);
  pendingCommands.delete(contents);
  for (const command of queued ?? []) deliverMenuCommand(contents, command);
}

/** Deliver a File-menu command, launching a window if the app is running
 *  window-less (macOS keeps the menu bar after the last window closes). */
function dispatchMenuCommand(command: MenuCommand): void {
  const win =
    BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? createWindow();
  const contents = win.webContents;
  if (readyRenderers.has(contents)) {
    deliverMenuCommand(contents, command);
    return;
  }
  const queued = pendingCommands.get(contents) ?? [];
  queued.push(command);
  pendingCommands.set(contents, queued);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Resize a window to the given mode's resting size, keeping it centred on
 *  wherever the user left it rather than snapping to a corner. */
function applyWindowMode(win: BrowserWindow, mode: WindowMode): void {
  if (windowModes.get(win) === mode) return;
  windowModes.set(win, mode);
  // A maximized or full-screen window is already the size the user asked for.
  if (win.isFullScreen() || win.isMaximized()) return;

  const current = win.getBounds();
  const { workArea } = screen.getDisplayMatching(current);
  const width = Math.min(WINDOW_SIZES[mode].width, workArea.width);
  const height = Math.min(WINDOW_SIZES[mode].height, workArea.height);
  win.setBounds(
    {
      width,
      height,
      x: Math.round(
        clamp(
          current.x + (current.width - width) / 2,
          workArea.x,
          workArea.x + workArea.width - width
        )
      ),
      y: Math.round(
        clamp(
          current.y + (current.height - height) / 2,
          workArea.y,
          workArea.y + workArea.height - height
        )
      ),
    },
    true // animate (macOS)
  );
}

/** Set once the app is really terminating, so the close interception below
 *  doesn't swallow the quit. */
let quitting = false;

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    ...WINDOW_SIZES.compact,
    minWidth: MIN_SIZE.width,
    minHeight: MIN_SIZE.height,
    // Light by default — appearance is a user preference in the renderer.
    backgroundColor: "#fafafa",
    title: "Rescript",
    show: false,
    // macOS: drop the native title bar and let the page's top bar / upload drag
    // strip move the window instead. Windows and Linux keep their native frame
    // — hiding it there would take the caption buttons with it.
    ...(isMac
      ? {
          titleBarStyle: "hidden" as const,
          trafficLightPosition: {
            x: 16,
            y: Math.round((TITLE_BAR_HEIGHT - TRAFFIC_LIGHT_HEIGHT) / 2),
          },
        }
      : {}),
    webPreferences: {
      preload: join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  windowModes.set(win, "compact");

  win.once("ready-to-show", () => win.show());

  // A reload tears down the listener the renderer registered; make it re-announce.
  win.webContents.on("did-start-navigation", (event) => {
    if (event.isSameDocument) return;
    readyRenderers.delete(win.webContents);
    pendingCommands.delete(win.webContents);
  });

  // Closing while the editor is open drops the project rather than the window:
  // the renderer returns to the upload screen and the shell shrinks back. The
  // next close (already on the upload screen) is a real close. Guarded on the
  // renderer being live, so an unresponsive page can still be closed.
  win.on("close", (event) => {
    if (quitting) return;
    if (windowModes.get(win) !== "expanded") return;
    if (!readyRenderers.has(win.webContents)) return;
    event.preventDefault();
    win.webContents.send("menu:command", { type: "close-project" } satisfies MenuCommand);
  });

  // The page pads its top bar for the traffic lights, which macOS hides in
  // full screen; tell it when that changes so the gap can collapse.
  const emitFullScreen = () => {
    if (!win.isDestroyed()) {
      win.webContents.send("window:full-screen-changed", win.isFullScreen());
    }
  };
  win.on("enter-full-screen", emitFullScreen);
  win.on("leave-full-screen", emitFullScreen);

  // Open external http(s) links in the OS browser; keep app:// / localhost in-app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http:") || url.startsWith("https:")) {
      void shell.openExternal(url);
      return { action: "deny" };
    }
    return { action: "allow" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    const isApp = url.startsWith("app://");
    const isDevServer = isDev && url.startsWith(DEV_SERVER_URL);
    if (!isApp && !isDevServer) {
      event.preventDefault();
      if (url.startsWith("http:") || url.startsWith("https:")) {
        void shell.openExternal(url);
      }
    }
  });

  if (isDev) {
    void win.loadURL(DEV_SERVER_URL);
  } else {
    void win.loadURL("app://localhost/");
  }

  return win;
}

// Ensure a single instance — second launches focus the existing window.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const [win] = BrowserWindow.getAllWindows();
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  ipcMain.on("window:set-mode", (event, mode: unknown) => {
    if (mode !== "compact" && mode !== "expanded") return;
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) applyWindowMode(win, mode);
  });
  ipcMain.handle(
    "window:is-full-screen",
    (event) => BrowserWindow.fromWebContents(event.sender)?.isFullScreen() ?? false
  );
  ipcMain.handle("youtube:import-video", async (event, value: unknown) => {
    if (
      !value ||
      typeof value !== "object" ||
      typeof (value as { id?: unknown }).id !== "string" ||
      typeof (value as { url?: unknown }).url !== "string"
    ) {
      throw new Error("Enter a valid YouTube URL.");
    }
    const { id, url } = value as { id: string; url: string };
    return importYouTubeVideo(id, url, event.sender);
  });
  ipcMain.handle("youtube:cancel-import", async (_event, value: unknown) => {
    if (typeof value !== "string") return;
    const active = activeYouTubeImports.get(value);
    if (!active) return;
    active.child.kill("SIGTERM");
    cleanupImportDir(active.outputDir);
    activeYouTubeImports.delete(value);
  });
  // The renderer owns the preference; this mirrors it so the next launch can gate
  // reporting before any window exists.
  ipcMain.on("telemetry:set-enabled", (_event, value: unknown) => {
    setMainTelemetryEnabled(value === true);
  });
  ipcMain.on("ui:set-locale", (_event, value: unknown) => {
    if (!isDesktopLocale(value)) return;
    setDesktopLocale(value);
    buildAppMenu();
  });
  // The saved projects live in the renderer's IndexedDB; it pushes a snapshot
  // whenever the list changes so the File menu can list them.
  ipcMain.on("menu:set-recents", (_event, value: unknown) => {
    if (!Array.isArray(value)) return;
    const recents: RecentProject[] = [];
    for (const entry of value) {
      if (!entry || typeof entry !== "object") continue;
      const { id, name } = entry as { id?: unknown; name?: unknown };
      if (typeof id !== "string" || typeof name !== "string") continue;
      recents.push({ id, name });
    }
    setRecentProjects(recents);
  });
  // The renderer announces itself once it is listening for menu commands; until
  // then anything the menu fired at a just-opened window is held.
  ipcMain.on("menu:renderer-ready", (event) => {
    readyRenderers.add(event.sender);
    flushPendingCommands(event.sender);
  });

  app.on("before-quit", () => {
    quitting = true;
  });

  app.whenReady().then(() => {
    setDesktopLocale(resolveDesktopLocale(app.getLocale()));
    if (!isDev) registerAppProtocol();
    buildAppMenu(dispatchMenuCommand);
    createWindow();
    initAutoUpdater();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
