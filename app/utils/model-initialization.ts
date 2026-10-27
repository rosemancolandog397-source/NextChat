import { getClientConfig } from "../config/client";
import { ServiceProvider } from "../constant";

type PublicModelPolicy = {
  byokMode?: boolean;
  serverOnlyApiKey?: boolean;
  publicDefaultModel?: string;
};

type ModelSelection = {
  model: string;
  providerName: string;
  compressModel?: string;
  compressProviderName?: string;
};

function publicModel(policy: PublicModelPolicy) {
  const model = policy.publicDefaultModel || "";
  // Missing/malformed public configuration must never fall back to GPT.
  return /^deepseek\/[a-zA-Z0-9][a-zA-Z0-9._-]{0,120}$/.test(model)
    ? model
    : "";
}

export function normalizeModelSelection<T extends ModelSelection>(
  value: T,
  policy: PublicModelPolicy = getClientConfig() ?? {},
): T {
  if (!policy.serverOnlyApiKey && !policy.byokMode) return value;
  const model = publicModel(policy);
  return {
    ...value,
    model,
    providerName: ServiceProvider.OpenAI,
    compressModel: model,
    compressProviderName: ServiceProvider.OpenAI,
  };
}

export function publicModelAccessConfig(
  policy: PublicModelPolicy = getClientConfig() ?? {},
): Partial<{
  byokMode: boolean; serverOnlyApiKey: boolean; hideUserApiKey: boolean;
  disableFastLink: boolean; defaultModel: string; customModels: string;
  provider: ServiceProvider; useCustomConfig: boolean; needCode: boolean;
}> {
  if (!policy.serverOnlyApiKey && !policy.byokMode) return {};
  const model = publicModel(policy);
  return {
    ...(policy.byokMode ? { byokMode: true } : {}),
    serverOnlyApiKey: !policy.byokMode,
    hideUserApiKey: !policy.byokMode,
    ...(policy.byokMode ? { provider: ServiceProvider.OpenAI, useCustomConfig: true, needCode: false } : {}),
    disableFastLink: true,
    defaultModel: model ? `${model}@OpenAI` : "",
    customModels: model ? `-all,+${model}@OpenAI` : "-all",
  };
}
