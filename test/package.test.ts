import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("package manifest", () => {
  it("points Pi at compiled JavaScript extension files", () => {
    const packageJson = JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8")) as {
      pi?: { extensions?: string[] };
    };

    expect(packageJson.pi?.extensions).toEqual(["./dist/extensions/company.js"]);

    for (const extension of packageJson.pi?.extensions ?? []) {
      expect(extension).toMatch(/\.js$/);
      expect(path.extname(extension)).toBe(".js");
    }
  });
});
