import { describe, expect, it } from "vitest";
import { parseCmuxSurfaceRef } from "../src/core/cmux.js";

describe("cmux helpers", () => {
  it("parses surface refs from plain cmux output", () => {
    expect(parseCmuxSurfaceRef("created surface:12\n")).toBe("surface:12");
  });

  it("parses top-level JSON surface refs", () => {
    expect(parseCmuxSurfaceRef(JSON.stringify({ surface_ref: "surface:7" }))).toBe("surface:7");
    expect(parseCmuxSurfaceRef(JSON.stringify({ ref: "surface:8" }))).toBe("surface:8");
  });

  it("parses nested surface objects", () => {
    expect(parseCmuxSurfaceRef(JSON.stringify({
      surface: { ref: "surface:9", id: "A5D0FBAD-F17E-458D-A1F8-7F947931DCF6" },
    }))).toBe("surface:9");
  });

  it("parses selected surface refs from pane-shaped output", () => {
    expect(parseCmuxSurfaceRef(JSON.stringify({
      pane: {
        ref: "pane:3",
        selected_surface_ref: "surface:10",
      },
    }))).toBe("surface:10");
  });
});
