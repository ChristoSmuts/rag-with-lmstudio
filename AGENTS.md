## Development

When starting the dev server, use background mode:

```
astro dev --background
```

Manage the background server with `astro dev stop`, `astro dev status`, and `astro dev logs`.

## Documentation

Full documentation: https://docs.astro.build

Consult these guides before working on related tasks:

- [Adding pages, dynamic routes, or middleware](https://docs.astro.build/en/guides/routing/)
- [Working with Astro components](https://docs.astro.build/en/basics/astro-components/)
- [Using React, Vue, Svelte, or other framework components](https://docs.astro.build/en/guides/framework-components/)
- [Adding or managing content](https://docs.astro.build/en/guides/content-collections/)
- [Adding styles or using Tailwind](https://docs.astro.build/en/guides/styling/)
- [Supporting multiple languages](https://docs.astro.build/en/guides/internationalization/)

## Learned User Preferences

- Use Bun as the JavaScript runtime, package manager, and dev/build runner (not Node).
- Prefer the latest Astro version when scaffolding or upgrading.
- Use Playwright only for tests; do not add Vitest/Jest or expose mock/test harness tooling in the user-facing workflow.
- Apply pointer cursor and verify accessibility on all clickable actions (links, buttons).
- Consult installed UI/UX skills when evaluating or changing UI; use ui-ux-pro-max for product/dashboard surfaces and design-taste-frontend for landing-style pages only.
- Convert PDF, Word (.docx), and Excel (.xlsx/.xls) uploads to AI-readable text locally in-app before indexing (no cloud, no LM Studio conversion).
- Keep the app fully local with no cloud dependencies or data egress.
- RAG conversations must retain file-grounded context across very long threads.
- Chat UX should support stop/interrupt, edit-and-rerun, rerun last prompt, and collapsible side panels (files/chats).

## Learned Workspace Facts

- Local LM Studio RAG chat app: projects, file uploads, per-project chats, LM Studio OpenAI-compatible API.
- Stack: Astro 7 SSR with @astrojs/node (standalone), React islands, Tailwind v4, Bun runtime.
- Persistent storage under workspace `data/` (SQLite + on-disk project files).
- Accepted upload types: markdown, CSV, plain text, JSON (.md, .csv, .txt, .json), plus PDF, Word (.docx), and Excel (.xlsx/.xls) which are converted locally to text before indexing.
- RAG pipeline: hybrid FTS5 keyword search + optional LM Studio embeddings (sqlite-vec) + agent tools (query rewriting, sources, rolling summaries).
- Recommended LM Studio models: Qwen3.5 9B Q4_K_M (chat) and nomic-embed-text (embeddings); default context budget is 6000 tokens.
- UI skills live in `.agents/skills/` (design-taste-frontend, ui-ux-pro-max, frontend-design).
- Dev: `bun run dev` or `astro dev --background`; production: `bun start`.
- Tests: `bun run test` runs Playwright; the LM Studio stub binds **41234 only** (never 1234). Tests restore your saved settings afterward (default `http://127.0.0.1:1234/v1`) and delete `E2E Project*` rows.
