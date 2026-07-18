/**
 * Unit tests for the SAF base64 file-export helper.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const requestDirectoryPermissionsAsync = vi.fn();
const createFileAsync = vi.fn();
const writeAsStringAsync = vi.fn();
let osValue = "android";

vi.mock("react-native", () => ({ Platform: { get OS() { return osValue; } } }));
vi.mock("expo-file-system/legacy", () => ({
  StorageAccessFramework: {
    requestDirectoryPermissionsAsync: (...a: unknown[]) => requestDirectoryPermissionsAsync(...a),
    createFileAsync: (...a: unknown[]) => createFileAsync(...a),
  },
  writeAsStringAsync: (...a: unknown[]) => writeAsStringAsync(...a),
  EncodingType: { Base64: "base64" },
}));

import { saveBase64File } from "./file-export";

describe("saveBase64File", () => {
  beforeEach(() => { vi.clearAllMocks(); osValue = "android"; });

  it("writes the file after a granted folder and returns its uri", async () => {
    requestDirectoryPermissionsAsync.mockResolvedValue({ granted: true, directoryUri: "content://tree/Downloads" });
    createFileAsync.mockResolvedValue("content://tree/Downloads/coding.obp");
    writeAsStringAsync.mockResolvedValue(undefined);

    const res = await saveBase64File("QUJD", "coding.obp", "application/octet-stream");
    expect(res).toEqual({ ok: true, uri: "content://tree/Downloads/coding.obp" });
    expect(createFileAsync).toHaveBeenCalledWith("content://tree/Downloads", "coding.obp", "application/octet-stream");
    expect(writeAsStringAsync).toHaveBeenCalledWith("content://tree/Downloads/coding.obp", "QUJD", { encoding: "base64" });
  });

  it("returns cancelled when the user declines the folder grant", async () => {
    requestDirectoryPermissionsAsync.mockResolvedValue({ granted: false });
    const res = await saveBase64File("QUJD", "x.pdf", "application/pdf");
    expect(res).toEqual({ ok: false, reason: "cancelled" });
    expect(createFileAsync).not.toHaveBeenCalled();
  });

  it("returns error when a write throws", async () => {
    requestDirectoryPermissionsAsync.mockResolvedValue({ granted: true, directoryUri: "content://tree/x" });
    createFileAsync.mockResolvedValue("content://tree/x/y.pdf");
    writeAsStringAsync.mockRejectedValue(new Error("disk full"));
    const res = await saveBase64File("QUJD", "y.pdf", "application/pdf");
    expect(res).toEqual({ ok: false, reason: "error", message: "disk full" });
  });

  it("is unsupported off Android", async () => {
    osValue = "ios";
    const res = await saveBase64File("QUJD", "x.obp", "application/octet-stream");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("unsupported");
    expect(requestDirectoryPermissionsAsync).not.toHaveBeenCalled();
  });
});
