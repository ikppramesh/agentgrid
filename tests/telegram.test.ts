import { describe, expect, it } from "vitest";
import { parseUpdate } from "@/channels/telegram";

describe("telegram adapter", () => {
  it("normalizes private text messages", () => {
    const e = parseUpdate({ update_id: 1, message: { message_id: 7, date: 1700000000, chat: { id: 42, type: "private" }, from: { id: 42, first_name: "Ravi" }, text: "hi" } });
    expect(e).toMatchObject({ externalUserId: "42", externalMessageId: "tg:42:7", text: "hi", displayName: "Ravi" });
  });
  it("ignores groups and non-text updates", () => {
    expect(parseUpdate({ update_id: 1, message: { message_id: 1, date: 1, chat: { id: -5, type: "group" }, text: "x" } })).toBeNull();
    expect(parseUpdate({ update_id: 1, message: { message_id: 1, date: 1, chat: { id: 5, type: "private" } } })).toBeNull();
    expect(parseUpdate({ nope: true })).toBeNull();
  });
});
