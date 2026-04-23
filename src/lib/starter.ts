import type { FileEntry } from '../types';

export const STARTER_FILES: FileEntry[] = [
  {
    path: 'package.json',
    content: JSON.stringify(
      {
        name: 'starter',
        private: true,
        type: 'module',
        scripts: {
          dev: 'vite --host 0.0.0.0',
          build: 'vite build',
          preview: 'vite preview',
        },
        dependencies: {
          react: '^18.3.1',
          'react-dom': '^18.3.1',
        },
        devDependencies: {
          '@vitejs/plugin-react': '^4.3.4',
          vite: '^5.4.11',
        },
      },
      null,
      2,
    ),
  },
  {
    path: 'vite.config.js',
    content: `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { host: '0.0.0.0' },
});
`,
  },
  {
    path: 'index.html',
    content: `<!DOCTYPE html>
<html>
  <head><meta charset="UTF-8" /><title>Starter</title></head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
`,
  },
  {
    path: 'src/main.jsx',
    content: `import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
`,
  },
  {
    path: 'src/App.jsx',
    content: `export default function App() {
  return (
    <main style={{ fontFamily: 'system-ui', padding: 40 }}>
      <h1>Hello from GetXsite.com</h1>
      <p>Edit <code>src/App.jsx</code> and the preview will hot reload.</p>
    </main>
  );
}
`,
  },
];
