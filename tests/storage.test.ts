import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { assertSafeStorageKey, getStorage, resetStorageCache } from "@/services/storage";

describe("storage keys", () => {
  it("accepts tenant-prefixed relative keys", () => {
    expect(assertSafeStorageKey("biz_1/quotes/ECS-2026-000001.pdf")).toBe("biz_1/quotes/ECS-2026-000001.pdf");
  });

  it("rejects path traversal and empty keys", () => {
    expect(() => assertSafeStorageKey("../etc/passwd")).toThrow(/Invalid storage key/);
    expect(() => assertSafeStorageKey("a/../../b")).toThrow(/Invalid storage key/);
    expect(() => assertSafeStorageKey("")).toThrow(/Invalid storage key/);
    // Leading slashes are stripped so the object stays under the storage root.
    expect(assertSafeStorageKey("/tenant/logo.png")).toBe("tenant/logo.png");
  });
});

describe("local storage driver", () => {
  const previous = process.env.STORAGE_LOCAL_DIR;
  let dir = "";

  afterEach(async () => {
    resetStorageCache();
    if (previous === undefined) delete process.env.STORAGE_LOCAL_DIR;
    else process.env.STORAGE_LOCAL_DIR = previous;
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it("round-trips bytes and content type", async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "autoquote-storage-"));
    process.env.STORAGE_LOCAL_DIR = dir;
    resetStorageCache();
    const storage = getStorage();
    const payload = Buffer.from("%PDF-1.4 test");
    await storage.put("tenant-a/quotes/demo.pdf", payload, "application/pdf");
    const got = await storage.get("tenant-a/quotes/demo.pdf");
    expect(got).toBeTruthy();
    expect(got!.contentType).toBe("application/pdf");
    expect(got!.data.equals(payload)).toBe(true);
    expect(await storage.get("tenant-a/quotes/missing.pdf")).toBeNull();
  });
});
