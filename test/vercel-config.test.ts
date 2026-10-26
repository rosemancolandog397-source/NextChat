/** @jest-environment node */
import { readFileSync } from "node:fs";

const config = JSON.parse(readFileSync("vercel.json", "utf8"));
const pkg = JSON.parse(readFileSync("package.json", "utf8"));

test("Git pushes cannot automatically deploy an unapproved release", () => {
  expect(config.git.deploymentEnabled).toBe(false);
});

test("Vercel installs the pinned Yarn lockfile with build dependencies", () => {
  expect(pkg.packageManager).toBe("yarn@1.22.19");
  expect(pkg.engines.node).toBe("24.x");
  expect(config.installCommand).toContain("--frozen-lockfile");
  expect(config.installCommand).toContain("--production=false");
  expect(config.framework).toBe("nextjs");
  expect(config.fluid).toBe(true);
});
