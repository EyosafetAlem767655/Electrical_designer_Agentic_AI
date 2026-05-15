import { describe, expect, it } from "vitest";
import { parseTelegramGroupInput } from "@/lib/utils";
import { isPersonNameMatch, isProjectNameMatch, parseBindCommand, parseFloorNames, parsePositiveInteger, parseVerificationDetails } from "@/lib/state-machine";

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

  it("parses Telegram bind commands from groups", () => {
    expect(parseBindCommand("/bind NOVA1234")).toBe("NOVA1234");
    expect(parseBindCommand("/bind@awolaibot nova_123")).toBe("NOVA_123");
    expect(parseBindCommand("/start")).toBe(null);
  });

  it("parses architect verification details", () => {
    expect(parseVerificationDetails("Full name: Amanuel Tesfaye\nProject: Nova Heights")).toEqual({
      fullName: "Amanuel Tesfaye",
      projectName: "Nova Heights"
    });
    expect(parseVerificationDetails("Amanuel Tesfaye\nNova Heights")).toEqual({
      fullName: "Amanuel Tesfaye",
      projectName: "Nova Heights"
    });
    expect(isPersonNameMatch("Amanuel Tsefaye", "Amanuel Tesfaye")).toBe(true);
  });

  it("accepts invite links as metadata without treating them as chat IDs", () => {
    expect(parseTelegramGroupInput("https://t.me/+QOZbcLvBzdVjNGQ0")).toEqual({
      chatId: null,
      inviteLink: "https://t.me/+QOZbcLvBzdVjNGQ0"
    });
    expect(parseTelegramGroupInput("-1001234567890")).toEqual({ chatId: -1001234567890, inviteLink: null });
    expect(() => parseTelegramGroupInput("not-a-chat-id")).toThrow(/numeric/);
  });
});
