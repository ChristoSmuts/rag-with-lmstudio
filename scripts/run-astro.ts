import { fileURLToPath } from "node:url";

// Astro 7 gates on process.versions.node; Bun's Node-compat version is lower.
process.versions.node = "22.12.0";

const astroBin = fileURLToPath(
  new URL("../node_modules/astro/bin/astro.mjs", import.meta.url),
);

const commandArgs = process.argv.slice(2);
process.argv = [process.argv[0]!, astroBin, ...commandArgs];

await import("../node_modules/astro/bin/astro.mjs");
