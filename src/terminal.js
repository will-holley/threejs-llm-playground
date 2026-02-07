function createLine(className, text) {
  const line = document.createElement("div");
  line.className = `mb-1 whitespace-pre-wrap leading-relaxed ${className}`;
  line.textContent = text;
  return line;
}

export function createTerminal(onSubmit) {
  const logEl = document.getElementById("terminal-log");
  const formEl = document.getElementById("terminal-form");
  const inputEl = document.getElementById("terminal-input");
  const providerEl = document.getElementById("provider-select");
  const providerApiKeyContainerEl = document.getElementById("api-key-container");
  const providerApiKeyInputEl = document.getElementById("provider-api-key");
  const statusEl = document.getElementById("terminal-status");
  const submitButton = formEl.querySelector("button[type='submit']");

  let thinkingLine = null;

  function scrollToBottom() {
    logEl.scrollTop = logEl.scrollHeight;
  }

  function addLine(role, text, action) {
    const roleClass =
      role === "user"
        ? "text-emerald-400"
        : role === "assistant"
          ? "text-amber-300"
          : "text-red-400";

    const prefix = role === "user" ? "> " : role === "assistant" ? "< " : "! ";

    if (!action) {
      logEl.appendChild(createLine(roleClass, `${prefix}${text}`));
      scrollToBottom();
      return null;
    }

    const wrapper = document.createElement("div");
    wrapper.className = `mb-1 flex items-start gap-2 leading-relaxed ${roleClass}`;

    const textEl = document.createElement("div");
    textEl.className = "flex-1 whitespace-pre-wrap";
    textEl.textContent = `${prefix}${text}`;
    wrapper.appendChild(textEl);

    const button = document.createElement("button");
    button.type = "button";
    button.textContent = action.icon || "↺";
    button.title = action.title || "revert";
    button.setAttribute("aria-label", action.title || "revert");
    button.className =
      "cursor-default px-1 py-0 text-2xl leading-none text-slate-300 transition hover:cursor-pointer hover:text-cyan-300 disabled:cursor-not-allowed disabled:opacity-35";
    button.addEventListener("click", action.onClick);
    wrapper.appendChild(button);

    logEl.appendChild(wrapper);
    scrollToBottom();
    return { line: wrapper, button };
  }

  function setStatus(text) {
    statusEl.textContent = text;
  }

  function setProviders(providers, selectedProvider) {
    providerEl.innerHTML = "";
    providers.forEach((provider) => {
      const option = document.createElement("option");
      option.value = provider.id;
      option.textContent = provider.label;
      providerEl.appendChild(option);
    });

    if (selectedProvider) {
      providerEl.value = selectedProvider;
    }
  }

  function getSelectedProvider() {
    return providerEl.value;
  }

  function onProviderChange(callback) {
    providerEl.addEventListener("change", () => {
      callback(providerEl.value);
    });
  }

  function setApiKeyRequirement(required, providerLabel) {
    if (
      !(providerApiKeyContainerEl instanceof HTMLElement) ||
      !(providerApiKeyInputEl instanceof HTMLInputElement)
    ) {
      return;
    }

    if (!required) {
      providerApiKeyContainerEl.classList.add("hidden");
      providerApiKeyContainerEl.classList.remove("flex");
      providerApiKeyInputEl.value = "";
      return;
    }

    providerApiKeyContainerEl.classList.remove("hidden");
    providerApiKeyContainerEl.classList.add("flex");
    providerApiKeyInputEl.placeholder = `Paste ${providerLabel} API key`;
  }

  function getApiKey() {
    if (!(providerApiKeyInputEl instanceof HTMLInputElement)) {
      return "";
    }

    return providerApiKeyInputEl.value.trim();
  }

  function setApiKey(value) {
    if (!(providerApiKeyInputEl instanceof HTMLInputElement)) {
      return;
    }

    providerApiKeyInputEl.value = value;
  }

  function showThinking() {
    hideThinking();
    thinkingLine = createLine("text-slate-500 italic", "< Thinking...");
    logEl.appendChild(thinkingLine);
    scrollToBottom();
  }

  function hideThinking() {
    if (thinkingLine) {
      thinkingLine.remove();
      thinkingLine = null;
    }
  }

  function disableInput(disabled) {
    inputEl.disabled = disabled;
    submitButton.disabled = disabled;
    providerEl.disabled = disabled;
    if (providerApiKeyInputEl instanceof HTMLInputElement) {
      providerApiKeyInputEl.disabled = disabled;
    }
  }

  function focusInput() {
    inputEl.focus();
  }

  function clearInput() {
    inputEl.value = "";
  }

  formEl.addEventListener("submit", (event) => {
    event.preventDefault();
    const text = inputEl.value.trim();
    if (!text) {
      return;
    }
    onSubmit(text);
  });

  return {
    addUserMessage(text) {
      addLine("user", text);
    },
    addAssistantMessage(text) {
      addLine("assistant", text);
    },
    addAssistantMessageWithAction(text, action) {
      return addLine("assistant", text, action);
    },
    addError(text) {
      addLine("error", text);
    },
    showThinking,
    hideThinking,
    setProviders,
    getSelectedProvider,
    onProviderChange,
    setApiKeyRequirement,
    getApiKey,
    setApiKey,
    setStatus,
    disableInput,
    focusInput,
    clearInput
  };
}
