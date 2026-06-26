# Local RAG Studio

A fully local RAG chat app that talks to [LM Studio](https://lmstudio.ai) over your project files. All projects, files, chats, and indexes are stored on disk next to the app — nothing goes to the cloud.

## Features

- **Projects** with unlimited uploads (`.md`, `.csv`, `.txt`, `.json`)
- **Multiple chats per project** with persistent history
- **Hybrid RAG**: FTS5 keyword search always; vector search when an embedding model is configured
- **Agent tool harness**: `search_documents`, `read_file`, `grep_files`, `list_files`, `save_memory`, `recall_memory`, `get_conversation_summary`
- **Long conversation support**: rolling summaries + recent-turn window + on-demand file retrieval
- **Local storage**: SQLite (`data/app.db`) + raw files (`data/projects/{id}/files/`)

## Requirements

- [Bun](https://bun.sh) 1.0+ (package manager, dev server, and production runtime)
- [LM Studio](https://lmstudio.ai) running locally with the API server enabled (default `http://localhost:1234`)

Node.js is **not** required for day-to-day use. Astro’s CLI is launched via `bun scripts/run-astro.ts`.

## Quick start

1. **Start LM Studio** and load:
   - A chat model (e.g. Qwen3.5 9B Q4_K_M)
   - Optionally an embedding model (e.g. `nomic-embed-text`) for semantic search

2. **Install and run the app:**

```bash
bun install
bun run dev
```

Open [http://localhost:4322](http://localhost:4322).

This app uses port **4322** by default so it does not clash with other local Astro projects (e.g. `convert-files` on 4321).

3. **Configure models** in Settings → pick chat model (and optional embedding model).

## Scripts

| Command | Description |
|---------|-------------|
| `bun run dev` | Start dev server (Bun runtime) |
| `bun run build` | Production build |
| `bun run start` | Run production server (`bun ./dist/server/entry.mjs`) |
| `bun run test` | Playwright end-to-end tests |
| `bun run test:ui` | Playwright UI mode |

## Data layout

```
data/
  app.db                 # SQLite: projects, chats, messages, chunks, memories
  projects/
    {projectId}/
      files/             # uploaded source files
```

This folder is gitignored. Delete it to reset all local data.

## How RAG works

1. **Upload** → files are chunked and indexed (FTS5 + optional embeddings via LM Studio `/v1/embeddings`)
2. **Each message** → hybrid retrieval pre-injects relevant chunks
3. **Tool loop** → the model can search/read/grep files during the turn
4. **Memory** → rolling chat summaries and explicit `save_memory` facts persist across long threads

## LM Studio API

The app uses OpenAI-compatible endpoints:

- `POST /v1/chat/completions` (with tools, streaming)
- `POST /v1/embeddings` (when embedding model is set)
- `GET /v1/models` (health check + model picker)

Default base URL: `http://localhost:1234/v1`

## UI skills

Design skills can be installed for agent-assisted UI work:

```bash
npx skills add Leonxlnx/taste-skill --skill design-taste-frontend
npx skills add nextlevelbuilder/ui-ux-pro-max-skill --skill ui-ux-pro-max
npx skills add anthropics/skills --skill frontend-design
```

## Tech stack

- Astro 7 (SSR, `@astrojs/node` standalone)
- React islands + Tailwind CSS v4
- Bun runtime + `bun:sqlite` + optional `sqlite-vec`
- Playwright for end-to-end tests (`bun run test`)
