# Wend

Wend is a real programming language with two surfaces:

- a browser-based playground in [wend.html](wend.html), and
- a terminal CLI in [wendcli.js](wendcli.js) that runs the same language from your shell.

The mission is simple: make debugging feel like a feature of the language rather than a separate toolchain. Wend records execution as a deterministic journey, so you can scrub backward through a run, inspect the history of values, and understand how a bug emerged without scattering temporary prints through your code.

## Why Wend matters

Most languages make debugging an afterthought. Wend turns time into a first-class part of the runtime experience.

### Core advantages

- Deterministic replay: every run is recorded and can be scrubbed step by step.
- History-driven debugging: inspect how a value evolved over time and jump back to the moment it changed.
- Data-friendly workflows: ingest JSON or CSV and transform it with built-ins such as `group_by`, `sort_by`, `table`, and `to_csv`.
- Friendly language features: pattern matching with ranges and rest patterns, destructuring `let`, pipelines, and more helpful errors.

## What you can do with Wend

### Rewind a bug

Instead of rerunning a program repeatedly and inserting temporary logging, Wend lets you step backward through execution and inspect the state of the machine at any point in the run.

That makes it practical to answer questions like:

- “How did this value become negative?”
- “What changed right before the error?”
- “What was the stack and scope at that moment?”

The same capability is available in the CLI through `--trace`.

### Work with data naturally

Wend is aimed at the jq-shaped niche: it can ingest JSON or CSV and return transformed output in a readable, composable form.

### Enjoy a more expressive syntax

Wend includes features that make it pleasant to write:

- pattern matching with ranges and rest patterns
- destructuring `let`
- pipelines
- informative errors with caret spans and did-you-mean guidance

## Project layout

- [wend.html](wend.html): the interactive playground with editor, console, history, and timeline controls.
- [wendcli.js](wendcli.js): the Node-based CLI for running Wend programs from the terminal.
- [README.md](README.md): project overview and getting-started guide.
- [.gitignore](.gitignore): repository hygiene for local editor and macOS files.

## Quick start

### Browser playground

Open [wend.html](wend.html) in a browser to use the editor, console, history panel, and timeline scrubber.

### Terminal CLI

Run a one-off expression:

```bash
node wendcli.js -e "print(42)"
```

Run a script file:

```bash
node wendcli.js path/to/program.wend
```

Useful options:

```bash
node wendcli.js --help
```

Common flags include:

- `--input <file>` to provide JSON or CSV input as `input`
- `--seed <n>` for deterministic runs
- `--trace` to print assignments as they happen

## A quick tour

A strong first experience is:

1. Open the playground and run a small program.
2. Drag the timeline backward and observe execution rewinding.
3. Break a program on purpose and inspect how the bad state emerged.
4. Try a data transformation example with your own JSON or CSV input.

## Current caveats

The current implementation makes a few tradeoffs to achieve replay-based debugging with a lightweight interpreter and no external dependencies:

- rewinding very far back in long runs can take a moment
- very large runs may fall back to plain execution after a threshold
- mutations made through `push()` rather than assignment are not currently reflected in history

## Roadmap

Potential next steps include:

- improving mutation tracking for `push()` and `pop()`
- adding checkpointed replay for faster rewinds on long runs
- drafting a formal language spec and reference manual

## License

This project is released under the MIT License.

## Contributing

Contributions are welcome. If you would like to improve the runtime, expand the standard library, or help shape the language design, open an issue or start a discussion.
