import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";

type YouTubeImportProgress = {
  id: string;
  status: "starting" | "metadata" | "downloading" | "processing";
  percent: number | null;
  detail?: string;
};

/**
 * Minimal bridge for the renderer. Rescript's UI is still a normal web
 * surface; we only expose host metadata so the page can adapt chrome / skip
 * the COI service worker (headers come from the app:// protocol instead),
 * plus the few window controls the page drives (sizing, title-bar state).
 */
contextBridge.exposeInMainWorld("rescriptDesktop", {
  platform: process.platform as NodeJS.Platform,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  },
  /** Switch between the compact upload window and the full editor window. */
  setWindowMode: (mode: "compact" | "expanded") => {
    ipcRenderer.send("window:set-mode", mode);
  },
  /**
   * Mirror the renderer's telemetry opt-out into the main process, which can't
   * read localStorage but needs the preference to gate its own crash reporting.
   */
  setTelemetryEnabled: (enabled: boolean) => {
    ipcRenderer.send("telemetry:set-enabled", enabled);
  },
  /** Keep native menus and dialogs in sync with the renderer preference. */
  setUiLocale: (locale: string) => {
    ipcRenderer.send("ui:set-locale", locale);
  },
  /**
   * Publish the saved-project list (newest first) so the main process can draw
   * it under File › Recent Projects. Only id + name are sent.
   */
  setRecentProjects: (projects: Array<{ id: string; name: string }>) => {
    ipcRenderer.send(
      "menu:set-recents",
      projects.map(({ id, name }) => ({ id, name }))
    );
  },
  /** Subscribe to File-menu actions; returns an unsubscribe function. */
  onMenuCommand: (callback: (command: unknown) => void) => {
    const listener = (_event: IpcRendererEvent, command: unknown) => callback(command);
    ipcRenderer.on("menu:command", listener);
    // Tell the main process the page is listening, so commands fired at a
    // window that was opened *by* the menu aren't lost before mount.
    ipcRenderer.send("menu:renderer-ready");
    return () => {
      ipcRenderer.off("menu:command", listener);
    };
  },
  isFullScreen: (): Promise<boolean> => ipcRenderer.invoke("window:is-full-screen"),
  importYouTubeVideo: (request: { id: string; url: string }) =>
    ipcRenderer.invoke("youtube:import-video", request) as Promise<{
      name: string;
      type: string;
      data: ArrayBuffer;
    }>,
  cancelYouTubeImport: (id: string) => ipcRenderer.invoke("youtube:cancel-import", id),
  onYouTubeImportProgress: (callback: (progress: YouTubeImportProgress) => void) => {
    const listener = (_event: IpcRendererEvent, progress: unknown) =>
      callback(progress as YouTubeImportProgress);
    ipcRenderer.on("youtube:import-progress", listener);
    return () => {
      ipcRenderer.off("youtube:import-progress", listener);
    };
  },
  onFullScreenChange: (callback: (value: boolean) => void) => {
    const listener = (_event: IpcRendererEvent, value: boolean) => callback(value);
    ipcRenderer.on("window:full-screen-changed", listener);
    return () => {
      ipcRenderer.off("window:full-screen-changed", listener);
    };
  },
});
