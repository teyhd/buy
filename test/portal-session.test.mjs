import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import cookieParser from 'cookie-parser';
import express from 'express';

import { createSsoAuth } from '../vendor/ssoAuth.js';

test('portal-issued session remains bound to its active device after OAuth callback', async t => {
  const clientID = 'buy';
  const audience = '12';
  const serviceID = '12';
  const jwtSecret = 'fixture-jwt-secret';
  const sessionSecret = 'fixture-session-secret';
  const clientSecret = 'fixture-client-secret';
  const cookieName = 'fixture.sid';
  const issuer = 'https://portal.example.test/sso';
  const refreshToken = crypto.randomBytes(32).toString('base64url');
  const expiresAt = Math.floor(Date.now() / 1000) + 300;
  const claims = {
    sub: 61, sid: 'fixture-portal-session', iss: issuer, aud: audience,
    exp: expiresAt, right: [{ srv_id: Number(serviceID), role_id: 5 }],
  };
  const activeGrant = { active: true, sub: String(claims.sub), sid: claims.sid, iss: issuer, aud: audience, exp: expiresAt };
  let grant = activeGrant;
  let service;
  let includeProof = false;
  let unavailable = false;
  let introspectionRequests = 0;

  const app = express();
  app.use(express.urlencoded({ extended: false }));
  app.use(cookieParser());
  app.post('/sso/token', (req, res) => {
    assert.equal(req.body.client_id, clientID);
    assert.equal(req.body.client_secret, clientSecret);
    const encoded = [{ alg: 'HS256', typ: 'JWT' }, claims].map(value => Buffer.from(JSON.stringify(value)).toString('base64url')).join('.');
    const signature = crypto.createHmac('sha256', jwtSecret).update(encoded).digest('base64url');
    res.json({
      access_token: encoded + '.' + signature,
      ...(includeProof ? { refresh_token: refreshToken, refresh_expires_in: 300 } : { refresh_token: 'legacy.jwt.value' }),
    });
  });
  app.post('/sso/introspect', (req, res) => {
    introspectionRequests += 1;
    assert.equal(req.get('authorization'), 'Basic ' + Buffer.from(clientID + ':' + clientSecret).toString('base64'));
    assert.deepEqual({ ...req.body }, { token: refreshToken, session_only: '1' });
    return unavailable ? res.sendStatus(503) : res.json(grant);
  });
  app.use((req, res, next) => service(req, res, next));

  const server = await new Promise(resolve => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  const baseURL = 'http://127.0.0.1:' + server.address().port;
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const env = {
    APP_ENV: 'development', AUTH_DISABLED: '0', SSO_BASE_URL: baseURL + '/sso', SSO_CLIENT_ID: clientID,
    SSO_SERVICE_ID: serviceID, SSO_CLIENT_SECRET: clientSecret, JWT_SECRET: jwtSecret,
    AUTH_SESSION_SECRET: sessionSecret, AUTH_SESSION_COOKIE_NAME: cookieName,
    SSO_CALLBACK_URL: 'https://service.example.test/api/cb', SSO_REQUIRE_REVOCABLE: '0',
  };
  const previous = Object.fromEntries(Object.keys(env).map(name => [name, process.env[name]]));
  Object.assign(process.env, env);
  t.after(() => Object.entries(previous).forEach(([name, value]) => value === undefined ? delete process.env[name] : process.env[name] = value));

  function mountAuth() {
    const router = express.Router();
    const auth = createSsoAuth({ pool: { query: async () => [[{ id: 61, name: 'Fixture', status: 1 }]] } });
    router.use(auth.attachSession);
    router.get('/api/auth/login', auth.login);
    router.get('/api/cb', auth.callback);
    router.get('/api/auth/logout', auth.logout);
    router.get('/api/me', auth.me);
    service = router;
  }

  const send = (path, cookie = '') => fetch(baseURL + path, { headers: { cookie, accept: 'application/json' }, redirect: 'manual' });
  const cookieOf = (response, prefix) => response.headers.getSetCookie().map(cookie => cookie.split(';', 1)[0]).filter(cookie => cookie.startsWith(prefix)).at(-1);
  async function signIn() {
    const begin = await send('/api/auth/login');
    assert.equal(begin.status, 302);
    const state = new URL(begin.headers.get('location')).searchParams.get('state');
    const stateCookie = cookieOf(begin, 'fixture.sid.state=');
    const callback = await send('/api/cb?' + new URLSearchParams({ state, code: 'fixture-code' }), stateCookie);
    assert.equal(callback.status, 302);
    const session = callback.headers.getSetCookie().map(cookie => cookie.split(';', 1)[0]).filter(cookie => cookie.startsWith(cookieName + '=')).at(-1);
    assert.ok(session);
    return session;
  }

  mountAuth();
  const legacy = await signIn();
  assert.equal((await send('/api/me', legacy)).status, 200);
  assert.equal(introspectionRequests, 0);

  process.env.SSO_REQUIRE_REVOCABLE = '1';
  mountAuth();
  assert.equal((await send('/api/me', legacy)).status, 401);

  includeProof = true;
  const bound = await signIn();
  const signed = decodeURIComponent(bound.slice(cookieName.length + 1));
  const cookiePayload = Buffer.from(signed.split('.')[0], 'base64url').toString();
  assert.ok(JSON.parse(cookiePayload).portal.proof);
  assert.ok(!cookiePayload.includes(refreshToken));
  assert.equal((await send('/api/me', bound)).status, 200);

  unavailable = true;
  assert.equal((await send('/api/me', bound)).status, 503);
  assert.equal((await send('/api/auth/logout', bound)).status, 302);
  unavailable = false;

  for (const replacement of [{ sid: 'different-session' }, { sub: '62' }, { exp: expiresAt - 400 }, { active: false }]) {
    grant = { ...activeGrant, ...replacement };
    const revoked = await send('/api/me', bound);
    assert.equal(revoked.status, 401);
    assert.ok(revoked.headers.getSetCookie().some(value => value.startsWith(cookieName + '=;')));
  }
});
