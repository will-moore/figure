import { defineConfig } from "vite";
import injectHTML from 'vite-plugin-html-inject';

const path = require('path')

let config = {
  root: path.resolve(__dirname, 'src'),
  envDir: path.resolve(__dirname, 'src'),
  plugins: [injectHTML()],
  resolve: {
    alias: {
      '~bootstrap': path.resolve(__dirname, 'node_modules/bootstrap'),
    }
  },
  server: {
    port: 8080,
    hot: true,
    watch: {
        usePolling: true
    }
  },
  build: {
    sourcemap: true,
    outDir: path.resolve(__dirname, 'dist')
  },

  assetsInclude: ["**/*.template.html"],
}

// NB: config.base is set to "/figure/" in ghpages build (see package.json)

export default defineConfig(config);
