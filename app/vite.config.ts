import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // 算定エンジン等（../src）をリポジトリルートから import するため
  server: { fs: { allow: [".."] } },
});
