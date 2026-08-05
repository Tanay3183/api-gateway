/**
 * Backend Cluster Manager
 * 
 * Forks multiple child processes to simulate a multi-node backend architecture.
 */
import { fork } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ports = [3001, 3002, 3003];

console.log('Starting backend pool (3 instances on ports 3001, 3002, 3003)...');

ports.forEach((port) => {
  const child = fork(path.join(__dirname, 'server.js'), [], {
    env: { ...process.env, PORT: port.toString() }
  });

  child.on('exit', (code) => {
    console.log(`Backend instance on port ${port} exited with code ${code}`);
  });
});
