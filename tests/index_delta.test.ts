import { describe, it, expect } from "vitest";
import { indexDeltaReadout } from "../src/index_delta";

describe("indexDeltaReadout", () => {
  it("zeigt embedded/total mit de-DE-Tausendertrennung", () => {
    expect(indexDeltaReadout(980, 1000)).toBe("980 / 1.000 Notizen");
  });
  it("markiert Vollständigkeit bei embedded === total", () => {
    expect(indexDeltaReadout(1000, 1000)).toBe("1.000 / 1.000 Notizen (vollständig)");
  });
  it("behandelt total = 0", () => {
    expect(indexDeltaReadout(0, 0)).toBe("0 / 0 Notizen (vollständig)");
  });
});
