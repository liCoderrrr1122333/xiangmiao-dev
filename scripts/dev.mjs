import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import electron from 'electron';

const root = fileURLToPath(new URL('..', import.meta.url));
const server = await createServer({ root, server: { host: '127.0.0.1', port: 5173, strictPort: true } });
await server.listen();
server.printUrls();
// Launch only after our server owns the port, never against another project's page.
const child = spawn(electron, [root, ...process.argv.slice(2)], {
  cwd: root, stdio: 'inherit', env: { ...process.env, npm_lifecycle_event: 'dev' }
});
let closing = false;
async function close(code) {
  if (closing) return;
  closing = true;
  if (child.exitCode === null) child.kill();
  await server.close();
  process.exitCode = code;
}
child.once('error', error => { console.error(error.message); void close(1); });
child.once('exit', code => { void close(code ?? 1); });
process.once('SIGINT', () => { void close(0); });
process.once('SIGTERM', () => { void close(0); });
