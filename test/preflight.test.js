// Preflight must detect a PATH-installed codex on every platform. On Windows
// the npm-global codex is a .cmd shim, which execFile refuses without a shell
// — this test fails there if the shell option ever regresses.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeCodex } from './helpers.js';
import { codexVersion } from '../src/preflight.js';

test('codex on PATH is detected (incl. Windows .cmd shim)', async (t) => {
  installFakeCodex(t);
  const out = await codexVersion();
  assert.match(out, /codex-cli 0\.0\.0-fake/);
});
