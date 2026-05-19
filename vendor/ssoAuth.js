import crypto from 'crypto';
import jwt from 'jsonwebtoken';

const DEFAULT_SESSION_TTL = '8h';

function parseDuration(value) {
    const raw = String(value || DEFAULT_SESSION_TTL).trim();
    const match = raw.match(/^(\d+)(ms|s|m|h|d)?$/i);
    if (!match) return 8 * 60 * 60 * 1000;

    const amount = Number(match[1]);
    const unit = (match[2] || 'ms').toLowerCase();
    if (unit === 'd') return amount * 24 * 60 * 60 * 1000;
    if (unit === 'h') return amount * 60 * 60 * 1000;
    if (unit === 'm') return amount * 60 * 1000;
    if (unit === 's') return amount * 1000;
    return amount;
}

function base64url(input) {
    return Buffer.from(input).toString('base64url');
}

function sign(value, secret) {
    return crypto.createHmac('sha256', secret).update(value).digest('base64url');
}

function signedValue(payload, secret) {
    const encoded = base64url(JSON.stringify(payload));
    return `${encoded}.${sign(encoded, secret)}`;
}

function readSignedValue(value, secret) {
    if (!value || !value.includes('.')) return null;

    const [encoded, signature] = value.split('.', 2);
    const expected = sign(encoded, secret);
    if (signature.length !== expected.length) return null;
    const valid = crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
    if (!valid) return null;

    try {
        return JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    } catch {
        return null;
    }
}

function secureCookie(req) {
    return req.secure || req.headers['x-forwarded-proto'] === 'https' || process.env.NODE_ENV === 'production';
}

function cookieOptions(req, maxAge) {
    return {
        httpOnly: true,
        secure: secureCookie(req),
        sameSite: 'lax',
        path: '/',
        maxAge,
    };
}

function getRequiredConfig(config) {
    const required = [
        'SSO_BASE_URL',
        'SSO_CLIENT_ID',
        'SSO_CLIENT_SECRET',
        'SSO_CALLBACK_URL',
        'SSO_SERVICE_ID',
        'JWT_SECRET',
        'AUTH_SESSION_SECRET',
    ];

    const missing = required.filter((key) => !config[key]);
    if (missing.length > 0) {
        throw new Error(`Missing SSO config: ${missing.join(', ')}`);
    }
}

function maxRoleForService(rights, serviceId) {
    if (!Array.isArray(rights)) return 0;

    return rights.reduce((maxRole, item) => {
        const srvId = Number(item?.srv_id);
        const roleId = Number(item?.role_id);
        if (srvId !== serviceId || !Number.isFinite(roleId)) return maxRole;
        return Math.max(maxRole, roleId);
    }, 0);
}

function displayName(user, fallbackName) {
    return user?.name || user?.nickname || user?.msgnickname || fallbackName || `SSO #${user?.id || ''}`;
}

function landingFor(user) {
    return user?.is_admin ? '/manageorders' : '/myorders';
}

export function createSsoAuth({ pool }) {
    const config = {
        SSO_BASE_URL: process.env.SSO_BASE_URL,
        SSO_CLIENT_ID: process.env.SSO_CLIENT_ID,
        SSO_CLIENT_SECRET: process.env.SSO_CLIENT_SECRET,
        SSO_CALLBACK_URL: process.env.SSO_CALLBACK_URL,
        SSO_SERVICE_ID: Number(process.env.SSO_SERVICE_ID || 0),
        JWT_SECRET: process.env.JWT_SECRET,
        AUTH_SESSION_SECRET: process.env.AUTH_SESSION_SECRET,
        AUTH_SESSION_COOKIE_NAME: process.env.AUTH_SESSION_COOKIE_NAME || 'buy.sid',
        AUTH_SESSION_TTL: process.env.AUTH_SESSION_TTL || DEFAULT_SESSION_TTL,
    };
    const stateCookieName = `${config.AUTH_SESSION_COOKIE_NAME}.state`;
    const ttlMs = parseDuration(config.AUTH_SESSION_TTL);

    function assertConfigured() {
        getRequiredConfig(config);
        if (!Number.isFinite(config.SSO_SERVICE_ID) || config.SSO_SERVICE_ID <= 0) {
            throw new Error('SSO_SERVICE_ID must be a positive number');
        }
    }

    function buildLoginUrl(state) {
        assertConfigured();
        const url = new URL(`${config.SSO_BASE_URL.replace(/\/$/, '')}/authorize`);
        url.searchParams.set('client_id', config.SSO_CLIENT_ID);
        url.searchParams.set('redirect_uri', config.SSO_CALLBACK_URL);
        url.searchParams.set('response_type', 'code');
        url.searchParams.set('state', state);
        url.searchParams.set('audience', String(config.SSO_SERVICE_ID));
        return url.toString();
    }

    function setSessionCookie(req, res, user) {
        const payload = {
            exp: Date.now() + ttlMs,
            user,
        };
        res.cookie(config.AUTH_SESSION_COOKIE_NAME, signedValue(payload, config.AUTH_SESSION_SECRET), cookieOptions(req, ttlMs));
    }

    function clearSessionCookies(res) {
        const base = { path: '/' };
        res.clearCookie(config.AUTH_SESSION_COOKIE_NAME, base);
        res.clearCookie(stateCookieName, base);
    }

    async function fetchSsoUser(ssoUserId) {
        const [rows] = await pool.query(
            `SELECT id, name, nickname, msgnickname, kaf, type, status
             FROM sso.users
             WHERE id = ?
             LIMIT 1`,
            [ssoUserId]
        );
        return rows[0] || null;
    }

    function buildUser(payload, ssoUser, roleId) {
        const ssoId = Number(payload.sub);
        const isAdmin = roleId === 5;
        return {
            id: ssoId,
            sso_id: ssoId,
            name: displayName(ssoUser, payload.name),
            sso_name: ssoUser?.name || payload.name || '',
            nickname: ssoUser?.nickname || '',
            msgnickname: ssoUser?.msgnickname || '',
            kaf: ssoUser?.kaf || null,
            type: ssoUser?.type || null,
            status: ssoUser?.status || null,
            role_id: roleId,
            is_admin: isAdmin ? 1 : 0,
            is_sso: true,
            owner_label: displayName(ssoUser, payload.name),
        };
    }

    function attachSession(req, _res, next) {
        req.session = req.session || {};
        const rawCookie = req.cookies?.[config.AUTH_SESSION_COOKIE_NAME];
        if (!rawCookie || !config.AUTH_SESSION_SECRET) {
            req.session.user = null;
            req.session.isAuthenticated = false;
            return next();
        }

        const payload = readSignedValue(rawCookie, config.AUTH_SESSION_SECRET);
        if (!payload || !payload.exp || payload.exp < Date.now() || !payload.user) {
            req.session.user = null;
            req.session.isAuthenticated = false;
            return next();
        }

        req.session.user = payload.user;
        req.session.isAuthenticated = true;
        return next();
    }

    function login(req, res, next) {
        try {
            assertConfigured();
            const state = crypto.randomBytes(24).toString('base64url');
            const statePayload = {
                state,
                returnTo: typeof req.query.return_to === 'string' ? req.query.return_to : '',
                exp: Date.now() + 10 * 60 * 1000,
            };
            res.cookie(stateCookieName, signedValue(statePayload, config.AUTH_SESSION_SECRET), cookieOptions(req, 10 * 60 * 1000));
            return res.redirect(buildLoginUrl(state));
        } catch (err) {
            return next(err);
        }
    }

    async function callback(req, res, next) {
        try {
            assertConfigured();
            const statePayload = readSignedValue(req.cookies?.[stateCookieName], config.AUTH_SESSION_SECRET);
            if (!statePayload || statePayload.exp < Date.now() || statePayload.state !== req.query.state) {
                clearSessionCookies(res);
                return res.status(400).send('state mismatch');
            }

            const params = new URLSearchParams({
                grant_type: 'authorization_code',
                code: String(req.query.code || ''),
                client_id: config.SSO_CLIENT_ID,
                client_secret: config.SSO_CLIENT_SECRET,
                redirect_uri: config.SSO_CALLBACK_URL,
            });

            const tokenResponse = await fetch(`${config.SSO_BASE_URL.replace(/\/$/, '')}/token`, {
                method: 'POST',
                headers: { 'content-type': 'application/x-www-form-urlencoded' },
                body: params.toString(),
            });

            if (!tokenResponse.ok) {
                clearSessionCookies(res);
                return res.status(502).send('SSO token exchange failed');
            }

            const token = await tokenResponse.json();
            const payload = jwt.verify(token.access_token, config.JWT_SECRET, { algorithms: ['HS256'] });
            const roleId = maxRoleForService(payload.right, config.SSO_SERVICE_ID);
            if (roleId <= 0) {
                clearSessionCookies(res);
                return res.redirect('/not-authorized');
            }

            const ssoUser = await fetchSsoUser(Number(payload.sub));
            if (!ssoUser || Number(ssoUser.status) !== 1) {
                clearSessionCookies(res);
                return res.redirect('/not-authorized');
            }

            const user = buildUser(payload, ssoUser, roleId);
            setSessionCookie(req, res, user);
            res.clearCookie(stateCookieName, { path: '/' });

            const returnTo = statePayload.returnTo && statePayload.returnTo.startsWith('/') ? statePayload.returnTo : landingFor(user);
            return res.redirect(returnTo);
        } catch (err) {
            clearSessionCookies(res);
            return next(err);
        }
    }

    function logout(req, res) {
        clearSessionCookies(res);
        const logoutUrl = new URL(`${config.SSO_BASE_URL.replace(/\/$/, '')}/logout`);
        logoutUrl.searchParams.set('client_id', config.SSO_CLIENT_ID);
        logoutUrl.searchParams.set('post_logout_redirect_uri', 'https://buy.platoniks.ru');
        return res.redirect(logoutUrl.toString());
    }

    function me(req, res) {
        if (!req.session?.user) {
            return res.status(401).json({ login_url: '/api/auth/login' });
        }

        return res.json({
            user: req.session.user,
            landing: landingFor(req.session.user),
        });
    }

    return {
        attachSession,
        login,
        callback,
        logout,
        me,
        landingFor,
    };
}
