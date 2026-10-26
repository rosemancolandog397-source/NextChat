import { NextResponse } from "next/server";
import { publicDataAccessBlocked } from "../api/public-privacy";

function handle() {
  return (
    publicDataAccessBlocked() ??
    NextResponse.json({ error: "not found" }, { status: 404 })
  );
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
export const HEAD = handle;
export const OPTIONS = handle;
