// Local dev loop: incremental TypeScript build plus a Node process that restarts on output changes.
// tsc (not esbuild/tsx) is used because Nest relies on emitted decorator metadata.
import { spawn } from 'node:child_process';

const run = (cmd, args) =>
  spawn(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32' });

const tsc = run('npx', ['tsc', '-p', 'tsconfig.build.json', '--watch', '--preserveWatchOutput']);
// Give the first compile a head start so dist/main.js exists.
setTimeout(() => {
  const app = run('node', ['--watch', '--enable-source-maps', 'dist/main.js']);
  const stop = () => {
    tsc.kill();
    app.kill();
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}, 8000);
