import { expect, test, type Page } from "@playwright/test";

async function audioSnapshot(page: Page) {
  return page.locator(".campaign-tools").evaluate(
    (element) =>
      JSON.parse((element as HTMLElement).dataset.audio!) as {
        contextState: string;
        musicPlaying: boolean;
        outputRms: number;
        played: number;
        failed: number;
        muted: boolean;
      },
  );
}

for (const mobile of [false, true]) {
  test.describe(mobile ? "touch audio" : "desktop audio", () => {
    test.use(
      mobile
        ? {
            viewport: { width: 390, height: 844 },
            hasTouch: true,
            isMobile: true,
          }
        : {},
    );

    test("the first Start gesture produces music, and visible sound controls recover persisted silence", async ({
      page,
    }) => {
      await page.goto("/");
      if (mobile) await page.locator("#begin").tap();
      else await page.locator("#begin").click();
      await expect(page.locator(".campaign-tools")).toBeVisible();
      // No additional gesture: Start must unlock audio before sprite loading.
      await expect
        .poll(async () => (await audioSnapshot(page)).musicPlaying)
        .toBe(true);
      await expect
        .poll(async () => (await audioSnapshot(page)).outputRms)
        .toBeGreaterThan(0.005);
      expect((await audioSnapshot(page)).contextState).toBe("running");
      expect((await audioSnapshot(page)).failed).toBe(0);
      await expect(page.locator("[data-sound-toggle]")).toBeInViewport();
      await page.locator("[data-sound-toggle]").click();
      await expect
        .poll(async () => (await audioSnapshot(page)).outputRms)
        .toBe(0);
      await page.reload();
      await page.locator(".continue-journey").click();
      await expect(page.locator("[data-sound-toggle]")).toHaveText("Sound off");
      expect((await audioSnapshot(page)).muted).toBe(true);
      await page.locator("[data-sound-toggle]").click();
      await expect
        .poll(async () => (await audioSnapshot(page)).outputRms)
        .toBeGreaterThan(0.005);
      await expect(page.locator("[data-sound-toggle]")).toHaveText("Sound on");
      const before = (await audioSnapshot(page)).played;
      if (mobile)
        await page.locator(".mobile-actions [data-action='attack']").tap();
      else await page.keyboard.press("Space");
      await expect
        .poll(async () => (await audioSnapshot(page)).played)
        .toBeGreaterThan(before);
    });
  });
}

test("every shipped sound decodes with audible signal, including sustained music", async ({
  page,
}) => {
  await page.goto("/");
  const levels = await page.evaluate(async () => {
    const context = new AudioContext();
    const manifest = await fetch("/assets/audio/manifest.json").then(
      (response) => response.json(),
    );
    const results = [];
    for (const asset of manifest.assets) {
      const response = await fetch(`/assets/audio/${asset.file}`);
      const buffer = await context.decodeAudioData(
        await response.arrayBuffer(),
      );
      const samples = buffer.getChannelData(0);
      let energy = 0;
      let peak = 0;
      for (const sample of samples) {
        energy += sample * sample;
        peak = Math.max(peak, Math.abs(sample));
      }
      results.push({
        cue: asset.cue,
        duration: buffer.duration,
        rms: Math.sqrt(energy / samples.length),
        peak,
      });
    }
    await context.close();
    return results;
  });
  expect(levels).toHaveLength(13);
  for (const level of levels) {
    expect(
      level.rms,
      `${level.cue} must contain audible samples`,
    ).toBeGreaterThan(0.015);
    expect(level.peak, `${level.cue} must not clip`).toBeLessThan(1);
  }
  expect(
    levels.find((level) => level.cue === "music")!.duration,
  ).toBeGreaterThan(40);
});
