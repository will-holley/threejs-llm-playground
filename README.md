## Three.js LLM Playground

Single-page Vite app with:
- `75%` Three.js viewport
- `25%` chat-style terminal

Type natural language prompts to mutate a live 3D scene through Anthropic or OpenAI.

## Quick Start

1. Install dependencies:

```bash
pnpm install
```

2. Configure environment variables:

```bash
cp .env.example .env
```

Set at least one API key in `.env`:
- `ANTHROPIC_API_KEY=...`
- `OPENAI_API_KEY=...`

3. Start development server:

```bash
pnpm dev
```

Open `http://localhost:4000`.
Backend changes under `server.js`, `backend/`, and `api/` are hot reloaded automatically in dev mode.

## Usage

Try prompts like:
- `add a red cube named demoCube`
- `make demoCube spin on the y-axis`
- `remove demoCube`

Use the provider dropdown in the terminal header to switch between available models.
Successful scene updates include a revert icon in the terminal; hover to see the `revert` tooltip and click to restore that stack state.

## How It Works

- Frontend sends `{ message, history, provider, screenshot }` to `POST /api/chat`.
- Frontend captures the latest scene screenshot on each send and includes it in `POST /api/chat`.
- Backend calls Anthropic SDK or OpenAI Responses API and returns its response.
- Frontend extracts fenced JavaScript code blocks from the response.
- Extracted code executes with a constrained context:
  - `scene`
  - `THREE`
  - `camera`
  - `renderer`

Animation hooks can be attached with:

```js
mesh.userData.update = (time) => {
  mesh.rotation.y = time;
};
```

The scene loop invokes `userData.update(time)` each frame with error protection.

## Provider Notes

- Anthropic model: `claude-opus-4-6`
- OpenAI model via Responses API: `gpt-5.2-codex`

If both keys are set, both providers appear in the dropdown.

## Production

Build frontend assets:

```bash
pnpm build
```

Run in production mode:

```bash
pnpm preview
```

This serves static files from `dist/` plus API routes.

## Vercel Deployment

- Frontend is built by Vite from `dist/`.
- API endpoints are exposed through Vercel Functions in `api/chat.js` and `api/providers.js`.
- Set environment variables in Vercel Preview and Production:
  - `ANTHROPIC_API_KEY`
  - `OPENAI_API_KEY`
  - `OPENAI_BASE_URL` (optional)
