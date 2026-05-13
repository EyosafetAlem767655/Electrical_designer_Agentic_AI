import { describe, expect, it } from "vitest";
import { isProjectNameMatch, parseFloorNames, parsePositiveInteger } from "@/lib/state-machine";

describe("state machine helpers", () => {
  it("matches project names case-insensitively with minor punctuation differences", () => {
    expect(isProjectNameMatch("Nova Heights", "nova-heights")).toBe(true);
    expect(isProjectNameMatch("Nova Hieghts", "Nova Heights")).toBe(true);
    expect(isProjectNameMatch("Other Project", "Nova Heights")).toBe(false);
  });

  it("parses floor names in bottom-to-top order", () => {
    const result = parseFloorNames("Basement\nGround Floor\nRooftop", 3);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.names).toEqual(["Basement", "Ground Floor", "Rooftop"]);
    }
  });

  it("rejects unexpected floor-name counts", () => {
    expect(parseFloorNames("Basement\nGround", 3).ok).toBe(false);
  });

  it("parses bounded positive integers", () => {
    expect(parsePositiveInteger("8 floors")).toBe(8);
    expect(parsePositiveInteger("0")).toBe(null);
  });
});
