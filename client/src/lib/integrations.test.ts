import { describe, it, expect } from "vitest";
import { getIntegrationInfo, INTEGRATION_FEATURES } from "./integrations";

describe("Third-Party Integration metadata", () => {
  describe("getIntegrationInfo", () => {
    it("should get GitHub integration info", () => {
      const info = getIntegrationInfo("github");

      expect(info.title).toBe("GitHub");
      expect(info.description).toBeDefined();
      expect(info.icon).toBe("🐙");
      expect(info.scope.length).toBeGreaterThan(0);
    });

    it("should get Notion integration info", () => {
      const info = getIntegrationInfo("notion");

      expect(info.title).toBe("Notion");
      expect(info.icon).toBe("📝");
    });

    it("should get Slack integration info", () => {
      const info = getIntegrationInfo("slack");

      expect(info.title).toBe("Slack");
      expect(info.icon).toBe("💬");
    });

    it("should get cloud storage integration info", () => {
      const gdrive = getIntegrationInfo("google-drive");
      const dropbox = getIntegrationInfo("dropbox");
      const onedrive = getIntegrationInfo("onedrive");

      expect(gdrive.title).toBe("Google Drive");
      expect(dropbox.title).toBe("Dropbox");
      expect(onedrive.title).toBe("OneDrive");
    });
  });

  describe("INTEGRATION_FEATURES", () => {
    it("maps integration types to their capability lists", () => {
      expect(INTEGRATION_FEATURES.github).toContain("neural-map");
      expect(INTEGRATION_FEATURES.gmail).toContain("agent-networking");
      expect(INTEGRATION_FEATURES.generic).toEqual(["chat"]);
    });
  });
});
