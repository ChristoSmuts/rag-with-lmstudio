/** Dedicated port for the Playwright LM Studio stub (never 1234 — reserved for real LM Studio). */
export const E2E_LM_STUDIO_PORT = 41_234;

export const E2E_LM_STUDIO_BASE_URL = `http://127.0.0.1:${E2E_LM_STUDIO_PORT}/v1`;

/** Prefix for projects created during e2e runs (cleaned up after tests). */
export const E2E_PROJECT_NAME_PREFIX = "E2E Project";

/** Default LM Studio URL for local development (never the e2e mock port). */
export const USER_LM_STUDIO_BASE_URL = "http://127.0.0.1:1234/v1";
