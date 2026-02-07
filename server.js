import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";
import express from "express";
import { createServer as createViteServer } from "vite";
import Anthropic from "@anthropic-ai/sdk";
import { Codex } from "@openai/codex-sdk";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const isProduction = process.env.NODE_ENV === "production";
const port = Number(process.env.PORT || 4000);

const app = express();
app.use(express.json({ limit: "6mb" }));

const clients = {
  anthropic: null,
  codex: null
};

const providerCatalog = {
  codex: {
    id: "codex",
    label: "Codex",
    type: "codex",
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

if (process.env.OPENAI_API_KEY) {
  const codexOptions = {
    apiKey: process.env.OPENAI_API_KEY
  };

  if (process.env.OPENAI_BASE_URL) {
    codexOptions.baseUrl = process.env.OPENAI_BASE_URL;
  }

  clients.codex = new Codex(codexOptions);
}

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
  console.warn(
    "No API keys found in environment. Requests must include a provider API key."
  );
}

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

const IMAGE_EXTENSION_BY_MIME = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp"
};

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

function toCodexPrompt(history, message, hasScreenshot) {
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

async function writeScreenshotToTempFile(screenshot) {
  if (!screenshot) {
    return null;
  }

  const extension = IMAGE_EXTENSION_BY_MIME[screenshot.mimeType];
  if (!extension) {
    throw new Error(`Unsupported screenshot media type: ${screenshot.mimeType}`);
  }

  const tempPath = path.join(
    os.tmpdir(),
    `tianjin-scene-${Date.now()}-${crypto.randomUUID()}.${extension}`
  );

  await fs.writeFile(tempPath, Buffer.from(screenshot.base64, "base64"));
  return tempPath;
}

function resolveApiKey(value) {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim();
}

function getCodexClient(apiKey) {
  if (apiKey === process.env.OPENAI_API_KEY && clients.codex) {
    return clients.codex;
  }

  const codexOptions = { apiKey };
  if (process.env.OPENAI_BASE_URL) {
    codexOptions.baseUrl = process.env.OPENAI_BASE_URL;
  }

  return new Codex(codexOptions);
}

function getAnthropicClient(apiKey) {
  if (apiKey === process.env.ANTHROPIC_API_KEY && clients.anthropic) {
    return clients.anthropic;
  }

  return new Anthropic({ apiKey });
}

async function callCodex(message, history, screenshot, apiKey) {
  let screenshotFilePath = null;
  if (screenshot) {
    screenshotFilePath = await writeScreenshotToTempFile(screenshot);
  }

  const client = getCodexClient(apiKey);
  const thread = client.startThread({
    model: providerCatalog.codex.model,
    approvalPolicy: "never",
    sandboxMode: "read-only",
    workingDirectory: __dirname,
    skipGitRepoCheck: true,
    webSearchMode: "disabled"
  });

  const codexInput = screenshotFilePath
    ? [
        { type: "text", text: toCodexPrompt(history, message, true) },
        { type: "local_image", path: screenshotFilePath }
      ]
    : toCodexPrompt(history, message, false);

  try {
    const turn = await thread.run(codexInput);

    if (typeof turn.finalResponse === "string" && turn.finalResponse.trim()) {
      return turn.finalResponse.trim();
    }

    const latestAgentMessage = [...turn.items]
      .reverse()
      .find((item) => item.type === "agent_message");

    if (
      latestAgentMessage &&
      typeof latestAgentMessage.text === "string" &&
      latestAgentMessage.text.trim()
    ) {
      return latestAgentMessage.text.trim();
    }

    return "";
  } finally {
    if (screenshotFilePath) {
      await fs.unlink(screenshotFilePath).catch(() => {});
    }
  }
}

async function callAnthropic(message, history, screenshot, apiKey) {
  const client = getAnthropicClient(apiKey);
  const response = await client.messages.create({
    model: providerCatalog["claude-code"].model,
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

app.get("/api/providers", (_req, res) => {
  res.json({
    providers: availableProviders,
    defaultProvider
  });
});

app.post("/api/chat", async (req, res) => {
  const { message, history, provider, screenshot, apiKey } = req.body || {};

  if (typeof message !== "string" || message.trim().length === 0) {
    res.status(400).json({ error: "Request body must include a non-empty `message`." });
    return;
  }

  const selectedProvider = provider || defaultProvider;
  const selectedProviderConfig = providerCatalog[selectedProvider];
  if (!selectedProviderConfig) {
    res.status(400).json({ error: `Provider '${selectedProvider}' is not available.` });
    return;
  }

  const envApiKey = resolveApiKey(process.env[selectedProviderConfig.envVar]);
  const requestApiKey = resolveApiKey(apiKey);
  const resolvedApiKey = envApiKey || requestApiKey;
  if (!resolvedApiKey) {
    res.status(400).json({
      error: `No API key configured for ${selectedProviderConfig.label}. Set ${selectedProviderConfig.envVar} in .env or provide apiKey in the request.`
    });
    return;
  }

  const parsedScreenshot = parseScreenshotDataUrl(screenshot);
  if (screenshot && !parsedScreenshot) {
    res.status(400).json({
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
        resolvedApiKey
      );
    } else {
      responseText = await callCodex(message.trim(), history, parsedScreenshot, resolvedApiKey);
    }

    res.json({
      provider: selectedProvider,
      response: responseText
    });
  } catch (error) {
    const messageText = error instanceof Error ? error.message : "Unknown provider error.";
    console.error("LLM proxy error:", error);
    res.status(500).json({ error: messageText });
  }
});

async function start() {
  if (!isProduction) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa"
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, "dist");
    app.use(express.static(distPath));
    app.get("/{*spa}", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
  });
}

start().catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});
