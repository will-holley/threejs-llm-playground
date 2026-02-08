## Three.js LLM Playground

An interactive 3D playground powered by LLMs. Type natural language prompts in a chat-style terminal to create and manipulate objects in a live Three.js scene. Supports both Anthropic (Claude) and OpenAI (Codex) as providers.

## Quick Start

1. Install dependencies:

```bash
pnpm install
```

2. Configure environment variables:

```bash
cp .env.example .env
```

Optionally set one or both API keys in `.env`:
- `ANTHROPIC_API_KEY=...`
- `OPENAI_API_KEY=...`

If a provider key is not set in `.env`, the UI will prompt for it at runtime and send it with each request.

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
