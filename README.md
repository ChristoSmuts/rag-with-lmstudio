# Local RAG Studio

Chat with your own documents — privately, on your computer.

Upload files (notes, spreadsheets, text exports, JSON), ask questions, and get answers grounded in what you uploaded. The AI runs through **[LM Studio](https://lmstudio.ai)** on your machine. Nothing is sent to the cloud.

---

## What you need

| What | Why |
|------|-----|
| **[LM Studio](https://lmstudio.ai)** | Runs the AI models on your PC or Mac |
| **[Bun](https://bun.sh)** | Starts this app (a small install — you do **not** need Node.js) |
| **This project folder** | The app itself |

**Rough time:** 15–30 minutes the first time (mostly downloading AI models).

---

## Part 1 — Set up LM Studio

LM Studio is a free desktop app that loads AI models and exposes a local API this app talks to.

### 1. Install LM Studio

1. Go to [lmstudio.ai](https://lmstudio.ai) and download the app for your system (Windows, macOS, or Linux).
2. Install it like any other desktop app and open it.

### 2. Download a chat model

You need one **chat** model so you can ask questions.

1. In LM Studio, open the **Discover** (or search) tab.
2. Search for a model suited to your hardware. A good starting point:
   - **Qwen3.5 9B Q4_K_M** — balanced quality and speed on a gaming PC or recent MacBook.
3. Click **Download** and wait until it finishes.

> **Tip:** Smaller “Q4” or “Q5” quantizations use less VRAM/RAM and run faster. Larger models need more GPU memory.

### 3. (Optional) Download an embedding model

Embeddings improve “find the right paragraph” search. The app still works without one (keyword search only).

1. In **Discover**, search for **nomic-embed-text** (or another embedding model).
2. Download it.

You can add this later in Settings if you want to get started quickly.

### 4. Load the chat model

1. Open the **Chat** or **My Models** area (wording varies by LM Studio version).
2. Select your downloaded **chat** model and **load** it into memory.
3. Wait until LM Studio shows the model as loaded/running.

### 5. Turn on the local API server

This is the step people miss most often — the app cannot talk to LM Studio until the server is on.

1. Open the **Developer** or **Local Server** tab in LM Studio.
2. **Start the server** (sometimes labeled “Start server” or similar).
3. Note the address shown — usually:
   ```
   http://127.0.0.1:1234
   ```
4. Leave LM Studio **open** while you use this app.

**Check it worked:** In your browser, visit `http://127.0.0.1:1234/v1/models`. You should see JSON text (a list of models), not an error page.

---

## Part 2 — Install and run this app

### 1. Install Bun

1. Go to [bun.sh](https://bun.sh) and follow the install instructions for your OS.
2. Close and reopen your terminal (or PowerShell) after installing.

**Check it worked:** Open a terminal and run:

```bash
bun --version
```

You should see a version number (e.g. `1.2.x`).

### 2. Open the project folder in a terminal

**Windows (PowerShell):**

```powershell
cd "C:\path\to\rag-with-lmstudio"
```

**Mac / Linux:**

```bash
cd /path/to/rag-with-lmstudio
```

Use the real path where you cloned or unzipped the project.

### 3. Install dependencies (first time only)

```bash
bun install
```

This downloads the libraries the app needs. It may take a minute.

### 4. Start the app

```bash
bun run dev
```

When you see a message that the server is ready, open your browser to:

**[http://localhost:4322](http://localhost:4322)**

> This app uses port **4322** so it does not clash with other local tools you might run.

### 5. Stop the app

In the terminal where it is running, press **Ctrl + C**.

---

## Part 3 — First time in the app

### Connect to LM Studio

1. Make sure LM Studio’s **local server is running** (Part 1, step 5).
2. In the app, click **Settings** (top right).
3. Set **LM Studio URL** to:
   ```
   http://127.0.0.1:1234/v1
   ```
   (Include `/v1` at the end.)
4. Choose your **chat model** from the dropdown.
5. Optionally choose an **embedding model** if you downloaded one.
6. Save.

You should see a status like **LM Studio online** near the top.

### Create a project and upload files

1. On the home screen, enter a project name and click **Create**.
2. Open the project.
3. In the **Files** panel, click **Upload** and add files:
   - Markdown (`.md`), CSV (`.csv`), plain text (`.txt`), JSON (`.json`)
   - PDF (`.pdf`), Word (`.docx`), Excel (`.xlsx`, `.xls`) — converted to text automatically before indexing
4. Wait until the file shows **Indexed** or **Keyword only** (conversion and indexing run in the background).

> **Note:** PDF/Word/Excel are converted locally by this app into AI-readable text. Scanned/image-only PDFs may not extract well.

### Start chatting

1. In the **Chats** panel, click **New**.
2. Type a question about your files and press **Send**.
3. Use **Sources** under an answer to see which file passages were used — click a source to open the file viewer.

---

## Everyday use (quick reference)

| I want to… | Do this |
|------------|---------|
| Start everything | 1) Open LM Studio → load model → start server → 2) `bun run dev` → 3) open `http://localhost:4322` |
| Ask about my files | Create/open a project → upload files → New chat → ask |
| Better search quality | Settings → add an **embedding model** → reindex files when prompted |
| Read an uploaded file | Click the file name in the Files list |
| Reset all local data | Quit the app, delete the `data/` folder in the project, restart |

---

## Troubleshooting

### “LM Studio offline” or models not listed

- LM Studio is open and the **local server is started**.
- URL in Settings is exactly `http://127.0.0.1:1234/v1`.
- A **chat model is loaded** in LM Studio (not just downloaded).
- Try `http://127.0.0.1:1234/v1/models` in your browser — if that fails, fix LM Studio first.

### Upload does nothing / files don’t appear

- Refresh the page and try again.
- Use supported types only: `.md`, `.csv`, `.txt`, `.json`.
- Check the terminal for error messages.

### Answers are slow or the PC fans spin up

- Use a smaller quantized model (e.g. Q4).
- Close other heavy apps.
- Shorter files and fewer files per project help.

### Port 4322 already in use

Another copy of the app may still be running. Stop it with **Ctrl + C** in that terminal, or close the other process using port 4322.

### I changed models in LM Studio

Open **Settings** in this app, reselect the model, and **reindex** files if you changed the embedding model.

---

## Privacy

- All projects, chats, and uploaded files live in the `data/` folder on your machine.
- That folder is **not** uploaded to GitHub when you clone this repo.
- No account, no cloud API keys, no telemetry — as long as LM Studio runs locally.

---

## For developers

<details>
<summary>Technical details (click to expand)</summary>

### Features

- Projects with file uploads (`.md`, `.csv`, `.txt`, `.json`)
- Multiple chats per project with persistent history
- Hybrid RAG: FTS5 keyword search always; vector search when an embedding model is configured
- Agent tools: `search_documents`, `read_file`, `grep_files`, `list_files`, `save_memory`, `recall_memory`, `get_conversation_summary`
- Long threads: rolling summaries, source citations, file viewer modal, context-usage meter
- Local storage: SQLite (`data/app.db`) + files (`data/projects/{id}/files/`)

### Scripts

| Command | Description |
|---------|-------------|
| `bun run dev` | Dev server at `http://localhost:4322` |
| `bun run build` | Production build |
| `bun run start` | Run production server |
| `bun run test` | Playwright end-to-end tests |

### LM Studio API

OpenAI-compatible endpoints:

- `POST /v1/chat/completions` (streaming + tools)
- `POST /v1/embeddings` (when embedding model is set)
- `GET /v1/models` (health + model picker)

### Stack

- Astro 7 SSR (`@astrojs/node` standalone)
- React islands + Tailwind CSS v4
- Bun runtime + `bun:sqlite` + optional `sqlite-vec`
- Playwright for e2e tests (mock LM Studio on port **41234**)

### UI agent skills (optional)

```bash
npx skills add Leonxlnx/taste-skill --skill design-taste-frontend
npx skills add nextlevelbuilder/ui-ux-pro-max-skill --skill ui-ux-pro-max
npx skills add anthropics/skills --skill frontend-design
```

</details>
