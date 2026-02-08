import Anthropic from "@anthropic-ai/sdk";

const NO_PROVIDERS_WARNING =
  "No API keys found in environment. Requests must include a provider API key.";

const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com";

const systemPrompt = [
  "You are a Three.js scene command assistant.",
  "You generate JavaScript meant to run inside a sandboxed function with scene, THREE, camera, renderer in scope.",
  "Return JavaScript in fenced code blocks whenever scene changes are requested.",
  "Rules:",
  "- Do not include imports, exports, or module syntax.",
  "- Use MeshStandardMaterial unless the user explicitly asks otherwise.",
  "- Give created objects clear, stable .name values so they can be referenced later.",
  "- Reuse or remove objects with scene.getObjectByName when appropriate.",
  "- For animations, attach userData.update = (time) => { ... }.",
  "- If asked for a teapot, use THREE.TeapotGeometry (it is available in runtime context).",
  "- Do not create a new render loop; the app already renders each frame.",
  "- Keep code concise and executable as-is."
].join("\n");

let cachedRuntime = null;

function createRuntimeState() {
  const clients = {
    anthropic: null
  };

  const providerCatalog = {
    codex: {
      id: "codex",
      label: "Codex",
      type: "openai",
      model: "gpt-5.2-codex",
      envVar: "OPENAI_API_KEY"
    },
    "claude-code": {
      id: "claude-code",
      label: "Claude Code",
      type: "anthropic",
      model: "claude-opus-4-6",
      envVar: "ANTHROPIC_API_KEY"
    }
  };

  if (process.env.ANTHROPIC_API_KEY) {
    clients.anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }

  const availableProviders = Object.values(providerCatalog).map((provider) => ({
    id: provider.id,
    label: provider.label,
    envConfigured: Boolean(process.env[provider.envVar])
  }));

  const defaultProvider =
    availableProviders.find((provider) => provider.envConfigured)?.id ||
    availableProviders[0]?.id ||
    null;

  if (!availableProviders.some((provider) => provider.envConfigured)) {
    console.warn(NO_PROVIDERS_WARNING);
  }

  return {
    clients,
    providerCatalog,
    availableProviders,
    defaultProvider
  };
}

function getRuntimeState() {
  if (!cachedRuntime) {
    cachedRuntime = createRuntimeState();
  }

  return cachedRuntime;
}

function sendJson(res, statusCode, payload) {
  if (typeof res.status === "function" && typeof res.json === "function") {
    res.status(statusCode).json(payload);
    return;
  }

  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

function parseScreenshotDataUrl(value) {
  if (typeof value !== "string" || value.length === 0) {
    return null;
  }

  const match = value.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (!match) {
    return null;
  }

  const [, mimeType, base64] = match;
  return { mimeType, base64 };
}

function normalizeHistory(history) {
  if (!Array.isArray(history)) {
    return [];
  }

  return history
    .filter((entry) => {
      return (
        entry &&
        (entry.role === "user" || entry.role === "assistant") &&
        typeof entry.content === "string" &&
        entry.content.trim().length > 0
      );
    })
    .slice(-20);
}

function toOpenAIPrompt(history, message, hasScreenshot) {
  const normalizedHistory = normalizeHistory(history);
  const lines = [
    systemPrompt,
    "",
    "Conversation so far (oldest to newest):"
  ];

  normalizedHistory.forEach((entry) => {
    const speaker = entry.role === "assistant" ? "Assistant" : "User";
    lines.push(`${speaker}: ${entry.content}`);
  });

  lines.push("");
  if (hasScreenshot) {
    lines.push("A screenshot of the current Three.js scene is attached for this turn.");
    lines.push("");
  }

  lines.push("Current user request:");
  lines.push(`User: ${message}`);
  lines.push("Assistant:");

  return lines.join("\n");
}

function toAnthropicMessages(history, message, screenshot) {
  const normalizedHistory = normalizeHistory(history).map((entry) => ({
    role: entry.role,
    content: entry.content
  }));

  const currentUserContent = [];
  if (screenshot) {
    currentUserContent.push({
      type: "image",
      source: {
        type: "base64",
        media_type: screenshot.mimeType,
        data: screenshot.base64
      }
    });
  }

  currentUserContent.push({ type: "text", text: message });
  return [...normalizedHistory, { role: "user", content: currentUserContent }];
}

function getOpenAIResponsesUrl() {
  const configuredBaseUrl =
    typeof process.env.OPENAI_BASE_URL === "string" && process.env.OPENAI_BASE_URL.trim()
      ? process.env.OPENAI_BASE_URL.trim()
      : DEFAULT_OPENAI_BASE_URL;

  const normalizedBaseUrl = configuredBaseUrl.replace(/\/+$/, "");
  if (normalizedBaseUrl.endsWith("/v1")) {
    return `${normalizedBaseUrl}/responses`;
  }

  return `${normalizedBaseUrl}/v1/responses`;
}

function extractOpenAIText(responsePayload) {
  if (!responsePayload || typeof responsePayload !== "object") {
    return "";
  }

  if (
    typeof responsePayload.output_text === "string" &&
    responsePayload.output_text.trim().length > 0
  ) {
    return responsePayload.output_text.trim();
  }

  if (!Array.isArray(responsePayload.output)) {
    return "";
  }

  const textParts = [];
  for (const item of responsePayload.output) {
    if (item?.type !== "message" || !Array.isArray(item.content)) {
      continue;
    }

    for (const contentItem of item.content) {
      const maybeText =
        contentItem?.type === "output_text" || contentItem?.type === "text"
          ? contentItem.text
          : null;

      if (typeof maybeText === "string" && maybeText.trim().length > 0) {
        textParts.push(maybeText.trim());
      }
    }
  }

  return textParts.join("\n\n").trim();
}

function resolveApiKey(value) {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim();
}

function getAnthropicClient(runtime, apiKey) {
  if (apiKey === process.env.ANTHROPIC_API_KEY && runtime.clients.anthropic) {
    return runtime.clients.anthropic;
  }

  return new Anthropic({ apiKey });
}

async function callOpenAI(message, history, screenshot, model, apiKey) {
  const userContent = [
    {
      type: "input_text",
      text: toOpenAIPrompt(history, message, Boolean(screenshot))
    }
  ];

  if (screenshot) {
    userContent.push({
      type: "input_image",
      image_url: `data:${screenshot.mimeType};base64,${screenshot.base64}`
    });
  }

  const response = await fetch(getOpenAIResponsesUrl(), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      input: [
        {
          role: "user",
          content: userContent
        }
      ]
    })
  });

  const responsePayload = await response.json().catch(() => null);
  if (!response.ok) {
    const upstreamMessage =
      typeof responsePayload?.error?.message === "string"
        ? responsePayload.error.message
        : `OpenAI request failed with status ${response.status}.`;

    throw new Error(upstreamMessage);
  }

  return extractOpenAIText(responsePayload);
}

async function callAnthropic(message, history, screenshot, model, runtime, apiKey) {
  const client = getAnthropicClient(runtime, apiKey);
  const response = await client.messages.create({
    model,
    system: systemPrompt,
    max_tokens: 1200,
    messages: toAnthropicMessages(history, message, screenshot)
  });

  return response.content
    .filter((item) => item.type === "text")
    .map((item) => item.text)
    .join("\n")
    .trim();
}

async function parseRequestJsonBody(req) {
  if (req.body && typeof req.body === "object") {
    return req.body;
  }

  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body);
    } catch {
      return null;
    }
  }

  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (chunks.length === 0) {
    return {};
  }

  const rawBody = Buffer.concat(chunks).toString("utf8");
  if (!rawBody.trim()) {
    return {};
  }

  try {
    return JSON.parse(rawBody);
  } catch {
    return null;
  }
}

export function assertProviderConfiguration() {
  getRuntimeState();
}

export function providersHandler(_req, res) {
  const runtime = getRuntimeState();

  sendJson(res, 200, {
    providers: runtime.availableProviders,
    defaultProvider: runtime.defaultProvider
  });
}

export async function chatHandler(req, res) {
  const runtime = getRuntimeState();

  const requestBody = await parseRequestJsonBody(req);
  if (!requestBody || typeof requestBody !== "object") {
    sendJson(res, 400, { error: "Request body must be valid JSON." });
    return;
  }

  const { message, history, provider, screenshot, apiKey } = requestBody;

  if (typeof message !== "string" || message.trim().length === 0) {
    sendJson(res, 400, { error: "Request body must include a non-empty `message`." });
    return;
  }

  const selectedProvider = provider || runtime.defaultProvider;
  const selectedProviderConfig = runtime.providerCatalog[selectedProvider];
  if (!selectedProviderConfig) {
    sendJson(res, 400, {
      error: `Provider '${selectedProvider}' is not available.`
    });
    return;
  }

  const envApiKey = resolveApiKey(process.env[selectedProviderConfig.envVar]);
  const requestApiKey = resolveApiKey(apiKey);
  const resolvedApiKey = envApiKey || requestApiKey;
  if (!resolvedApiKey) {
    sendJson(res, 400, {
      error: `No API key configured for ${selectedProviderConfig.label}. Set ${selectedProviderConfig.envVar} in .env or provide apiKey in the request.`
    });
    return;
  }

  const parsedScreenshot = parseScreenshotDataUrl(screenshot);
  if (screenshot && !parsedScreenshot) {
    sendJson(res, 400, {
      error:
        "If provided, `screenshot` must be a data URL with image/jpeg, image/png, or image/webp."
    });
    return;
  }

  try {
    let responseText = "";
    if (selectedProviderConfig.type === "anthropic") {
      responseText = await callAnthropic(
        message.trim(),
        history,
        parsedScreenshot,
        selectedProviderConfig.model,
        runtime,
        resolvedApiKey
      );
    } else {
      responseText = await callOpenAI(
        message.trim(),
        history,
        parsedScreenshot,
        selectedProviderConfig.model,
        resolvedApiKey
      );
    }

    sendJson(res, 200, {
      provider: selectedProvider,
      response: responseText
    });
  } catch (requestError) {
    const messageText =
      requestError instanceof Error ? requestError.message : "Unknown provider error.";
    console.error("LLM proxy error:", requestError);
    sendJson(res, 500, { error: messageText });
  }
}
