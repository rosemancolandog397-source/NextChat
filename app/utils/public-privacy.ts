import { getClientConfig } from "../config/client";
import { PUBLIC_CLOUD_DISABLED } from "../config/public-privacy";

export function isPublicPrivacyMode() {
  return !!(getClientConfig()?.byokMode || getClientConfig()?.serverOnlyApiKey);
}

export function assertPrivateDataFeatures() {
  if (isPublicPrivacyMode()) throw new Error(PUBLIC_CLOUD_DISABLED);
}
