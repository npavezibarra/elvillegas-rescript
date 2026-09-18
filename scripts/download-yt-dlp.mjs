#!/usr/bin/env node
import { chmodSync, createWriteStream, existsSync, mkdirSync, unlinkSync } from "node:fs";
import { basename, join } from "node:path";
import { pipeline } from "node:stream/promises";

const VERSION = process.env.YTDLP_VERSION ?? "latest";
const targets = [
  {
    platform: "darwin",
    arch: "arm64",
    asset: "yt-dlp_macos",
    output: "yt-dlp",
  },
  {
    platform: "darwin",
    arch: "x64",
    asset: "yt-dlp_macos",
    output: "yt-dlp",
  },
  {
    platform: "linux",
    arch: "x64",
    asset: "yt-dlp_linux",
    output: "yt-dlp",
  },
  {
    platform: "linux",
    arch: "arm64",
    asset: "yt-dlp_linux_aarch64",
    output: "yt-dlp",
  },
  {
    platform: "win32",
    arch: "x64",
    asset: "yt-dlp.exe",
    output: "yt-dlp.exe",
  },
  {
    platform: "win32",
    arch: "arm64",
    asset: "yt-dlp.exe",
    output: "yt-dlp.exe",
  },
];

function shouldDownload(target) {
  return (
    process.argv.includes("--all") ||
    (target.platform === process.platform && target.arch === process.arch)
  );
}

function releaseUrl(asset) {
  const tag = VERSION === "latest" ? "latest/download" : `download/${VERSION}`;
  return `https://github.com/yt-dlp/yt-dlp/releases/${tag}/${asset}`;
}

async function download(target) {
  const dir = join("build", "yt-dlp", `${target.platform}-${target.arch}`);
  const destination = join(dir, target.output);
  if (existsSync(destination) && !process.argv.includes("--force")) {
    console.log(`[yt-dlp] ${destination} already exists`);
    return;
  }

  mkdirSync(dir, { recursive: true });
  const url = releaseUrl(target.asset);
  const temp = `${destination}.download`;
  console.log(`[yt-dlp] downloading ${basename(destination)} for ${target.platform}-${target.arch}`);

  const response = await fetch(url, {
    headers: { "User-Agent": "rescript-build" },
    redirect: "follow",
  });
  if (!response.ok || !response.body) {
    throw new Error(`Failed to download ${url}: ${response.status} ${response.statusText}`);
  }

  try {
    await pipeline(response.body, createWriteStream(temp));
    if (target.platform !== "win32") chmodSync(temp, 0o755);
    try {
      unlinkSync(destination);
    } catch {}
    await import("node:fs/promises").then(({ rename }) => rename(temp, destination));
  } catch (err) {
    try {
      unlinkSync(temp);
    } catch {}
    throw err;
  }
}

for (const target of targets.filter(shouldDownload)) {
  await download(target);
}
