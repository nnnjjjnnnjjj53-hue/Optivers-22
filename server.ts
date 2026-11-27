import 'dotenv/config';
import express, { type Request, type Response } from 'express';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer as createViteServer } from 'vite';
import { createEyewearServerApp } from './api/index';

async function startServer() {
  const app = createEyewearServerApp();
  const httpServer = http.createServer(app);
  const isProd = process.env.NODE_ENV === 'production';
  const disableHmr = process.env.DISABLE_HMR === 'true';
  const __dirname = path.dirname(fileURLToPath(import.meta.url));

  if (!isProd) {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: disableHmr ? false : { server: httpServer },
      },
      plugins: disableHmr
        ? [
            {
              name: 'disable-vite-client-ws-when-hmr-off',
              enforce: 'post',
              transform(code, id) {
                if (id.endsWith('/vite/dist/client/client.mjs')) {
                  return code.replace(
                    /const transport = normalizeModuleRunnerTransport\(\(\(\) => \{[\s\S]*?\}\)\(\)\);/,
                    'const transport = normalizeModuleRunnerTransport({ async connect() {}, async disconnect() {}, send() {} });'
                  );
                }
              },
            },
          ]
        : [],
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req: Request, res: Response) => {
      const indexHtml = path.join(distDir, 'index.html');
      if (fs.existsSync(indexHtml)) {
        res.sendFile(indexHtml);
      } else {
        res.status(404).send('Build not found');
      }
    });
  }

  const port = Number(process.env.PORT) || 3000;
  httpServer.listen(port, '0.0.0.0', () => {
    console.log(`[OptiVerse] Full-stack server running on http://0.0.0.0:${port}`);
  });
}

void startServer();
