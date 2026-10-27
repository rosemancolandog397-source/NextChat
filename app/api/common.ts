import { NextRequest, NextResponse } from "next/server";
import { getServerSideConfig } from "../config/server";
import { OPENAI_BASE_URL, ServiceProvider } from "../constant";
import { cloudflareAIGatewayUrl } from "../utils/cloudflare";
import { getModelProvider, isModelNotavailableInServer } from "../utils/model";
import { openAIResourcePath } from "../client/openai-path";
import { AiCostError, aiCostResponse, prepareAiRequest } from "./ai-cost-guard";
import { credentialSafeResponse } from "./credential-response";
import { fetchModelResponse, ModelDeadlineError } from "./model-deadline";

const serverConfig = getServerSideConfig();

export async function requestOpenai(req: NextRequest) {
  let protectedBody: string | undefined;
  if (serverConfig.serverOnlyApiKey) {
    if (
      req.method !== "POST" ||
      req.nextUrl.pathname !== "/api/openai/v1/chat/completions"
    ) {
      return aiCostResponse(new AiCostError("AI_ENDPOINT_DENIED", 403));
    }
    try {
      protectedBody = await prepareAiRequest(req);
    } catch (error) {
      return aiCostResponse(
        error instanceof AiCostError
          ? error
          : new AiCostError("AI_BUDGET_UNAVAILABLE", 503),
      );
    }
  }
  const controller = new AbortController();

  const isAzure = req.nextUrl.pathname.includes("azure/deployments");

  var authValue,
    authHeaderName = "";
  if (isAzure) {
    authValue =
      req.headers
        .get("Authorization")
        ?.trim()
        .replaceAll("Bearer ", "")
        .trim() ?? "";

    authHeaderName = "api-key";
  } else {
    authValue = req.headers.get("Authorization") ?? "";
    authHeaderName = "Authorization";
  }

  let path = `${req.nextUrl.pathname}`.replaceAll("/api/openai/", "");

  let baseUrl =
    (isAzure ? serverConfig.azureUrl : serverConfig.baseUrl) || OPENAI_BASE_URL;

  if (!baseUrl.startsWith("http")) {
    baseUrl = `https://${baseUrl}`;
  }

  if (baseUrl.endsWith("/")) {
    baseUrl = baseUrl.slice(0, -1);
  }

  const timeoutId = setTimeout(
    () => {
      controller.abort();
    },
    10 * 60 * 1000,
  );

  if (isAzure) {
    const azureApiVersion =
      req?.nextUrl?.searchParams?.get("api-version") ||
      serverConfig.azureApiVersion;
    baseUrl = baseUrl.split("/deployments").shift() as string;
    path = `${req.nextUrl.pathname.replaceAll(
      "/api/azure/",
      "",
    )}?api-version=${azureApiVersion}`;

    // Forward compatibility:
    // if display_name(deployment_name) not set, and '{deploy-id}' in AZURE_URL
    // then using default '{deploy-id}'
    if (serverConfig.customModels && serverConfig.azureUrl) {
      const modelName = path.split("/")[1];
      let realDeployName = "";
      serverConfig.customModels
        .split(",")
        .filter((v) => !!v && !v.startsWith("-") && v.includes(modelName))
        .forEach((m) => {
          const [fullName, displayName] = m.split("=");
          const [_, providerName] = getModelProvider(fullName);
          if (providerName === "azure" && !displayName) {
            const [_, deployId] = (serverConfig?.azureUrl ?? "").split(
              "deployments/",
            );
            if (deployId) {
              realDeployName = deployId;
            }
          }
        });
      if (realDeployName) {
        path = path.replaceAll(modelName, realDeployName);
      }
    }
  }

  const fetchUrl = cloudflareAIGatewayUrl(
    `${baseUrl}/${isAzure ? path : openAIResourcePath(baseUrl, path)}`,
  );

  const fetchOptions: RequestInit = {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      [authHeaderName]: authValue,
      ...(serverConfig.openaiOrgId && {
        "OpenAI-Organization": serverConfig.openaiOrgId,
      }),
    },
    method: req.method,
    body: protectedBody ?? req.body,
    // to fix #2485: https://stackoverflow.com/questions/55920957/cloudflare-worker-typeerror-one-time-use-body
    redirect: "manual",
    // @ts-ignore
    duplex: "half",
    signal: controller.signal,
  };

  // #1815 try to refuse gpt4 request
  if (!serverConfig.serverOnlyApiKey && serverConfig.customModels && req.body) {
    try {
      const clonedBody = await req.text();
      fetchOptions.body = clonedBody;

      const jsonBody = JSON.parse(clonedBody) as { model?: string };

      // not undefined and is false
      if (
        isModelNotavailableInServer(
          serverConfig.customModels,
          jsonBody?.model as string,
          [
            ServiceProvider.OpenAI,
            ServiceProvider.Azure,
            jsonBody?.model as string, // support provider-unspecified model
          ],
        )
      ) {
        return NextResponse.json(
          {
            error: true,
            message: `you are not allowed to use ${jsonBody?.model} model`,
          },
          {
            status: 403,
          },
        );
      }
    } catch (e) {}
  }

  try {
    const res = serverConfig.serverOnlyApiKey
      ? await fetchModelResponse(
          fetchUrl, { ...fetchOptions, signal: req.signal },
          JSON.parse(protectedBody!).stream !== true,
        )
      : await fetch(fetchUrl, fetchOptions);
    if (serverConfig.serverOnlyApiKey) {
      return credentialSafeResponse(res, [
        authValue.replace(/^Bearer\s+/i, ""), serverConfig.apiKey,
      ]);
    }

    // to prevent browser prompt for credentials
    const newHeaders = new Headers(res.headers);
    newHeaders.delete("www-authenticate");
    for (const name of [
      "authorization",
      "api-key",
      "x-api-key",
      "x-goog-api-key",
    ]) {
      newHeaders.delete(name);
    }
    // to disable nginx buffering
    newHeaders.set("X-Accel-Buffering", "no");

    // Conditionally delete the OpenAI-Organization header from the response if [Org ID] is undefined or empty (not setup in ENV)
    // Also, this is to prevent the header from being sent to the client
    if (!serverConfig.openaiOrgId || serverConfig.openaiOrgId.trim() === "") {
      newHeaders.delete("OpenAI-Organization");
    }

    // The latest version of the OpenAI API forced the content-encoding to be "br" in json response
    // So if the streaming is disabled, we need to remove the content-encoding header
    // Because Vercel uses gzip to compress the response, if we don't remove the content-encoding header
    // The browser will try to decode the response with brotli and fail
    newHeaders.delete("content-encoding");

    return new Response(res.body, {
      status: res.status,
      statusText: res.statusText,
      headers: newHeaders,
    });
  } catch (error) {
    if (error instanceof ModelDeadlineError) {
      return aiCostResponse(new AiCostError("AI_UPSTREAM_TIMEOUT", 504));
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}
