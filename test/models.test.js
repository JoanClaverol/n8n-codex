import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeCodex, startDashboard } from './helpers.js';
import { listModels } from '../src/models.js';

test('listModels returns only picker-visible models from Codex app-server', async (t) => {
  const fake = installFakeCodex(t);

  const models = await listModels();

  assert.deepEqual(models, [
    {
      id: 'model-default',
      displayName: 'Default Model',
      description: 'The default test model.',
      isDefault: true,
    },
    {
      id: 'model-fast',
      displayName: 'Fast Model',
      description: 'The fast test model.',
      isDefault: false,
    },
  ]);
  assert.deepEqual(fake.calls().map((call) => call.argv), [['app-server']]);
});

test('model API falls back to the Codex default when discovery fails', async (t) => {
  installFakeCodex(t, { FAKE_CODEX_EXIT: '3' });
  const { url } = await startDashboard(t);

  const response = await fetch(url + '/api/models');
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(body.models, []);
  assert.match(body.warning, /simulated failure/);
});
