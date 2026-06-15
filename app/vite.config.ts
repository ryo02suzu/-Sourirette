import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // GitHub Pages（リポジトリ配下のサブパス）でも開けるよう相対パスで出力する
  base: "./",
  // 算定エンジン等（../src）をリポジトリルートから import するため
  server: { fs: { allow: [".."] } },
});
