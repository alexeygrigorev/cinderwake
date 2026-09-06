import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { VOICE_CUES } from "../../src/audio/GameAudio";
import manifest from "../../public/assets/audio/manifest.json";

describe("generated audio provenance", () => {
  it("ships every runtime cue with matching hashes and public provider provenance", () => {
    expect(manifest.provider).toBe("ElevenLabs");
    const expected = [
      "strike",
      "hit",
      "loot",
      "quest",
      "danger",
      "ability",
      ...VOICE_CUES,
    ];
    expect(manifest.assets.map((asset) => asset.cue).sort()).toEqual(
      expected.sort(),
    );
    let bytes = 0;
    for (const asset of manifest.assets) {
      const audio = readFileSync(
        new URL(`../../public/assets/audio/${asset.file}`, import.meta.url),
      );
      expect(audio.length).toBe(asset.bytes);
      expect(createHash("sha256").update(audio).digest("hex")).toBe(
        asset.sha256,
      );
      expect(asset.processing.targetPeakDb).toBe(-3);
      expect(asset.processing.sourceSha256).toMatch(/^[a-f0-9]{64}$/);
      expect(asset.text.length).toBeGreaterThan(10);
      if (asset.kind === "voice") expect(asset.voice?.category).toBe("premade");
      bytes += audio.length;
    }
    expect(bytes).toBeLessThan(1_000_000);
  });
});
