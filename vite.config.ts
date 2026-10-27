import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";

// `npm run build` writes one self-contained dist/index.html that opens straight from disk.
export default defineConfig({
  plugins: [react(), viteSingleFile()],
});
