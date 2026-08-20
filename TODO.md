# Wend TODOs

## High priority

- Add a `package.json` and package metadata.
- Split the runtime, CLI, and browser UI into separate modules/files.
- Add automated tests for lexer, parser, interpreter, and CLI.
- Add a simple GitHub Actions workflow for linting and tests.
- Improve CLI usability: `--version`, stdin support, better `--input` handling, and clearer error output.
- Fix mutation tracking for `push()` and similar data mutations in the replay/history model.

## Medium priority

- Add a formal language reference and syntax guide.
- Document built-in functions, data model, and time-travel debugging workflow.
- Improve browser UX: variable watch, history filtering, and step-highlight clarity.
- Add support for checkpointed replay to speed up long rewinds.
- Add example scripts and sample programs in a dedicated `examples/` folder.

## Low priority

- Add a deployable static playground build.
- Improve editor ergonomics: auto-indent, expandable history panel, and search within examples.
- Add optional output formatting flags to the CLI.
- Add `wend --watch` for auto-rerun on file changes.
- Add more built-in data helpers such as `group_by`, `window`, and `join` improvements.
