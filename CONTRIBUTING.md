# Contributing to Wend

Thanks for your interest in Wend! This project is small by design, and the best contributions are incremental, test-backed, and focused on improving the language experience.

## Getting started

1. Fork the repository.
2. Clone your fork.
3. Run `npm install` if you add dependencies in the future.
4. Run `npm test` to verify the codebase.

## Project layout

- `wendcli.js` — Node CLI and language runtime bundle.
- `wend.html` — browser playground and UI.
- `test/` — automated tests.
- `README.md` — project overview and quick start.
- `TODO.md` — current priorities.
- `STRATEGIC_PLAN.md` — roadmap and milestones.

## How to contribute

- Open issues for bugs, missing features, or design questions.
- Make small, self-contained changes.
- Add tests for new language behavior or bug fixes.
- Keep the language semantics stable unless you are explicitly improving the runtime.

## Recommended first contributions

- Add tests for parser edge cases.
- Improve the CLI experience or error messages.
- Add browser playground usability refinements.
- Document language features more clearly in the README.

## Development workflow

- Make your changes on a feature branch.
- Run `npm test` locally.
- Submit a pull request with a clear description and test coverage.
