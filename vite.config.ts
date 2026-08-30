import react from "@vitejs/plugin-react";
import { defineConfig, type UserConfig } from "vite";
import {
  loadEnvFileIfPresent,
  parseServerPort
} from "./server/runtime-config";

export function createViteConfig(
  env: NodeJS.ProcessEnv = process.env
): UserConfig {
  const serverPort = parseServerPort(env.ALEKSI_SERVER_PORT);

  return {
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (
              id.includes("node_modules/katex") ||
              id.includes("node_modules/react-markdown") ||
              id.includes("node_modules/remark-math") ||
              id.includes("node_modules/rehype-katex") ||
              id.includes("node_modules/unified") ||
              id.includes("node_modules/unist-util") ||
              id.includes("node_modules/mdast-util") ||
              id.includes("node_modules/micromark")
            ) {
              return "markdown-math";
            }

            if (
              /node_modules\/(react|react-dom|react-router|react-router-dom)\//.test(
                id
              )
            ) {
              return "react-core";
            }

            if (id.includes("node_modules/@tanstack/react-query")) {
              return "query-core";
            }

            if (id.includes("node_modules/lottie-web")) {
              return "entrance-motion";
            }

            return undefined;
          }
        }
      }
    },
    plugins: [react()],
    server: {
      host: "127.0.0.1",
      port: 5173,
      strictPort: true,
      proxy: {
        "/api": `http://127.0.0.1:${serverPort}`
      }
    }
  };
}

export default defineConfig(() => {
  loadEnvFileIfPresent();
  return createViteConfig();
});
