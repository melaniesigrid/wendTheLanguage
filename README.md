# Wend

Wend is a small programming language for developers who want debugging, data transformation, and reproducible scripting to feel built in.

> Debugging is not an afterthought. In Wend, execution history is part of the language.

- Run Wend in the browser or from the CLI with the same runtime behavior.
- Keep every run deterministic and inspect past values.
- Work with JSON and CSV data using first-class helpers.

## Table of contents

- [Why Wend](#why-wend)
- [Core features](#core-features)
- [Quick example](#quick-example)
- [CLI usage](#cli-usage)
- [Browser playground](#browser-playground)
- [Project layout](#project-layout)
- [Developer setup](#developer-setup)
- [Roadmap](#roadmap)
- [License](#license)
- [Contributing](#contributing)

## Why Wend

Wend is built around one simple idea: your language should help you understand what happened, not just what happened now.

### Designed for modern workflows

- **Reversible execution:** every run is captured as a deterministic timeline so you can rewind and inspect past state.
- **Value history:** browse how variables changed over time, not just their final values.
- **Data-first scripting:** ingest JSON or CSV directly and manipulate it with built-in helpers.
- **Predictable runs:** deterministic seeds make behavior reproducible.
- **Browser + CLI parity:** explore interactively, then run the same script in automation.

### What Wend helps you solve

- Replace noisy temporary prints with true execution history.
- Prototype data transformations quickly and safely.
- Trace bugs by asking “when did this value change?”
- Keep interactive exploration and batch execution aligned.

## Core features

- `let` bindings with destructuring and pattern matching
- pipeline composition using `|>`
- built-ins for `group_by`, `sort_by`, `table`, `to_csv`, `fromJS`, and `toJS`
- deterministic, rewindable execution
- CLI `--trace` for assignment history
- browser playground with timeline scrubber and history controls
- `--version` and stdin support for script/input via `-`
- compact runtime with zero external dependencies

## Quick example

```wend
let orders = input
let paid = orders |> filter(o -> o.status == "paid")
let totals = paid |> map(o -> o.total)
print(totals)
```

Wend treats data transformation as a first-class workflow with readable syntax and replayable execution.

## CLI usage

Run a single expression:

```bash
node wendcli.js -e "print(42)"
```

Run a script file:

```bash
node wendcli.js examples/hello.wend
```

Read a script from stdin:

```bash
cat examples/hello.wend | node wendcli.js -
```

Run with JSON input:

```bash
node wendcli.js examples/data-summary.wend --input examples/sample-data.json
```

Read input from stdin:

```bash
cat examples/sample-data.json | node wendcli.js -e "print(input[0].name)" --input -
```

Show CLI version:

```bash
node wendcli.js --version
```

Show help:

```bash
node wendcli.js --help
```

### Common flags

- `-e` execute code directly
- `--input <file>` load JSON or CSV into `input`
- `--seed <n>` make runs deterministic
- `--trace` print assignment history during execution
- `-h, --help` show usage
- `--version` print version

## Browser playground

Open [wend.html](wend.html) to use the live editor, console, history panel, and timeline scrubber.

The browser experience is ideal for:

- iterating on logic quickly
- rewinding execution visually
- inspecting values at earlier points in the run
- comparing alternative code paths without rerunning manually

## Project layout

- `wend.html` — browser playground with editor and execution history
- `wendcli.js` — terminal CLI wrapper for running Wend scripts
- `src/wend-runtime.js` — core parser and interpreter
- `examples/` — sample programs and input files
- `test/` — regression tests and CLI coverage
- `.github/workflows/ci.yml` — automated CI for tests
- `package.json` — project metadata and scripts

## Developer setup

Requires Node 18 or newer.

```bash
npm test
```

### Recommended workflow

1. Edit or add examples in `examples/`.
2. Run the browser playground to explore behavior.
3. Use `node wendcli.js` for CLI validation.
4. Run `npm test` to confirm changes.

## Roadmap

Future improvements include:

- faster rewind checkpoints for long histories
- richer mutation tracking for arrays and maps
- AST export and introspection tooling
- formal language reference and standard library documentation

## Current caveats

Wend prioritizes simplicity and replayability today, so a few tradeoffs remain:

- very long histories can be slower to rewind than short runs
- low-level mutation operations like `push()` are not fully traced in history yet
- the interpreter trades raw performance for clarity and deterministic replay

## License

MIT

## Contributing

Contributions are welcome. If you want to improve the runtime, add built-in helpers, or help shape Wend’s language design, open an issue or start a discussion.
