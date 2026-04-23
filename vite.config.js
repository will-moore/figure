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
// if Unset, we get e.g. src="/assets/index-CQUJWFOE.js"> in index.html. (default behaviour)
// If set, src="/omero-figure/assets/index-Tjqwbv6v.js"> which is needed for gh-pages deployed to https://ome.github.io/omero-figure/
// NB: GITHUB_REPOSITORY_OWNER is *also* set when we do a release build via GitHub Actions...
// ...but this is handled (removed) in views.py when serving the index.html.
if (process.env.GITHUB_REPOSITORY_OWNER) {
  config.base = "/omero-figure/";
}

export default defineConfig(config);
