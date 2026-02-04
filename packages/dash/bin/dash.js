#!/usr/bin/env node

import serve from 'serve';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const distPath = path.resolve(__dirname, '../dist');

console.log(`Starting Facilitator Dashboard from ${distPath}...`);

// Simple wrapper around serve
// We can just spawn the serve command or use its API if available.
// 'serve' default export is not always the programmatic API in recent versions.
// Let's spawn it or use a simple http server if serve API is complex.
// Actually, 'serve' package exports a handler usually, but the CLI is the main usage.
// Let's look at a simpler approach: use 'handler' from 'serve-handler' if 'serve' is too heavy?
// 'serve' is fine. But wait, importing 'serve' might be the CLI entry point.

import { createServer } from 'http';
import handler from 'serve-handler';

const server = createServer((request, response) => {
  return handler(request, response, {
    public: distPath,
    rewrites: [
      { source: '**', destination: '/index.html' }
    ]
  });
});

server.listen(3000, () => {
  console.log('Running at http://localhost:3000');
  import('open').then(open => open.default('http://localhost:3000')).catch(() => {});
});
