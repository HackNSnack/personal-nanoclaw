# Native Module Node.js Version Mismatch

## Symptom

NanoClaw fails to start with a `FATAL Startup failed` error like:

```
The module '.../better-sqlite3/build/Release/better_sqlite3.node'
was compiled against a different Node.js version using
NODE_MODULE_VERSION 137. This version of Node.js requires
NODE_MODULE_VERSION 127. Please try re-compiling or re-installing
the module (for instance, using `npm rebuild` or `npm install`).
```

## Cause

`better-sqlite3` (and any other native Node.js addon) must be compiled against
the **exact** Node.js ABI version that runs it. Each major Node.js release has a
unique `NODE_MODULE_VERSION`. If the module was compiled under one Node version
and you later switch to another, the prebuilt binary is incompatible.

This typically happens when:

- You switch Node versions via `nvm`, `fnm`, or a system upgrade (e.g. nixpkgs).
- You copy `node_modules` from another machine that ran a different Node version.
- `pnpm install` ran under a different Node version than the one starting the service.

## Fix

Recompile the native module against the currently active Node.js version:

```bash
pnpm rebuild better-sqlite3
```

Then restart the service:

```bash
systemctl --user restart nanoclaw.service  # adjust to your service name
```

## Verifying

After rebuilding, confirm the module loads cleanly:

```bash
node -e "require('./node_modules/.pnpm/better-sqlite3@11.10.0/node_modules/better-sqlite3'); console.log('OK')"
```

## Prevention

Always ensure the same Node.js version is active when installing dependencies and
when running the service. The repo's `.nvmrc` pins the expected version (`22`);
use `nvm use` / `fnm use` before running `pnpm install` or `pnpm rebuild`.

After any Node version upgrade, run `pnpm rebuild` to recompile all native addons.
