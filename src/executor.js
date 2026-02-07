const codeFencePattern = /```(?:javascript|js|threejs)?\s*([\s\S]*?)```/gi;

export function extractCode(text) {
  if (typeof text !== "string" || text.trim().length === 0) {
    return null;
  }

  const matches = [...text.matchAll(codeFencePattern)]
    .map((match) => match[1].trim())
    .filter(Boolean);

  if (matches.length > 0) {
    return matches.join("\n\n");
  }

  const looksLikeCode =
    /\b(scene|THREE|camera|renderer)\b/.test(text) &&
    /[;{}.=]/.test(text);

  return looksLikeCode ? text.trim() : null;
}

export function stripCodeBlocks(text) {
  if (typeof text !== "string") {
    return "";
  }

  return text.replace(codeFencePattern, "").trim();
}

export function executeCode(code, context) {
  if (typeof code !== "string" || code.trim().length === 0) {
    throw new Error("No executable code was provided.");
  }

  const runner = new Function(
    "scene",
    "THREE",
    "camera",
    "renderer",
    `"use strict";\n${code}`
  );

  return runner(context.scene, context.THREE, context.camera, context.renderer);
}
