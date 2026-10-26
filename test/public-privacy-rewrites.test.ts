/** @jest-environment node */
import { execFileSync } from "node:child_process";

test.each(["0", "1"])(
  "production cannot enable ShareGPT rewrites with SERVER_ONLY_API_KEY=%s",
  (flag) => {
    const script = `const {default: config} = await import('./next.config.mjs'); console.log(JSON.stringify((await config.rewrites()).beforeFiles.map(r => r.source)));`;
    const output = execFileSync(
      process.execPath,
      ["--input-type=module", "-e", script],
      {
        cwd: process.cwd(),
        env: {
          PATH: process.env.PATH,
          NODE_ENV: "production",
          BUILD_MODE: "standalone",
          SERVER_ONLY_API_KEY: flag,
        },
        encoding: "utf8",
      },
    );
    const rewrites = JSON.parse(output.trim().split("\n").at(-1)!);
    expect(rewrites).not.toContain("/sharegpt");
  },
);
