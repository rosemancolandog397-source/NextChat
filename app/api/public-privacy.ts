import { NextResponse } from "next/server";
import { byokMode, serverOnlyApiKeys } from "../config/key-policy";
import { PUBLIC_CLOUD_DISABLED } from "../config/public-privacy";

export function publicDataAccessBlocked() {
  if (!byokMode() && !serverOnlyApiKeys(process.env)) return null;
  return NextResponse.json(
    { error: { code: "PUBLIC_DATA_DISABLED", message: PUBLIC_CLOUD_DISABLED } },
    { status: 403, headers: { "Cache-Control": "no-store" } },
  );
}
