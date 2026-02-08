async function parseJsonResponse(response) {
  let payload = {};
  try {
    payload = await response.json();
  } catch {
    payload = {};
  }

  if (!response.ok) {
    const errorMessage =
      payload?.error || `Request failed with status ${response.status}`;
    throw new Error(errorMessage);
  }

  return payload;
}

export async function fetchProviders() {
  const response = await fetch("/api/providers");
  return parseJsonResponse(response);
}

export async function sendMessage(message, history, provider, screenshot, apiKey) {
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      message,
      history,
      provider,
      screenshot,
      apiKey
    })
  });

  return parseJsonResponse(response);
}

export async function validateApiKey(provider, apiKey) {
  const response = await fetch("/api/validate-key", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      provider,
      apiKey
    })
  });

  return parseJsonResponse(response);
}
