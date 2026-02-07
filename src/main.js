import "./style.css";

import { fetchProviders, sendMessage } from "./api";
import { executeCode, extractCode, stripCodeBlocks } from "./executor";
import { createScene } from "./scene";
import { createTerminal } from "./terminal";

const appEl = document.getElementById("app");
const sceneContainer = document.getElementById("scene-container");
const terminalEl = document.getElementById("terminal");
const terminalResizeHandleEl = document.getElementById("terminal-resize-handle");
const sceneContext = createScene(sceneContainer);
const history = [];
const providerById = new Map();
const sceneStateStack = [
  { code: null, parentIndex: null, viewState: sceneContext.captureViewState() }
];
const revertActionEntries = [];
let activeStateIndex = 0;
let isBusy = false;

const terminal = createTerminal(handleSubmit);
setupTerminalResize();
terminal.disableInput(true);
terminal.addAssistantMessage(
  "Scene ready. Configure providers in .env and send a prompt to mutate the world."
);

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function setupTerminalResize() {
  if (!(appEl instanceof HTMLElement)) {
    return;
  }

  if (!(terminalEl instanceof HTMLElement)) {
    return;
  }

  if (!(terminalResizeHandleEl instanceof HTMLElement)) {
    return;
  }

  const minTerminalHeight = 224;
  const minViewportHeight = 220;
  let activePointerId = null;
  let startY = 0;
  let startHeight = 0;

  function getMaxTerminalHeight() {
    const appHeight = appEl.getBoundingClientRect().height;
    return Math.max(minTerminalHeight, appHeight - minViewportHeight);
  }

  function applyHeight(nextHeight) {
    const clamped = clamp(nextHeight, minTerminalHeight, getMaxTerminalHeight());
    terminalEl.style.height = `${Math.round(clamped)}px`;
  }

  function finishResize() {
    activePointerId = null;
    terminalResizeHandleEl.removeAttribute("data-active");
    document.body.classList.remove("terminal-resizing");
  }

  terminalResizeHandleEl.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) {
      return;
    }

    event.preventDefault();
    activePointerId = event.pointerId;
    startY = event.clientY;
    startHeight = terminalEl.getBoundingClientRect().height;
    terminalResizeHandleEl.setPointerCapture(activePointerId);
    terminalResizeHandleEl.setAttribute("data-active", "true");
    document.body.classList.add("terminal-resizing");
  });

  terminalResizeHandleEl.addEventListener("pointermove", (event) => {
    if (event.pointerId !== activePointerId) {
      return;
    }

    const delta = startY - event.clientY;
    applyHeight(startHeight + delta);
  });

  terminalResizeHandleEl.addEventListener("pointerup", (event) => {
    if (event.pointerId !== activePointerId) {
      return;
    }

    finishResize();
  });

  terminalResizeHandleEl.addEventListener("pointercancel", (event) => {
    if (event.pointerId !== activePointerId) {
      return;
    }

    finishResize();
  });

  window.addEventListener("resize", () => {
    applyHeight(terminalEl.getBoundingClientRect().height);
  });
}

async function initializeProviders() {
  const payload = await fetchProviders();
  const providers = payload.providers || [];
  const selected = payload.defaultProvider || providers[0]?.id || "";

  providers.forEach((provider) => {
    providerById.set(provider.id, provider);
  });

  terminal.setProviders(providers, selected);
  terminal.setStatus(
    selected
      ? `Using ${providerById.get(selected)?.label || selected}`
      : "No provider available"
  );
}

function appendHistory(role, content) {
  history.push({ role, content });
  if (history.length > 30) {
    history.splice(0, history.length - 30);
  }
}

function formatAssistantText(rawText) {
  const cleaned = stripCodeBlocks(rawText);
  return cleaned.length > 0 ? cleaned : "Applied scene update.";
}

function refreshRevertActions() {
  revertActionEntries.forEach((entry) => {
    const available = entry.stateIndex < sceneStateStack.length;
    entry.button.disabled = !available;
    entry.button.title = available ? "revert" : "revert (unavailable)";
  });
}

function registerRevertAction(button, stateIndex) {
  revertActionEntries.push({ button, stateIndex });
  refreshRevertActions();
}

function collectStateCodePath(stateIndex) {
  const codePath = [];
  let cursor = stateIndex;

  while (cursor !== 0) {
    const state = sceneStateStack[cursor];
    if (!state) {
      throw new Error(`State #${cursor} is missing from the stack.`);
    }

    if (typeof state.code === "string" && state.code.trim()) {
      codePath.unshift(state.code);
    }

    if (typeof state.parentIndex !== "number" || state.parentIndex < 0) {
      throw new Error(`State #${cursor} has an invalid parent pointer.`);
    }

    cursor = state.parentIndex;
  }

  return codePath;
}

function restoreSceneToStateIndex(stateIndex) {
  if (stateIndex < 0 || stateIndex >= sceneStateStack.length) {
    throw new Error(`State #${stateIndex} is not available.`);
  }

  const codePath = collectStateCodePath(stateIndex);
  sceneContext.resetSceneToBase();

  for (const code of codePath) {
    executeCode(code, sceneContext);
  }

  sceneContext.restoreViewState(sceneStateStack[stateIndex].viewState);
}

function revertToState(stateIndex) {
  if (isBusy) {
    terminal.addError("Wait for the current request to finish before reverting.");
    return;
  }

  try {
    restoreSceneToStateIndex(stateIndex);
    activeStateIndex = stateIndex;
    refreshRevertActions();
    terminal.addAssistantMessage(`Reverted to scene state #${stateIndex}.`);
    appendHistory("user", `Revert to scene state #${stateIndex}.`);
    appendHistory("assistant", `Reverted to scene state #${stateIndex}.`);
  } catch (error) {
    const errorText = error instanceof Error ? error.message : "Unknown revert error.";
    terminal.addError(`Revert failed: ${errorText}`);
  }
}

function captureSceneScreenshot() {
  const canvas = sceneContext.renderer?.domElement;
  if (!(canvas instanceof HTMLCanvasElement)) {
    return null;
  }

  const sourceWidth = canvas.width || canvas.clientWidth;
  const sourceHeight = canvas.height || canvas.clientHeight;
  if (!sourceWidth || !sourceHeight) {
    return null;
  }

  const maxWidth = 640;
  const scale = Math.min(1, maxWidth / sourceWidth);
  const targetWidth = Math.max(1, Math.round(sourceWidth * scale));
  const targetHeight = Math.max(1, Math.round(sourceHeight * scale));

  const snapshotCanvas = document.createElement("canvas");
  snapshotCanvas.width = targetWidth;
  snapshotCanvas.height = targetHeight;

  const context = snapshotCanvas.getContext("2d");
  if (!context) {
    return null;
  }

  // Ensure the canvas represents the latest scene state before capture.
  sceneContext.renderer.render(sceneContext.scene, sceneContext.camera);
  context.drawImage(canvas, 0, 0, targetWidth, targetHeight);

  return snapshotCanvas.toDataURL("image/jpeg", 0.72);
}

async function handleSubmit(message) {
  if (isBusy) {
    return;
  }

  isBusy = true;
  terminal.addUserMessage(message);
  terminal.clearInput();
  terminal.disableInput(true);
  terminal.showThinking();

  const provider = terminal.getSelectedProvider();
  const screenshot = captureSceneScreenshot();
  if (!screenshot) {
    terminal.hideThinking();
    terminal.addError("Failed to capture scene screenshot. Message was not sent.");
    isBusy = false;
    terminal.disableInput(false);
    terminal.focusInput();
    return;
  }

  try {
    const result = await sendMessage(message, history, provider, screenshot);
    const responseText = result.response || "";
    const code = extractCode(responseText);

    terminal.hideThinking();
    appendHistory("user", message);
    appendHistory("assistant", responseText);

    if (code) {
      try {
        executeCode(code, sceneContext);
        const stateIndex =
          sceneStateStack.push({
            code,
            parentIndex: activeStateIndex,
            viewState: sceneContext.captureViewState()
          }) - 1;
        activeStateIndex = stateIndex;
        const lineHandle = terminal.addAssistantMessageWithAction(
          formatAssistantText(responseText),
          {
            icon: "↺",
            title: "revert",
            onClick: () => revertToState(stateIndex)
          }
        );

        if (lineHandle?.button) {
          registerRevertAction(lineHandle.button, stateIndex);
        }
      } catch (error) {
        const errorText = error instanceof Error ? error.message : "Unknown execution error.";
        terminal.addError(`Code execution failed: ${errorText}`);
      }
    } else {
      terminal.addAssistantMessage(responseText || "No code block returned.");
    }

    const providerLabel = providerById.get(result.provider)?.label || result.provider;
    terminal.setStatus(`Using ${providerLabel}`);
  } catch (error) {
    terminal.hideThinking();
    const errorText = error instanceof Error ? error.message : "Unknown error.";
    terminal.addError(errorText);
  } finally {
    isBusy = false;
    terminal.disableInput(false);
    terminal.focusInput();
  }
}

terminal.onProviderChange((providerId) => {
  const label = providerById.get(providerId)?.label || providerId;
  terminal.setStatus(`Using ${label}`);
});

initializeProviders()
  .then(() => {
    terminal.disableInput(false);
    terminal.focusInput();
  })
  .catch((error) => {
    const errorText =
      error instanceof Error ? error.message : "Failed to initialize providers.";
    terminal.addError(errorText);
    terminal.setStatus("Provider setup failed");
    terminal.disableInput(true);
  });

window.addEventListener("beforeunload", () => {
  sceneContext.dispose();
});
