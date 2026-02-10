import { defineConfig } from "vite";
import injectHTML from 'vite-plugin-html-inject';

const path = require('path')

let config = {
  root: path.resolve(__dirname, 'src'),
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
    // output into Django's static dir
    outDir: "../omero_figure/static/omero_figure/"
  },

  assetsInclude: ["**/*.template.html"],
}

// this will be undefined when deployed from netlify, but is used by gh-pages
if (process.env.GITHUB_REPOSITORY_OWNER) {
  config.base = "/omero-figure/";
}

export default defineConfig(config);
