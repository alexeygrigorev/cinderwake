import { describe, expect, it } from "vitest";
import { buildRenderManifest } from "../../src/render/manifest";
import {
  BUILTIN_SCENARIOS,
  worldFromScenario,
} from "../../src/testkit/scenarios";

describe("visible barriers follow collision boundaries", () => {
  it("pairs every solid edge with connected masonry and upright ironwork", () => {
    const state = worldFromScenario(BUILTIN_SCENARIOS["generated-run"]!);
    const manifest = buildRenderManifest(state, { x: 480, y: 270, zoom: 1 });
    const edges = manifest.sceneSprites.filter(({ objectId }) =>
      objectId.startsWith("boundary:"),
    );
    expect(edges.length).toBeGreaterThan(20);
    for (const edge of edges) {
      const fence = manifest.sceneSprites.find(
        ({ objectId }) =>
          objectId === edge.objectId.replace("boundary:", "boundary-fence:"),
      );
      expect(fence, edge.objectId).toBeDefined();
      expect(edge.opacity).toBeGreaterThanOrEqual(0.9);
      expect(edge.destinationRect.width).toBeGreaterThanOrEqual(48);
      expect(fence!.rotation).toBe(0);
      expect(fence!.worldAnchor).toEqual(edge.worldAnchor);
      const vertical = /boundary:(east|west):/.test(edge.objectId);
      expect(fence!.spriteId).toBe(
        vertical
          ? "scenery:boundary:iron-fence-vertical"
          : "scenery:boundary:iron-fence",
      );
      expect(
        fence!.destinationRect.width / fence!.destinationRect.height,
      ).toBeCloseTo(fence!.sourceRect.width / fence!.sourceRect.height, 6);
    }
  });
});
