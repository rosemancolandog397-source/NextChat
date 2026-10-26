/** @jest-environment node */
import { jest } from "@jest/globals";
import { NextRequest } from "next/server";
import fs from "node:fs/promises";
import { getServerSideConfig } from "../app/config/server";

const originalEnv = { ...process.env };
const artifacts = await import("../app/api/artifacts/route");
const upstash = await import("../app/api/upstash/[action]/[...key]/route");
const webdav = await import("../app/api/webdav/[...path]/route");
const share = await import("../app/sharegpt/route");
const mcp = await import("../app/mcp/actions");
beforeEach(() => {
  Object.assign(process.env, {
    SERVER_ONLY_API_KEY: "1",
    CODE: "fixture-access-code",
    ENABLE_MCP: "true",
    CLOUDFLARE_KV_API_KEY: "fixture-cloud-key",
  });
  jest.mocked(fetch).mockReset();
  jest
    .spyOn(globalThis, "fetch")
    .mockRejectedValue(new Error("external access is forbidden in this test"));
});
afterEach(() => {
  jest.restoreAllMocks();
});
afterAll(() => {
  process.env = originalEnv;
});

async function blocked(res: Response) {
  expect(res.status).toBe(403);
  expect(res.headers.get("cache-control")).toBe("no-store");
  const text = await res.text();
  expect(text).toContain("PUBLIC_DATA_DISABLED");
  expect(text).not.toContain("fixture-cloud-key");
  expect(fetch).not.toHaveBeenCalled();
}

test.each(["GET", "POST"] as const)(
  "Artifacts %s rejects anonymous reads/writes, even with configured storage",
  async (method) => {
    await blocked(
      await artifacts[method](
        new NextRequest("http://localhost/api/artifacts?id=fixture-id", {
          method,
          ...(method === "POST" ? { body: "fixture private document" } : {}),
        }),
      ),
    );
  },
);

test("an access code or forged owner cannot enable public sharing", async () => {
  await blocked(
    await artifacts.POST(
      new NextRequest("http://localhost/api/artifacts?owner=fixture-user", {
        method: "POST",
        headers: {
          Authorization: "Bearer ak-fixture-access-code",
          "x-user-id": "fixture-user",
        },
        body: "fixture document",
      }),
    ),
  );
});

test.each(["GET", "POST", "OPTIONS"] as const)(
  "Upstash %s rejects sync before reading endpoint or forwarding credentials",
  async (method) => {
    await blocked(
      await upstash[method](
        new NextRequest(
          "http://localhost/api/upstash/set/key?endpoint=https://fixture.upstash.io",
          { method, headers: { Authorization: "Bearer fixture-sync-token" } },
        ),
        {
          params: Promise.resolve({ action: "set", key: ["key"] }),
        },
      ),
    );
  },
);

test.each(["GET", "PUT", "OPTIONS"] as const)(
  "WebDAV %s rejects reads/writes before endpoint authorization",
  async (method) => {
    await blocked(
      await webdav[method](
        new NextRequest(
          "http://localhost/api/webdav/backup.json?endpoint=https://example.invalid",
          { method },
        ),
        { params: Promise.resolve({ path: ["backup.json"] }) },
      ),
    );
  },
);

test.each([
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
] as const)("ShareGPT %s is a blocked server route", async (method) => {
  await blocked(share[method]());
});

test("public mode disables MCP configuration and tool access even when enabled in env", async () => {
  const read = jest.spyOn(fs, "readFile").mockImplementation(async () => {
    throw new Error("file access is forbidden");
  });
  const write = jest.spyOn(fs, "writeFile").mockImplementation(async () => {
    throw new Error("file writes are forbidden");
  });
  expect(await mcp.isMcpEnabled()).toBe(false);
  expect(getServerSideConfig().enableMcp).toBe(false);
  await expect(mcp.getMcpConfigFromFile("fixture-access-code")).rejects.toThrow(
    "MCP is not enabled",
  );
  await expect(mcp.initializeMcpSystem("fixture-access-code")).rejects.toThrow(
    "MCP is not enabled",
  );
  expect(read).not.toHaveBeenCalled();
  expect(write).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
});
