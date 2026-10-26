// Keep versioned custom chat endpoints from receiving a second /v1 prefix.
export function openAIResourcePath(base: string, resource: string): string {
  return /\/v1\/?$/i.test(base) && resource === "v1/chat/completions"
    ? "chat/completions"
    : resource;
}
