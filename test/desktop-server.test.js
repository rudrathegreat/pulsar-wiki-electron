'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { startServer, shutdown } = require('../server');

test('desktop server delegates folder selection and accepts sign-in callbacks from a separate browser', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'pulsarwiki-desktop-'));
  let authorization;
  const results = [];
  const origin = await startServer({
    port: 0,
    desktopOptions: {
      dataDir: directory,
      defaultPath: directory,
      pickFolder: async ({ initialPath }) => initialPath,
      openAuthorization: async url => { authorization = new URL(url); },
      onAuthorizationComplete: result => { results.push(result); },
    },
  });
  t.after(async () => {
    await shutdown();
    await fs.rm(directory, { recursive: true, force: true });
  });

  const root = await fetch(origin);
  const cookie = root.headers.get('set-cookie').split(';')[0];
  await root.text();
  const headers = { Cookie: cookie, Origin: origin, 'Content-Type': 'application/json' };
  const pick = await fetch(`${origin}/api/workspaces/pick`, { method: 'POST', headers, body: '{}' });
  assert.deepEqual(await pick.json(), { path: directory });

  const start = await fetch(`${origin}/auth/chatgpt/start`, { headers: { Cookie: cookie }, redirect: 'manual' });
  assert.equal(start.status, 204);
  assert.equal(authorization.origin, 'https://auth.openai.com');
  assert.equal(authorization.searchParams.get('redirect_uri'), `${origin}/auth/chatgpt/callback`);
  const callback = new URL(`${origin}/auth/chatgpt/callback`);
  callback.searchParams.set('error', 'access_denied');
  const invalid = await fetch(callback);
  await invalid.text();
  assert.deepEqual(results, []);

  callback.searchParams.set('state', authorization.searchParams.get('state'));
  const cancelled = await fetch(callback);
  assert.match(await cancelled.text(), /Return to PulsarWiki/);
  assert.deepEqual(results, ['access-denied']);
});
