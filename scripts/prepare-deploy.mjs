// Node file APIs update the generated Wrangler snapshot after both Vite builds finish.
import { readFile, writeFile } from 'node:fs/promises';

/**
 * Input:
 * - The Worker build's generated Wrangler JSON and the separate `dist-web` frontend build.
 *
 * Output:
 * - The generated Wrangler JSON updated with deployable SPA asset configuration.
 *
 * What this function does:
 * - Preserves Flue's split-module manifest while adding the frontend settings omitted by the Worker-only Vite build.
 */
async function prepareDeploy() {
  // This is generated output, so the helper runs only after `vite build` recreates it.
  const deployConfigUrl = new URL(
    '../dist/tech_docs_flue_research_worker/wrangler.json',
    import.meta.url,
  );
  const config = JSON.parse(await readFile(deployConfigUrl, 'utf8'));

  // API requests run the Worker first; all other paths use static files or the SPA index fallback.
  config.assets = {
    directory: '../../dist-web',
    not_found_handling: 'single-page-application',
    run_worker_first: ['/api/*'],
  };

  await writeFile(deployConfigUrl, `${JSON.stringify(config)}\n`);
}

await prepareDeploy();
