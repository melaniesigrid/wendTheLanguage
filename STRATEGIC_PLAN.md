# Wend Strategic Plan

This plan guides project improvement over the next 3 months with target dates and clear milestones.

## Goal

Build Wend into a maintainable, testable language runtime with a polished browser playground and a useful CLI.

## Phase 1 — Foundation and stability (by 2026-08-15)

- Add repository metadata and tooling.
  - Create `package.json`.
  - Add `npm test` / `npm run lint` scripts.
  - Add a GitHub Actions workflow for CI.
- Create a small automated test suite.
  - Test lexer, parser, runtime evaluation, and CLI flags.
- Split the monolithic codebase into separate logical modules.
  - Runtime/core
  - CLI entrypoint
  - Browser app logic

## Phase 2 — Developer experience and documentation (by 2026-08-31)

- Publish a concise language reference and syntax guide.
- Expand README with examples, CLI usage, and contribution guidance.
- Add at least 3 runnable examples and a dedicated `examples/` area.
- Improve browser playground usability.
  - better error highlighting
  - explicit history panel controls
  - clearer execution highlighting

## Phase 3 — Debugging completeness and performance (by 2026-09-15)

- Improve time-travel replay performance.
  - add checkpointing or incremental replay caching.
- Fix gaps in mutation tracking.
- Add better trace/history export or navigation helpers.
- Add additional built-in data helpers and a richer standard library.

## Phase 4 — polish and release readiness (by 2026-09-30)

- Harden CLI and browser integration.
  - support stdin and file watch mode.
  - support version and help output.
- Add a `CHANGELOG.md` or release notes section.
- Add documentation for contributing, issue filing, and roadmap.
- Prepare a release candidate or demo-ready version.

## Success criteria

- All core tests pass automatically in CI.
- The browser playground opens cleanly and supports timeline scrubber + variable history.
- The CLI supports deterministic runs with `--seed`, `--input`, and `--trace` cleanly.
- The README and strategy documents provide a clear on-ramp for contributors.

## Notes for AI agents

- Prioritize small, high-impact rewrites first: metadata, tests, and modularization.
- Keep changes incremental and preserve the existing language behavior.
- Use the timeline milestones to drive planning and avoid scope creep.
