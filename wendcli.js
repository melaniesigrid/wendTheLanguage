#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const Wend = require(path.join(__dirname, 'src', 'wend-runtime.js'));
const pkg = require(path.join(__dirname, 'package.json'));

const args = process.argv.slice(2);

function usage() {
  console.log(`wend — the language that can walk back the way it came\n\nusage:\n  wend <script.wend> [options]\n  wend -e \"<code>\" [options]\n\noptions:\n  --input <file>    JSON or CSV file, available in the program as \`input\`\n  --seed <n>        RNG seed (runs are deterministic; same seed = same run)\n  --trace           print every variable assignment as it happens (history)\n  -h, --help        this message`);
}

let file = null;
let evalSrc = null;
let inputFile = null;
let seed = undefined;
let traceWrites = false;

for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '-h' || a === '--help') {
    usage();
    process.exit(0);
  } else if (a === '--version') {
    console.log(pkg.version);
    process.exit(0);
  } else if (a === '-e') {
    evalSrc = args[++i];
  } else if (a === '--input') {
    inputFile = args[++i];
  } else if (a === '--seed') {
    seed = Number(args[++i]);
  } else if (a === '--trace') {
    traceWrites = true;
  } else if (!file) {
    file = a;
  }
}

const stdinAvailable = !process.stdin.isTTY;
const readScriptFromStdin = file === '-' || (!file && evalSrc === null && stdinAvailable);
if (!file && evalSrc === null && !readScriptFromStdin) {
  usage();
  process.exit(1);
}

let src;
try {
  if (evalSrc !== null) {
    src = evalSrc;
  } else if (readScriptFromStdin) {
    src = fs.readFileSync(0, 'utf8');
  } else {
    src = fs.readFileSync(file, 'utf8');
  }
} catch (e) {
  const target = readScriptFromStdin ? 'stdin' : file;
  console.error('wend: cannot read ' + target + ': ' + e.message);
  process.exit(1);
}

let input = null;
if (inputFile) {
  if (inputFile === '-' && readScriptFromStdin) {
    console.error('wend: cannot read both script and input from stdin');
    process.exit(1);
  }
  let text;
  try {
    text = inputFile === '-' ? fs.readFileSync(0, 'utf8') : fs.readFileSync(inputFile, 'utf8');
  } catch (e) {
    console.error('wend: cannot read --input ' + inputFile + ': ' + e.message);
    process.exit(1);
  }
  try {
    input = Wend.fromJS(JSON.parse(text));
  } catch (e) {
    const rows = Wend.parseCSVText(text);
    input = rows.length ? rows : text;
  }
}

function showError(e) {
  const name = file || '<eval>';
  console.error('\n✗ ' + e.kind + ' error — ' + name + ':' + e.line);
  const lines = src.split('\n');
  const line = lines[e.line - 1];
  if (line !== undefined) {
    const prefix = String(e.line).padStart(4) + ' | ';
    console.error(prefix + line);
    let lineStart = 0;
    for (let i = 0; i < e.line - 1; i++) lineStart += lines[i].length + 1;
    const from = Math.max(0, e.start - lineStart);
    const width = Math.max(1, Math.min(e.end - e.start, line.length - from));
    console.error(' '.repeat(prefix.length + from) + '^'.repeat(width));
  }
  console.error('  ' + e.message + '\n');
}

let I;
try {
  I = new Wend.Interpreter(src, {
    seed,
    inject: { input },
    onPrint: l => console.log(l),
    onWrite: traceWrites
      ? (name, value, node) => console.error('  · line ' + String(node.line).padStart(3) + '  ' + name + ' = ' + Wend.repr(value, 1))
      : null,
  });
} catch (e) {
  if (e instanceof Wend.WendError) {
    showError(e);
    process.exit(1);
  }
  throw e;
}

try {
  const gen = I.run();
  let r = gen.next();
  while (!r.done) r = gen.next();
  if (r.value !== null && r.value !== undefined && evalSrc !== null) {
    console.log(Wend.repr(r.value, 1));
  }
} catch (e) {
  if (e instanceof Wend.WendError) {
    showError(e);
    process.exit(1);
  }
  throw e;
}
