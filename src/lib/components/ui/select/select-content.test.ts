// @vitest-environment jsdom
import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
it("keeps the portaled menu above settings overlays and clickable", () => {
    const file = join(dirname(fileURLToPath(import.meta.url)), "select-content.svelte");
    const source = readFileSync(file, "utf8");
    expect(source).toContain("z-[1000]");
    expect(source).toContain("pointer-events-auto");
});
