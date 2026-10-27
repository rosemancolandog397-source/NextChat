import { type OpenAIListModelResponse } from "@/app/client/platforms/openai";
import { getServerSideConfig } from "@/app/config/server";
import { ModelProvider, OpenaiPath } from "@/app/constant";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "./auth";
import { requestOpenai } from "./common";
import { AiCostError, aiCostResponse } from "./ai-cost-guard";
import { allowedAiModel } from "../config/ai-cost-policy";

const ALLOWED_PATH = new Set(Object.values(OpenaiPath));

function getModels(remoteModelRes: OpenAIListModelResponse) {
  const config = getServerSideConfig();

  if (config.disableGPT4) {
    remoteModelRes.data = remoteModelRes.data.filter(
      (m) =>
        !(
          m.id.startsWith("gpt-4") ||
          m.id.startsWith("chatgpt-4o") ||
          m.id.startsWith("o1") ||
          m.id.startsWith("o3")
        ) || m.id.startsWith("gpt-4o-mini"),
    );
  }

  return remoteModelRes;
}

export async function handle(
  req: NextRequest,
  { params }: { params: { path: string[] } },
) {
  if (req.method === "OPTIONS") {
    return NextResponse.json({ body: "OK" }, { status: 200 });
  }

  const subpath = params.path.join("/");

  if (!ALLOWED_PATH.has(subpath)) {
    return NextResponse.json(
      {
        error: true,
        msg: "you are not allowed to request " + subpath,
      },
      {
        status: 403,
      },
    );
  }

  const authResult = auth(req, ModelProvider.GPT);
  if (authResult.error) {
    return NextResponse.json(authResult, {
      status: 401,
    });
  }

  if (getServerSideConfig().serverOnlyApiKey || getServerSideConfig().byokMode) {
    if (subpath === OpenaiPath.ListModelPath && req.method === "GET") {
      const model = allowedAiModel(process.env);
      return NextResponse.json({
        object: "list",
        data: model ? [{ id: model, object: "model" }] : [],
      });
    }
    if (subpath !== OpenaiPath.ChatPath || req.method !== "POST") {
      return aiCostResponse(new AiCostError("AI_ENDPOINT_DENIED", 403));
    }
  }

  try {
    const response = await requestOpenai(req);

    // list models
    if (subpath === OpenaiPath.ListModelPath && response.status === 200) {
      const resJson = (await response.json()) as OpenAIListModelResponse;
      const availableModels = getModels(resJson);
      return NextResponse.json(availableModels, {
        status: response.status,
      });
    }

    return response;
  } catch (e) {
    return NextResponse.json(
      { error: true, message: "Upstream request failed" },
      { status: 502 },
    );
  }
}
