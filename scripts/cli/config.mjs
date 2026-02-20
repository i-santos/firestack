import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export function loadProjectConfig(cwd, explicitPath = null) {
  const configPath = explicitPath ?? resolve(cwd, 'firestack.config.json');
  if (!existsSync(configPath)) {
    throw new Error(`missing firestack.config.json in ${cwd}. Run: npx firestack init`);
  }
  return {
    path: configPath,
    data: JSON.parse(readFileSync(configPath, 'utf8')),
  };
}

