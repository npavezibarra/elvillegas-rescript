Bundled yt-dlp binaries live here.

Rescript resolves yt-dlp in this order:

1. `RESCRIPT_YTDLP_PATH`
2. `build/yt-dlp/<platform>-<arch>/yt-dlp` in development
3. `process.resourcesPath/yt-dlp/<platform>-<arch>/yt-dlp` in packaged apps
4. `yt-dlp` from the system PATH

Use these folder names:

- `darwin-arm64/yt-dlp`
- `darwin-x64/yt-dlp`
- `linux-x64/yt-dlp`
- `linux-arm64/yt-dlp`
- `win32-x64/yt-dlp.exe`
- `win32-arm64/yt-dlp.exe`

The binaries are not checked in by default. Release automation can place them
here before running `npm run dist` or `npm run release`.
