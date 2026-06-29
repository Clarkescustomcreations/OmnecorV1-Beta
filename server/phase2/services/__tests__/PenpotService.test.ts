import { describe, it, expect } from "vitest";
import { PenpotService } from "../PenpotService.js";

describe("PenpotService.generateComponent — path-traversal guard", () => {
  const svc = PenpotService.getInstance();

  it("rejects a traversal sequence in the component name before any I/O", async () => {
    await expect(
      svc.generateComponent("file-1", "node-1", "../../../../etc/cron.d/x"),
    ).rejects.toThrow(/Invalid component name/);
  });

  it("rejects a component name with path separators", async () => {
    await expect(
      svc.generateComponent("file-1", "node-1", "foo/bar"),
    ).rejects.toThrow(/Invalid component name/);
  });

  it("rejects a component name that is not a valid identifier", async () => {
    await expect(
      svc.generateComponent("file-1", "node-1", "1Bad-Name"),
    ).rejects.toThrow(/Invalid component name/);
  });
});
