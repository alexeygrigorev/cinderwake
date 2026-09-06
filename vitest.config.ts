import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // Atlas decoding and exhaustive render checks are CPU/memory heavy. Bound
    // concurrency so a busy agent workspace does not turn them into timeouts.
    maxWorkers: 2,
    include: ["tests/unit/**/*.test.ts"],
    coverage: { reporter: ["text", "html"] },
  },
});
