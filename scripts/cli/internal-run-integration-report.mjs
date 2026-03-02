import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const OUT_DIR = 'out/tests/integration';
const OUT_XML = `${OUT_DIR}/junit.xml`;

function main() {
  mkdirSync(OUT_DIR, { recursive: true });

  const args = [
    'exec',
    'vitest',
    'run',
    'tests/integration',
    '--reporter=default',
    '--reporter=junit',
    `--outputFile.junit=${OUT_XML}`,
  ];

  const result = spawnSync('npm', args, {
    stdio: 'inherit',
    env: process.env,
  });

  if (result.error) {
    console.error(`[test:integration] failed to execute vitest: ${result.error.message}`);
    process.exit(1);
  }

  process.exit(result.status ?? 1);
}

main();
