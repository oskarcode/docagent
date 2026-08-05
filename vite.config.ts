// The Cloudflare plugin builds a deployable Worker; Flue generates its entrypoint and agent bindings.
import { cloudflare } from '@cloudflare/vite-plugin';
import { flue, flueWorkerConfig } from '@flue/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  // Ordering matters: Flue must scan agents before Cloudflare snapshots the Wrangler configuration.
  plugins: [flue(), cloudflare({ config: flueWorkerConfig() })],
});
