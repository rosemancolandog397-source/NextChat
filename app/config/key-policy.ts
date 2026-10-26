export function serverOnlyApiKeys(env: {
  NODE_ENV?: string;
  BUILD_MODE?: string;
  BUILD_APP?: string;
  SERVER_ONLY_API_KEY?: string;
}): boolean {
  return (
    env.SERVER_ONLY_API_KEY === "1" ||
    (env.NODE_ENV === "production" &&
      env.BUILD_MODE !== "export" &&
      !env.BUILD_APP)
  );
}
