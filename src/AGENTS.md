This is an Expo/React Native mobile application. Prioritize mobile-first patterns, performance, and cross-platform compatibility.

## Expo has changed — do not trust your training data

Expo ships breaking changes every SDK release. APIs you remember are likely renamed, moved, or removed. Before writing any code that touches an Expo, EAS, or React Native API:

1. Read the major version of the `expo` package in `package.json`.
2. Fetch the matching versioned docs: `https://docs.expo.dev/versions/v<major>.0.0/`
3. For anything else, fetch https://docs.expo.dev/llms.txt — an index of all Expo docs with corrections to common LLM misconceptions. Follow its links to the specific page you need; never answer from memory.

## Commands

Use `bunx` instead of `npx` if the project uses bun (`bun.lock` present).

```bash
npx expo install <package>  # ALWAYS use instead of npm/yarn/pnpm/bun add — resolves SDK-compatible versions
npx expo start              # start the dev server
npx expo lint               # lint
npx tsc --noEmit            # typecheck
npx expo-doctor             # diagnose dependency and config issues
npx expo install --fix      # fix incompatible package versions
```

Run lint and typecheck before declaring any task done.

## Navigation & Routing

- Use **Expo Router** for all navigation. Routes live in `src/app/` — every file there is a screen, `_layout.tsx` files define navigators. Keep non-route code (components, hooks, utils) outside `src/app/`.
- Import `Link`, `router`, and `useLocalSearchParams` from `expo-router`.
- Docs: https://docs.expo.dev/router/introduction.md

## Dev: Seeding Test Notes (debug only)

Inject test notes into the local SQLite database via `src/dev/seedNotes.ts` (fixed UUIDs + `INSERT OR IGNORE`, so re-running is idempotent and never duplicates). Two triggers share the same seed data:

```bash
# Option A: deep link — inject 8 notes on demand, app must be running (or it cold-starts first)
adb shell am start -a android.intent.action.VIEW -d "stickynotes://dev-seed?count=8&clear=1"

# Option B: auto-seed on startup — set env var before starting Metro / building
EXPO_PUBLIC_SEED=1 npx expo start
```

- `count`: how many notes to inject (default 8, max 50, contents loop).
- `clear=1`: delete previously seeded notes first (seeded ids only, user-created notes untouched).
- Seeded note ids share the prefix `00000000-0000-4000-8000-` for identification/cleanup.
- Both paths are gated by `__DEV__`; the `dev-seed` route is a no-op in release builds.
- Seeded notes are real rows: they will sync to the logged-in remote account. Use a test account or stay offline.

## Building with EAS

Use EAS to build, sign, and submit the app in the cloud (`eas build`, `eas submit`) and to ship over-the-air updates (`eas update`) — no local Xcode or Android Studio required. Run EAS CLI as `bunx eas-cli <command>` in Bun projects, or `npx eas-cli@latest <command>` otherwise; substitute that for bare `eas` in docs examples.
Docs: https://docs.expo.dev/eas/index.md

## Rules

- If `ios/` and `android/` directories do not exist, they are generated (Continuous Native Generation). Never create or edit them by hand — configure native behavior in `app.json` and config plugins.
- Expo Go only includes its bundled native modules. After adding a library with native code, the app needs a development build: `npx expo run:ios|android` locally, or `eas build --profile development`.
- Prefer recommended Expo modules over third-party libraries, and check your available skills before adding dependencies. Docs: https://docs.expo.dev/versions/latest/index.md
