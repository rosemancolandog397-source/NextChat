/** @jest-environment node */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { parse } from "yaml";

const load = (name: string) =>
  parse(readFileSync(join(process.cwd(), ".github/workflows", name), "utf8"));
const deploy = load("deploy_preview.yml");
const cleanup = load("remove_deploy_preview.yml");
const deploymentSteps = deploy.jobs["deploy-preview"].steps;
const cleanupScript = cleanup.jobs["delete-deployments"].steps[0].with.script;
const validateScript = deploymentSteps[0].with.script;
const commentScript = deploymentSteps.at(-1).with.script;

function execute(script: string, bindings: Record<string, unknown>) {
  return runInNewContext(`(async () => { ${script}\n })()`, {
    URL,
    URLSearchParams,
    AbortSignal,
    ...bindings,
  });
}

test("deployment can only build the immutable trusted default-branch commit", () => {
  expect(Object.keys(deploy.on)).toEqual(["workflow_dispatch"]);
  expect(deploy.permissions).toEqual({});
  expect(deploy.jobs["deploy-preview"].if).toBe(
    "github.ref == format('refs/heads/{0}', github.event.repository.default_branch)",
  );
  const checkout = deploymentSteps.find(
    (step: { uses?: string }) => step.uses?.startsWith("actions/checkout@"),
  );
  expect(checkout.with).toEqual({
    ref: "${{ github.sha }}",
    "persist-credentials": false,
  });
  expect(
    deploymentSteps
      .filter((step: { env?: object }) =>
        JSON.stringify(step.env ?? {}).includes("secrets."),
      )
      .map((step: { id: string }) => step.id),
  ).toEqual(["deploy"]);
  expect(JSON.stringify(deploy)).not.toMatch(
    /pull_request\.head|refs\/pull|workflow_run/,
  );
});

test("cleanup processes metadata only, has no GitHub write permissions or checkout", () => {
  expect(cleanup.on).toEqual({ pull_request_target: { types: ["closed"] } });
  expect(cleanup.permissions).toEqual({});
  expect(cleanup.jobs["delete-deployments"].permissions).toEqual({});
  expect(cleanup.jobs["delete-deployments"].steps).toHaveLength(1);
  expect(cleanupScript).not.toMatch(
    /head\.ref|head_ref|child_process|exec\(|require\(/,
  );
  for (const workflow of [deploy, cleanup]) {
    for (const job of Object.values(workflow.jobs) as {
      steps: { uses?: string; run?: string; with?: { script?: string } }[];
    }[]) {
      for (const step of job.steps) {
        if (step.uses) expect(step.uses).toMatch(/@[a-f0-9]{40}$/);
        expect(step.run ?? "").not.toContain("${{");
        expect(step.with?.script ?? "").not.toContain("${{");
      }
    }
  }
});

test.each([
  "7;echo injected",
  "$(echo injected)",
  "07",
  "0",
  "-1",
  "1\n2",
  "9007199254740992",
])("manual PR input %s is rejected before any API call", async (value) => {
  let requests = 0;
  await expect(
    execute(validateScript, {
      process: { env: { PR_NUMBER: value } },
      github: {
        rest: {
          pulls: {
            get: () => {
              requests++;
            },
          },
        },
      },
    }),
  ).rejects.toThrow("positive PR number");
  expect(requests).toBe(0);
});

test("valid open PR is accepted; closed PR cannot start a deployment", async () => {
  const output: unknown[] = [];
  const bindings = {
    process: { env: { PR_NUMBER: "7" } },
    context: { repo: { owner: "owner", repo: "repo" } },
    core: { setOutput: (...values: unknown[]) => output.push(values) },
    github: {
      rest: { pulls: { get: async () => ({ data: { state: "open" } }) } },
    },
  };
  await execute(validateScript, bindings);
  expect(output).toEqual([["pr_number", "7"]]);
  bindings.github.rest.pulls.get = async () => ({ data: { state: "closed" } });
  await expect(execute(validateScript, bindings)).rejects.toThrow(
    "still be open",
  );
});

function cleanupBindings(pages: unknown[], deleteStatus = 200) {
  const calls: { url: URL; method: string; redirect: string }[] = [];
  let index = 0;
  const bindings = {
    process: {
      env: {
        VERCEL_TOKEN: "test-only",
        VERCEL_ORG_ID: "team",
        VERCEL_PROJECT_ID: "project",
      },
    },
    context: {
      repo: { owner: "owner", repo: "repo" },
      payload: {
        pull_request: {
          number: 7,
          head: { ref: 'zzz";echo${IFS}"injected";#' },
        },
      },
    },
    core: { notice: () => undefined, info: () => undefined },
    fetch: async (url: URL, options: { method: string; redirect: string }) => {
      calls.push({ url, method: options.method, redirect: options.redirect });
      const status = options.method === "DELETE" ? deleteStatus : 200;
      return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => pages[index++],
      };
    },
  };
  return { bindings, calls };
}
const matchingMeta = {
  preview_repository: "owner/repo",
  preview_pr: "7",
  preview_source: "trusted-default-branch",
};

test("hostile branch names are inert and only exact matching previews are deleted", async () => {
  const { bindings, calls } = cleanupBindings([
    {
      deployments: [
        { uid: "dpl_owned", meta: matchingMeta, target: null },
        { uid: "dpl_production", meta: matchingMeta, target: "production" },
        { uid: "dpl_staging", meta: matchingMeta, target: "staging" },
        { uid: "dpl_otherpr", meta: { ...matchingMeta, preview_pr: "70" } },
        {
          uid: "dpl_otherrepo",
          meta: { ...matchingMeta, preview_repository: "other/repo" },
        },
        { uid: "dpl_legacy", meta: { base_hash: "old-branch-hash" } },
      ],
      pagination: { next: null },
    },
  ]);
  await execute(cleanupScript, bindings);
  expect(
    calls
      .filter((call) => call.method === "DELETE")
      .map((call) => call.url.pathname),
  ).toEqual(["/v13/deployments/dpl_owned"]);
  expect(
    calls.every(
      (call) =>
        call.url.origin === "https://api.vercel.com" &&
        call.redirect === "error",
    ),
  ).toBe(true);
  expect(calls[0].url.searchParams.get("projectId")).toBe("project");
});

test("cleanup follows pagination and treats already removed deployments as harmless", async () => {
  const { bindings, calls } = cleanupBindings(
    [
      { deployments: [], pagination: { next: 100 } },
      {
        deployments: [{ uid: "dpl_owned", meta: matchingMeta }],
        pagination: { next: null },
      },
    ],
    404,
  );
  await execute(cleanupScript, bindings);
  expect(calls[1].url.searchParams.get("until")).toBe("100");
  expect(calls.filter((call) => call.method === "DELETE")).toHaveLength(1);
});

test("missing credentials skip cleanup without network calls", async () => {
  const { bindings, calls } = cleanupBindings([]);
  bindings.process.env.VERCEL_TOKEN = "";
  await execute(cleanupScript, bindings);
  expect(calls).toHaveLength(0);
});

test("cleanup never logs a failed API response body or credential", async () => {
  const { bindings } = cleanupBindings([]);
  bindings.fetch = async () => ({
    ok: false,
    status: 403,
    json: async () => {
      throw new Error("Provider body must not be read");
    },
  });
  await expect(execute(cleanupScript, bindings)).rejects.toThrow(
    "Vercel API HTTP 403",
  );
});

test("repeated pagination cursors stop cleanup instead of looping", async () => {
  const { bindings } = cleanupBindings([
    { deployments: [], pagination: { next: 100 } },
    { deployments: [], pagination: { next: 100 } },
  ]);
  await expect(execute(cleanupScript, bindings)).rejects.toThrow("pagination");
});

test.each([
  { deployments: [{ uid: "../escape", meta: matchingMeta }] },
  { deployments: [], pagination: { next: "bad-cursor" } },
  { error: "unexpected-format" },
])("malformed API data fails closed", async (page) => {
  const { bindings, calls } = cleanupBindings([page]);
  await expect(execute(cleanupScript, bindings)).rejects.toThrow();
  expect(calls.filter((call) => call.method === "DELETE")).toHaveLength(0);
});

test("deployment comments cannot accept injected or non-Vercel links", async () => {
  for (const url of [
    "javascript:alert(1)",
    "https://example.com",
    "https://demo.vercel.app\nextra",
  ]) {
    await expect(
      execute(commentScript, {
        process: { env: { RUNNER_TEMP: "/tmp", PR_NUMBER: "7" } },
        require: (name: string) =>
          name === "node:fs"
            ? { readFileSync: () => url }
            : { join: () => "/tmp/url" },
      }),
    ).rejects.toThrow("Unexpected preview URL");
  }
});

test("successful comment identifies the trusted source instead of implying a PR build", async () => {
  const comments: { issue_number: number; body: string }[] = [];
  await execute(commentScript, {
    process: { env: { RUNNER_TEMP: "/tmp", PR_NUMBER: "7" } },
    context: { repo: { owner: "owner", repo: "repo" }, sha: "trusted-source" },
    require: (name: string) =>
      name === "node:fs"
        ? { readFileSync: () => "https://demo.vercel.app\n" }
        : { join: () => "/tmp/url" },
    github: {
      rest: {
        issues: {
          createComment: async (comment: {
            issue_number: number;
            body: string;
          }) => comments.push(comment),
        },
      },
    },
  });
  expect(comments[0].issue_number).toBe(7);
  expect(comments[0].body).toContain("不是本 PR 代码的构建");
  expect(comments[0].body).toContain("trusted-source");
});
