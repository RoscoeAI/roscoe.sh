# Style and conventions
- TypeScript is `strict` and the project uses Node ESM with `.js` extensions in relative imports from TypeScript source.
- Formatting style in existing files: 2-space indentation, double quotes, semicolons, and trailing commas where multiline structures are used.
- Naming: classes/interfaces/components use PascalCase; functions/variables/hooks use camelCase; filenames are kebab-case.
- Tests are colocated under `src/` with `*.test.ts` / `*.test.tsx` suffixes.
- UI code is written with Ink + React function components and hooks. Shared state flows through `useReducer` + context rather than external state libraries.
- Comments are sparse and usually only used for section dividers or non-obvious behavior; follow that pattern.
- There is no repo-local ESLint or Prettier configuration, so preserve existing formatting and rely on TypeScript/tests for guardrails.
- The codebase favors small focused modules around session monitoring, orchestration, onboarding, and browser interaction.