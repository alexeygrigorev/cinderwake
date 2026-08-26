import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  runActorAtlasLayoutNegativeControls,
  validateActorAtlasLayout,
} from "../../scripts/lib/actor-atlas-layout.mjs";
import { loadProductionSpriteCatalog } from "../framework/sprite-contract";

const root = process.cwd();
const spec = JSON.parse(
  await fs.readFile(path.join(root, "art", "actor-atlas-v1.json"), "utf8"),
);
const contract = JSON.parse(
  await fs.readFile(
    path.join(root, "quality", "actor-atlas-layout-contract.v1.json"),
    "utf8",
  ),
);

describe("actor atlas layout contract", () => {
  it("matches every production actor family, facing, clip, and cell map", async () => {
    const catalog = await loadProductionSpriteCatalog(root);
    const assessment = validateActorAtlasLayout({ catalog, spec, contract });

    expect(assessment.pass).toBe(true);
    expect(assessment.failures).toEqual([]);
    expect(assessment.summary).toMatchObject({
      expectedActors: 6,
      expectedFacings: 4,
      expectedClips: 6,
      expectedSpriteCount: 18,
      actualActorSpriteCount: 18,
      expectedBankCount: 144,
      mappedBankCount: 144,
      expectedFrameCount: 960,
    });
    expect(assessment.mappings).toHaveLength(144);
    const mapping = assessment.mappings.find(
      ({ actorId, facing, clip }) =>
        actorId === "ranger" && facing === "north" && clip === "walk",
    );
    expect(mapping).toMatchObject({
      spriteId: "hero:ranger:north",
      sourceGroup: "directionalClips",
      sourceKey: "northWalk",
      atlasRow: 7,
      frameCount: 8,
    });
    expect((mapping?.frameRects as unknown[])[0]).toEqual({
      x: 0,
      y: 896,
      width: 128,
      height: 128,
    });
  });

  it.each([
    ["registered-bank-omitted", "registered-bank-missing"],
    ["clip-facing-map-swapped", "clip-facing-cell-map-mismatch"],
    ["playable-layout-schema-diverged", "character-layout-schema-mismatch"],
  ])("detects %s", async (id, expectedSignal) => {
    const catalog = await loadProductionSpriteCatalog(root);
    const controls = runActorAtlasLayoutNegativeControls({
      catalog,
      spec,
      contract,
    });
    const control = controls.find((candidate) => candidate.id === id);

    expect(control).toMatchObject({
      id,
      expectedSignal,
      status: "DETECTED",
      signal: expectedSignal,
      detected: true,
    });
  });
});
