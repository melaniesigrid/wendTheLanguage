const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const pkg = require(path.join(__dirname, '..', 'package.json'));
const Wend = require(path.join(__dirname, '..', 'src', 'wend-runtime.js'));

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    console.error(`FAIL: ${message}\n  expected: ${expected}\n  actual:   ${actual}`);
    process.exit(1);
  }
}

function runCode(src, opts = {}) {
  const outputs = [];
  const I = new Wend.Interpreter(src, {
    seed: opts.seed,
    inject: opts.inject,
    onPrint: line => outputs.push(line),
    onWrite: opts.onWrite || null,
  });
  const gen = I.run();
  let r = gen.next();
  while (!r.done) r = gen.next();
  return { result: r.value, outputs };
}

function testLexer() {
  const toks = Wend.lex('let x = 1\nprint(x)');
  assertEqual(toks[0].type, 'KW', 'lexer keyword token');
  assertEqual(toks[1].type, 'IDENT', 'lexer identifier token');
  assertEqual(toks[2].type, 'OP', 'lexer operator token');
  assertEqual(toks[3].type, 'NUM', 'lexer number token');
}

function testParser() {
  const ast = Wend.parse('let x = 2\nprint(x)');
  assertEqual(ast.type, 'Program', 'parser returns Program node');
  assertEqual(ast.body.length, 2, 'parser parses two top-level statements');
}

function testRuntime() {
  const { result, outputs } = runCode('let x = 3\nlet y = x * 2\nprint(y)');
  assertEqual(outputs.length, 1, 'runtime prints one line');
  assertEqual(outputs[0], '6', 'runtime computes multiplication correctly');
  assertEqual(result, null, 'runtime returns nil for script');
}

function testDataInput() {
  const { result, outputs } = runCode('print(input[0].name)', { inject: { input: Wend.fromJS([{ name: 'Ada' }]) } });
  assertEqual(outputs[0], 'Ada', 'runtime accepts injected input');
}

function testCLIVersion() {
  const proc = spawnSync(process.execPath, [path.join(__dirname, '..', 'wendcli.js'), '--version'], { encoding: 'utf8' });
  assertEqual(proc.status, 0, 'CLI --version exits successfully');
  assertEqual(proc.stdout.trim(), pkg.version, 'CLI --version prints package version');
}

function testCLIStdin() {
  const proc = spawnSync(process.execPath, [path.join(__dirname, '..', 'wendcli.js'), '-'], {
    input: 'print("hello")\n', encoding: 'utf8'
  });
  assertEqual(proc.status, 0, 'CLI stdin run exits successfully');
  assertEqual(proc.stdout.trim(), 'hello', 'CLI reads script from stdin with -');
}

function testCLIInputDash() {
  const proc = spawnSync(process.execPath, [path.join(__dirname, '..', 'wendcli.js'), '-e', 'print(input[0].name)', '--input', '-'], {
    input: JSON.stringify([{ name: 'Ada' }]), encoding: 'utf8'
  });
  assertEqual(proc.status, 0, 'CLI input-from-stdin exits successfully');
  assertEqual(proc.stdout.trim(), 'Ada', 'CLI reads input from stdin with --input -');
}

function testCLITrace() {
  const written = [];
  runCode('let x = 1\nx += 2\nprint(x)', {
    onWrite: (name, value) => written.push({ name, repr: Wend.repr(value, 1) }),
  });
  assertEqual(written.length >= 2, true, 'trace records writes');
  assertEqual(written[0].name, 'x', 'trace write records variable name');
}

function main() {
  console.log('Running Wend tests...');
  testLexer();
  testParser();
  testRuntime();
  testDataInput();
  testCLIVersion();
  testCLIStdin();
  testCLIInputDash();
  testCLITrace();
  console.log('All tests passed.');
}

main();
