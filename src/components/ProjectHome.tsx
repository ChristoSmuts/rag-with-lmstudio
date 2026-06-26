import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { ConfirmDialog } from "./ConfirmDialog";
import { LmStudioStatus } from "./LmStudioStatus";
import { SettingsModal } from "./SettingsModal";
import type { Project } from "../lib/db/types";

export function ProjectHome() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsRevision, setSettingsRevision] = useState(0);
  const [pendingDelete, setPendingDelete] = useState<{
    id: string;
    name: string;
  } | null>(null);

  async function load() {
    setLoading(true);
    try {
      setProjects(await api.listProjects());
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function create() {
    if (!name.trim() || creating) return;
    setCreating(true);
    try {
      await api.createProject(name.trim());
      setName("");
      await load();
    } finally {
      setCreating(false);
    }
  }

  async function remove(id: string) {
    await api.deleteProject(id);
    await load();
  }

  async function handleConfirmDelete() {
    if (!pendingDelete) return;
    const target = pendingDelete;
    setPendingDelete(null);
    await remove(target.id);
  }

  return (
    <div className="min-h-dvh">
      <header className="border-b border-surface-700 bg-surface-900/80 px-4 py-4 backdrop-blur sm:px-6">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-zinc-50">
              Local RAG Studio
            </h1>
            <p className="text-sm leading-relaxed text-zinc-400">
              Chat with LM Studio over your project files. All data stays on disk.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <LmStudioStatus refreshKey={settingsRevision} />
            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              className="btn-secondary"
            >
              Settings
            </button>
          </div>
        </div>
      </header>

      <main id="main-content" className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <section className="mb-8 rounded-xl border border-surface-700 bg-surface-900 p-5">
          <h2 className="mb-3 text-sm font-medium uppercase tracking-wider text-zinc-400">
            New project
          </h2>
          <div className="flex flex-col gap-2 sm:flex-row">
            <label className="sr-only" htmlFor="project-name">
              Project name
            </label>
            <input
              id="project-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Project name"
              className="field flex-1"
              onKeyDown={(e) => e.key === "Enter" && void create()}
            />
            <button
              type="button"
              disabled={!name.trim() || creating}
              onClick={() => void create()}
              className="btn-primary sm:shrink-0"
            >
              {creating ? "Creating…" : "Create"}
            </button>
          </div>
        </section>

        <section>
          <h2 className="mb-4 text-sm font-medium uppercase tracking-wider text-zinc-400">
            Projects
          </h2>
          {loading ? (
            <p className="text-sm text-zinc-500" aria-live="polite">
              Loading projects…
            </p>
          ) : projects.length === 0 ? (
            <div className="empty-state">
              <p className="text-sm font-medium text-zinc-300">No projects yet</p>
              <p className="mt-2 text-sm leading-relaxed text-zinc-500">
                Name a project above, then upload files and start a chat in the workspace.
              </p>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {projects.map((project) => (
                <article
                  key={project.id}
                  className="group rounded-xl border border-surface-700 bg-surface-900 p-4 transition-colors hover:border-accent-500/40"
                >
                  <a
                    href={`/project/${project.id}`}
                    className="block rounded-lg focus-visible:outline-offset-4"
                  >
                    <h3 className="font-medium text-zinc-100 group-hover:text-accent-300">
                      {project.name}
                    </h3>
                    <p className="mt-1 line-clamp-2 text-sm leading-relaxed text-zinc-500">
                      {project.description || "No description"}
                    </p>
                  </a>
                  <button
                    type="button"
                    aria-label={`Delete project ${project.name}`}
                    onClick={() =>
                      setPendingDelete({ id: project.id, name: project.name })
                    }
                    className="btn-subtle mt-3 min-h-11"
                  >
                    Delete
                  </button>
                </article>
              ))}
            </div>
          )}
        </section>
      </main>

      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onSaved={() => setSettingsRevision((n) => n + 1)}
      />

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Delete project?"
        message={
          pendingDelete
            ? `"${pendingDelete.name}" and all of its files, chats, and messages will be permanently deleted. This cannot be undone.`
            : ""
        }
        confirmLabel="Delete"
        onConfirm={() => void handleConfirmDelete()}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}
