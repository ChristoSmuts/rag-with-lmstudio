/**
 * Safety net after Playwright exits: free the e2e mock port and scrub shared data/.
 */
import { execSync } from "node:child_process";
import { E2E_LM_STUDIO_PORT } from "./constants";

function pidsListeningOnPort(port: number): number[] {
  try {
    const output = execSync(`netstat -ano | findstr "127.0.0.1:${port}"`, {
      encoding: "utf8",
    });
    const pids = new Set<number>();
    for (const line of output.split(/\r?\n/)) {
      if (!line.includes("LISTENING")) continue;
      const pid = Number(line.trim().split(/\s+/).at(-1));
      if (Number.isFinite(pid) && pid > 0) pids.add(pid);
    }
    return [...pids];
  } catch {
    return [];
  }
}

export default async function globalTeardown(): Promise<void> {
  try {
    execSync("bun tests/e2e/cleanup-e2e-db.ts", {
      cwd: process.cwd(),
      stdio: "ignore",
    });
  } catch {
    // DB may be locked while dev server is running; afterAll API cleanup is primary.
  }

  for (const pid of pidsListeningOnPort(E2E_LM_STUDIO_PORT)) {
    try {
      execSync(`taskkill /PID ${pid} /F`, { stdio: "ignore" });
    } catch {
      // already gone
    }
  }
}
