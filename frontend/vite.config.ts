import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Servern ligger på 127.0.0.1:3000. Proxyn gör att webbläsaren bara pratar med Vite, så CORS behövs inte.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  server: { proxy: { '/admin': 'http://127.0.0.1:3000' } },
});
