import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";
import topLevelAwait from 'vite-plugin-top-level-await';
import wasm from 'vite-plugin-wasm';
// https://vite.dev/config/
const env = loadEnv('development', process.cwd(), '');
export default defineConfig({
	plugins: [react(), tailwindcss(), wasm(), topLevelAwait()],
	base: '/PanTS-Viewer/',
	resolve: {
		extensions: ['.js', '.jsx', '.ts', '.tsx', '.json', '.wasm'],
	},
	assetsInclude: ['**/*.wasm'],
	server: {
		headers: {
			'Cross-Origin-Opener-Policy': 'same-origin',
			'Cross-Origin-Embedder-Policy': 'require-corp',
		},
		cors: true,
		proxy: {
			"/api": {
				target: env.VITE_API_BASE,
				changeOrigin: true,
				secure: false,
			},
		},
	},
});