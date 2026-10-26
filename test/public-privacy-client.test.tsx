import React from "react";
import { jest } from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
let publicMode = true;
const download = jest.fn();
const readFile = jest.fn();
const getState = jest.fn(() => ({
  access: { apiKey: "fixture-old-browser-key" },
}));
const setState = jest.fn();
const createClient = jest.fn();

jest.unstable_mockModule("@/app/config/client", () => ({
  getClientConfig: () => ({ serverOnlyApiKey: publicMode }),
}));
jest.unstable_mockModule("@/app/utils/store", () => ({
  createPersistStore(defaults: any, methods: any) {
    let state: any;
    const set = (patch: any) => {
      state = {
        ...state,
        ...(typeof patch === "function" ? patch(state) : patch),
      };
    };
    state = { ...defaults, ...methods(set, () => state) };
    return { getState: () => state };
  },
}));
jest.unstable_mockModule("@/app/utils/sync", () => ({
  getLocalAppState: getState,
  setLocalAppState: setState,
  mergeAppState: jest.fn(),
}));
jest.unstable_mockModule("@/app/utils", () => ({
  downloadAs: download,
  readFromFile: readFile,
}));
jest.unstable_mockModule("@/app/utils/cloud", () => ({
  ProviderType: { WebDAV: "webdav", UpStash: "upstash" },
  createSyncClient: createClient,
}));
jest.unstable_mockModule("@/app/components/ui-lib", () => ({
  showToast: jest.fn(),
}));
jest.unstable_mockModule("@/app/locales", () => ({
  default: { Settings: { Sync: { ImportFailed: "fixture" } } },
}));
const { useSyncStore } = await import("../app/store/sync");
const { LocalDataNotice } = await import("../app/components/local-data-notice");
const sync = useSyncStore.getState();

beforeEach(() => {
  publicMode = true;
  for (const mock of [download, readFile, getState, setState, createClient])
    mock.mockClear();
});
afterEach(cleanup);

test("direct backup/sync method calls are blocked before reading credentials or modifying data", async () => {
  const before = JSON.stringify(sync);
  expect(sync.cloudSync()).toBe(false);
  expect(() => sync.export()).toThrow("公开版本");
  await expect(sync.import()).rejects.toThrow("公开版本");
  await expect(sync.sync()).rejects.toThrow("公开版本");
  await expect(sync.check()).rejects.toThrow("公开版本");
  expect(() => sync.getClient()).toThrow("公开版本");
  expect(getState).not.toHaveBeenCalled();
  expect(setState).not.toHaveBeenCalled();
  expect(createClient).not.toHaveBeenCalled();
  expect(download).not.toHaveBeenCalled();
  expect(readFile).not.toHaveBeenCalled();
  expect(JSON.stringify(sync)).toBe(before);
});

test("local data notice explains loss, shared-browser visibility and cloud restrictions", () => {
  render(<LocalDataNotice />);
  const notice = screen.getByRole("note", { name: "本地数据与隐私提示" });
  expect(notice).toHaveTextContent("清理浏览器数据可能导致丢失");
  expect(notice).toHaveTextContent("共用浏览器可能看到已有内容");
  expect(notice).toHaveTextContent("不提供账号、云同步或公开分享");
});

test("private mode keeps its existing backup behavior without touching real browser data", () => {
  publicMode = false;
  sync.export();
  expect(download).toHaveBeenCalledTimes(1);
});
