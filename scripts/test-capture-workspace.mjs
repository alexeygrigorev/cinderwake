import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createCaptureWorkspace } from "./lib/capture-workspace.mjs";
import { runtimeFingerprint } from "./lib/action-visual-review.mjs";

test("recordings retain frozen code and pixels while the working game changes", async () => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "capture-workspace-test-"),
  );
  let frozen;
  try {
    for (const entry of ["src", "public", "art", "node_modules"])
      await fs.mkdir(path.join(root, entry));
    for (const entry of [
      "index.html",
      "package.json",
      "vite.config.ts",
      "tsconfig.json",
    ])
      await fs.writeFile(path.join(root, entry), "{}");
    await fs.writeFile(path.join(root, "src/game.ts"), "original");
    await fs.writeFile(path.join(root, "public/sprite.png"), "original pixels");
    await fs.writeFile(path.join(root, "art/catalog.json"), "{}");
    const roots = ["src", "public", "art/catalog.json"];
    frozen = await createCaptureWorkspace(root, roots);
    await fs.writeFile(path.join(root, "src/game.ts"), "changed");
    await fs.writeFile(path.join(root, "public/sprite.png"), "changed pixels");
    assert.equal(
      await fs.readFile(path.join(frozen.directory, "src/game.ts"), "utf8"),
      "original",
    );
    assert.equal(
      await fs.readFile(
        path.join(frozen.directory, "public/sprite.png"),
        "utf8",
      ),
      "original pixels",
    );
    assert.equal(
      await runtimeFingerprint(frozen.directory, roots),
      frozen.fingerprint,
    );
    assert.notEqual(await runtimeFingerprint(root, roots), frozen.fingerprint);
    assert.equal(
      await fs.realpath(path.join(frozen.directory, "node_modules")),
      path.join(root, "node_modules"),
    );
  } finally {
    if (frozen) await fs.rm(frozen.directory, { recursive: true, force: true });
    await fs.rm(root, { recursive: true, force: true });
  }
});
