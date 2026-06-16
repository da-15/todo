import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// GitHub Pages: https://da-15.github.io/todo/ で配信。
// 公開 root は docs/ なので、ビルド成果物を ../docs ではなく docs に出力する。
export default defineConfig({
  base: "/todo/",
  build: {
    outDir: "docs",
    emptyOutDir: true,
  },
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["apple-touch-icon.png", "favicon.svg"],
      manifest: {
        name: "ToDo",
        short_name: "ToDo",
        description: "個人用 ToDo 管理（Google Tasks 双方向同期）",
        theme_color: "#2563eb",
        background_color: "#ffffff",
        display: "standalone",
        orientation: "portrait",
        scope: "/todo/",
        start_url: "/todo/",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png" },
          {
            src: "icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,ico}"],
        navigateFallback: "/todo/index.html",
      },
      devOptions: {
        enabled: false,
      },
    }),
  ],
});
