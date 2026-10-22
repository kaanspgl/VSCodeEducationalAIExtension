import { reactRouter } from "@react-router/dev/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [reactRouter()],
  resolve: {
    // "~/*" is this app, "@core/*" is the editor-independent code shared with the VS Code extension (../src).
    tsconfigPaths: true,
  },
  server: {
    fs: { allow: [".."] },
  },
});
