# RPG Host Studio

This project runs a Vite frontend plus a local Express gateway for tabletop RPG room management and AI-assisted host tooling.

## What changed

- Text generation can now run through OpenRouter with key rotation across multiple API keys.
- Parallel prompt batches fan out server-side, so the browser never sees the keys.
- Image generation is exposed through the same gateway.
- TTS is wired to an OpenAI-compatible speech endpoint such as `openai-edge-tts`.
- The host UI now includes a prompt lab for single prompts, parallel prompt runs, image previews, and speech playback.

## Run locally

Prerequisites: Node.js

1. Install dependencies:
   `npm install`
2. Copy `.env.example` to `.env.local` and set the values you need.
3. Start the app:
   `npm run dev`

`npm run dev` starts both the Vite frontend and the local server gateway on `http://localhost:8787`.

## Environment

Important variables:

- `OPENROUTER_API_KEYS`: comma-separated or newline-separated pool of OpenRouter keys
- `OPENROUTER_TEXT_MODEL`: default text model, currently set to `qwen/qwen3.6-plus:free`
- `OPENROUTER_IMAGE_MODEL`: default image model for the host panel
- `NVIDIA_API_KEY`: optional fallback if OpenRouter is not configured
- `EDGE_TTS_BASE_URL`: OpenAI-compatible TTS endpoint
- `EDGE_TTS_API_KEY`: optional bearer token for the TTS service

## TTS backend

For local speech, run an OpenAI-compatible TTS service such as `openai-edge-tts`:

- Repository: `https://github.com/travisvn/openai-edge-tts`
- Typical local URL: `http://localhost:5050`

Example Docker run:

```bash
docker run -d -p 5050:5050 -e API_KEY=your_api_key_here -e PORT=5050 travisvn/openai-edge-tts:latest
```

`openai-edge-tts` accepts any string as the API key. If `REQUIRE_API_KEY=True`, set the same value in `EDGE_TTS_API_KEY`.

## Verification

- Type check: `npm run lint`
- Tests: `npm test`
