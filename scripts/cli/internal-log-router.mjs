import { createWriteStream, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import readline from 'node:readline';

function parseArgs(argv) {
  const args = {
    mode: 'compact',
    infraLog: 'out/tests/infra/emulator.log',
    suiteLog: 'out/tests/suite/output.log',
    append: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--mode') {
      args.mode = String(argv[i + 1] ?? '').trim().toLowerCase();
      i += 1;
      continue;
    }
    if (token === '--infra-log') {
      args.infraLog = String(argv[i + 1] ?? args.infraLog).trim() || args.infraLog;
      i += 1;
      continue;
    }
    if (token === '--suite-log') {
      args.suiteLog = String(argv[i + 1] ?? args.suiteLog).trim() || args.suiteLog;
      i += 1;
      continue;
    }
    if (token === '--append') {
      args.append = true;
      continue;
    }
    if (token === '--reset') {
      args.append = false;
      continue;
    }
    throw new Error(`unknown argument: ${token}`);
  }

  if (!new Set(['compact', 'verbose', 'quiet']).has(args.mode)) {
    throw new Error(`invalid --mode "${args.mode}" (expected compact|verbose|quiet)`);
  }
  return args;
}

function ensureParentDir(path) {
  mkdirSync(dirname(resolve(path)), { recursive: true });
}

function isInfraLine(rawLine) {
  const line = rawLine.trimStart();
  if (/^(i|✔|⚠)\s{2}(functions(?:\[[^\]]+\])?|hosting(?:\[[^\]]+\])?|firestore|auth|emulators|hub|logging|eventarc|tasks|extensions):/.test(line)) {
    return true;
  }
  if (/^Serving at port \d+/.test(line)) {
    return true;
  }
  if (/^>\s+\{/.test(line) && line.includes('"firebase-log-type"')) {
    return true;
  }
  return false;
}

function isInfraImportant(rawLine) {
  const line = rawLine.trimStart();
  return line.startsWith('⚠') || line.startsWith('Error:') || line.includes(' exited unsuccessfully ');
}

function shouldWriteInfraToConsole(line, mode) {
  if (mode === 'verbose') return true;
  if (mode === 'quiet') return isInfraImportant(line);
  return isInfraImportant(line);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  ensureParentDir(args.infraLog);
  ensureParentDir(args.suiteLog);

  const fileMode = args.append ? 'a' : 'w';
  const infraStream = createWriteStream(args.infraLog, { flags: fileMode });
  const suiteStream = createWriteStream(args.suiteLog, { flags: fileMode });
  const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });

  input.on('line', (line) => {
    const isInfra = isInfraLine(line);
    if (isInfra) {
      infraStream.write(`${line}\n`);
      if (shouldWriteInfraToConsole(line, args.mode)) {
        process.stdout.write(`${line}\n`);
      }
      return;
    }

    suiteStream.write(`${line}\n`);
    process.stdout.write(`${line}\n`);
  });

  input.on('close', () => {
    infraStream.end();
    suiteStream.end();
  });
}

main();
