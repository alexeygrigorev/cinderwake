import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runtimeFingerprint } from "./action-visual-review.mjs";

/** Freeze the game so concurrent edits cannot trigger HMR during a recording. */
export async function createCaptureWorkspace(root, sourceRoots) {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "cinderwake-capture-"),
  );
  try {
    const before = await runtimeFingerprint(root, sourceRoots);
    for (const entry of [
      "src",
      "public",
      "index.html",
      "package.json",
      "vite.config.ts",
      "tsconfig.json",
    ])
      await fs.cp(path.join(root, entry), path.join(directory, entry), {
        recursive: true,
      });
    await fs.mkdir(path.join(directory, "art"));
    for (const entry of await fs.readdir(path.join(root, "art"))) {
      if (entry.endsWith(".json"))
        await fs.copyFile(
          path.join(root, "art", entry),
          path.join(directory, "art", entry),
        );
    }
    await fs.symlink(
      path.join(root, "node_modules"),
      path.join(directory, "node_modules"),
      "dir",
    );
    const fingerprint = await runtimeFingerprint(directory, sourceRoots);
    if (before !== fingerprint)
      throw new Error(
        "Source changed while freezing capture workspace; retry capture",
      );
    return { directory, fingerprint };
  } catch (error) {
    await fs.rm(directory, { recursive: true, force: true });
    throw error;
  }
}
