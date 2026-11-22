import crypto from 'node:crypto';

const opaqueToken = /^[A-Za-z0-9_-]{32,256}$/;
const context = 'platonportal-service-session-v1';

function sessionKey(cfg) {
  return crypto.createHmac('sha256', cfg.sessionSecret).update(context + ':' + cfg.clientID).digest();
}

function bindingData(binding, subject, cfg) {
  return Buffer.from(JSON.stringify([context, cfg.clientID, String(subject), binding.sid, binding.iss, binding.aud]));
}

function isBinding(binding) {
  return ['sid', 'iss', 'aud'].every(field =>
    typeof binding?.[field] === 'string' && binding[field].length > 0 && binding[field].length <= 256);
}

export class PortalSessionUnavailable extends Error {
  constructor() {
    super('Portal session verification temporarily unavailable');
    this.code = 'portal_session_unavailable';
  }
}

export function bindPortalSession(tokens, claims, cfg) {
  if (tokens.refresh_expires_in === undefined) {
    if (cfg.requireRevocable) throw new Error('Portal session confirmation is required');
    return undefined;
  }
  const binding = { sid: claims.sid, iss: claims.iss, aud: String(claims.aud ?? '') };
  if (typeof tokens.refresh_token !== 'string' || !opaqueToken.test(tokens.refresh_token) ||
      !Number.isSafeInteger(tokens.refresh_expires_in) || tokens.refresh_expires_in <= 0 || !claims.sub || !isBinding(binding)) {
    throw new Error('Invalid portal session confirmation');
  }

  // Keep the portal credential confidential even in the locally signed session cookie.
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', sessionKey(cfg), iv, { authTagLength: 16 });
  cipher.setAAD(bindingData(binding, claims.sub, cfg));
  const content = Buffer.concat([cipher.update(tokens.refresh_token, 'utf8'), cipher.final()]);
  binding.proof = [iv, content, cipher.getAuthTag()].map(value => value.toString('base64url')).join('.');
  return binding;
}

function openProof(binding, subject, cfg) {
  if (!isBinding(binding) || typeof binding.proof !== 'string' || binding.proof.length > 384) return null;
  const parts = binding.proof.split('.').map(value => Buffer.from(value, 'base64url'));
  const [iv, content, tag] = parts;
  if (parts.length !== 3 || iv.length !== 12 || tag.length !== 16) return null;
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', sessionKey(cfg), iv, { authTagLength: 16 });
    decipher.setAAD(bindingData(binding, subject, cfg));
    decipher.setAuthTag(tag);
    const token = Buffer.concat([decipher.update(content), decipher.final()]).toString('utf8');
    return opaqueToken.test(token) ? token : null;
  } catch {
    return null;
  }
}

export async function isPortalSessionActive(binding, subject, cfg) {
  if (binding === undefined) return !cfg.requireRevocable;
  const token = openProof(binding, subject, cfg);
  if (!token || !subject) return false;

  try {
    const endpoint = new URL(cfg.ssoBaseURL.replace(/\/+$/, '') + '/introspect');
    const localHttp = endpoint.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname);
    if ((endpoint.protocol !== 'https:' && !localHttp) || endpoint.username || endpoint.password) throw new PortalSessionUnavailable();
    const response = await fetch(endpoint, {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(2500),
      headers: {
        authorization: 'Basic ' + Buffer.from(cfg.clientID + ':' + cfg.clientSecret).toString('base64'),
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ token, session_only: '1' }),
    });
    if (!response.ok) throw new PortalSessionUnavailable();
    const grant = await response.json();
    if (typeof grant?.active !== 'boolean') throw new PortalSessionUnavailable();
    return grant.active && grant.sid === binding.sid && String(grant.sub) === String(subject) &&
      grant.iss === binding.iss && String(grant.aud) === binding.aud &&
      Number.isSafeInteger(grant.exp) && grant.exp > Math.floor(Date.now() / 1000);
  } catch {
    throw new PortalSessionUnavailable();
  }
}
