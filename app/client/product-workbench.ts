import { getClientApi } from "./api";
import { ChatGPTApi } from "./platforms/openai";
import { OpenaiPath, ServiceProvider } from "../constant";
import { useAccessStore } from "../store";
import { getClientConfig } from "../config/client";

// Only adjust the resource path on a fresh workbench client. Authentication,
// payload construction, gateway handling and all other providers stay upstream.
export function workbenchResourcePath(base: string, resource: string): string {
  if (resource !== OpenaiPath.ChatPath) return resource;
  const endpoint = base.trim().replace(/\/+$/, "");
  if (/\/v1$/i.test(endpoint)) return "chat/completions";
  return resource;
}

class WorkbenchOpenAI extends ChatGPTApi {
  path(resource: string): string {
    if (getClientConfig()?.byokMode) return super.path(resource);
    const { useCustomConfig, openaiUrl, serverOnlyApiKey } =
      useAccessStore.getState();
    return super.path(
      workbenchResourcePath(
        useCustomConfig &&
          !serverOnlyApiKey &&
          !getClientConfig()?.serverOnlyApiKey
          ? openaiUrl
          : "",
        resource,
      ),
    );
  }
}

export function getWorkbenchClientApi(provider: ServiceProvider) {
  const client = getClientApi(provider);
  if (provider !== ServiceProvider.Azure && client.llm instanceof ChatGPTApi) {
    client.llm = new WorkbenchOpenAI();
  }
  return client;
}
