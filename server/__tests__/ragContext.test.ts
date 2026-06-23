import { describe, it, expect } from "vitest";
import { injectMapRagContext } from "../_core/ragContext.js";

// The read-side guard: a chat that is NOT anchored to a map (no ragMapId, or no
// authenticated user) must pass through completely untouched — no DB hit, no
// injected system context — so ordinary chat behaviour is never altered.
describe("injectMapRagContext — passthrough guards", () => {
  const messages = [
    { role: "system", content: "You are helpful." },
    { role: "user", content: "hi" },
  ];

  it("returns the inputs unchanged when no mapId is given", async () => {
    const res = await injectMapRagContext({ userId: 1, messages, systemPrompt: "S" });
    expect(res.injected).toBe(false);
    expect(res.messages).toBe(messages); // same reference — untouched
    expect(res.systemPrompt).toBe("S");
  });

  it("returns the inputs unchanged when there is no authenticated user", async () => {
    const res = await injectMapRagContext({ mapId: "some-map", userId: null, messages });
    expect(res.injected).toBe(false);
    expect(res.messages).toBe(messages);
  });
});
