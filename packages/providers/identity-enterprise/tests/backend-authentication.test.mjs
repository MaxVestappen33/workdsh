import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { enterpriseBackendAuthentication } from '../dist/backend-authentication.js';

test('backend authentication trusts only live organization sessions and forwards only its cookie', async () => {
  let calls = 0;
  let enabled = true;
  let changePassword = false;
  const server = createServer((req, res) => {
    calls++;
    assert.equal(req.url, '/api/auth/me');
    assert.equal(req.headers.cookie, 'workdsh-admin-session=abcdefghijklmnop');
    assert.equal(req.headers['x-principal-id'], undefined);
    res.setHeader('content-type', 'application/json');
    if (!enabled) { res.writeHead(401).end('{}'); return; }
    res.end(JSON.stringify({ id: 'verified-a', organizationId: 'org', role: 'MEMBER', mustChangePassword: changePassword }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const verify = enterpriseBackendAuthentication(`http://127.0.0.1:${server.address().port}`);
    const req = { headers: { cookie: 'other=secret; workdsh-admin-session=abcdefghijklmnop', 'x-principal-id': 'forged-b' } };
    assert.deepEqual(await verify(req), { principalId: 'verified-a', organizationId: 'org', active: true, role: 'member' });
    for (const cookie of ['', 'workdsh-admin-session=short', 'workdsh-admin-session=abcdefghijklmnop; workdsh-admin-session=abcdefghijklmnop']) {
      await assert.rejects(verify({ headers: { cookie } }), /authentication required/);
    }
    assert.equal(calls, 1);
    changePassword = true;
    await assert.rejects(verify(req), /authentication required/);
    changePassword = false;
    enabled = false;
    await assert.rejects(verify(req), /authentication required/);
    for (const origin of ['http://example.com', 'https://user:pass@example.com', 'https://example.com/path']) {
      assert.throws(() => enterpriseBackendAuthentication(origin));
    }
  } finally { await new Promise(resolve => server.close(resolve)); }
});
