// Public builds default to BYOK, even if obsolete shared keys remain in env.
// BYOK_MODE=0 is retained only for explicit legacy/private deployments.
export function byokMode(env: Record<string, string | undefined> = process.env): boolean {
  return env.BYOK_MODE !== "0";
}

export function serverOnlyApiKeys(env: {
  BYOK_MODE?: string;
  NODE_ENV?: string;
  BUILD_MODE?: string;
  BUILD_APP?: string;
  SERVER_ONLY_API_KEY?: string;
}): boolean {
  if (byokMode(env)) return false;
  return (
    env.SERVER_ONLY_API_KEY === "1" ||
    (env.NODE_ENV === "production" &&
      env.BUILD_MODE !== "export" &&
      !env.BUILD_APP)
  );
}
