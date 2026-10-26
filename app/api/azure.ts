import { ModelProvider } from "@/app/constant";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "./auth";
import { requestOpenai } from "./common";

export async function handle(
  req: NextRequest,
  { params }: { params: { path: string[] } },
) {

  if (req.method === "OPTIONS") {
    return NextResponse.json({ body: "OK" }, { status: 200 });
  }

  const subpath = params.path.join("/");

  const authResult = auth(req, ModelProvider.GPT);
  if (authResult.error) {
    return NextResponse.json(authResult, {
      status: 401,
    });
  }

  try {
    return await requestOpenai(req);
  } catch (e) {

    return NextResponse.json({ error: true, message: "Upstream request failed" }, { status: 502 });
  }
}
