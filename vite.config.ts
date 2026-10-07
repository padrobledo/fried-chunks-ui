import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");

  return {
    plugins: [
      react(),
      VitePWA({
        // Activate updates after the user closes the app instead of reloading a
        // payment result screen while it is being viewed.
        registerType: "prompt",
        manifest: {
          name: env.VITE_APP_NAME || "Fried Chunks",
          short_name: "FriedChunks",
          description: "Fried Chunks mobile-first PWA",
          theme_color: "#f4b942",
          background_color: "#17130d",
          display: "standalone",
          start_url: "/",
          icons: [
            {
              src: "/icon.svg",
              sizes: "any",
              type: "image/svg+xml",
              purpose: "any maskable"
            }
          ]
        }
      })
    ]
  };
});
