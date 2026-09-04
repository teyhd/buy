// Isolated runtime for route tests and browser checks. Never connects to external services.
import { registerHooks } from 'node:module';

export const state = { queries: [], events: [], notifications: [], order: null };
export function reset(link = 'https://wildberries.ru/catalog/old') {
    state.queries = [];
    state.events = [];
    state.notifications = [];
    state.order = {
        id: 17, sso_author_id: 42, good: 'Тестовый товар', quantity: 2, price: '1250.50',
        link, comment: 'Сохранить комментарий', arrival_date: '2099-12-31', status: 'На рассмотрении',
    };
}
reset();

export const connection = {
    threadId: 'fixture',
    async beginTransaction() { state.events.push('begin'); },
    async rollback() { state.events.push('rollback'); },
    async commit() { state.events.push('commit'); },
    release() {},
    async query(sql, params = []) {
        state.queries.push({ sql, params });
        if (/^SELECT/i.test(sql.trim())) {
            if (sql.includes('COUNT(*)')) return [[{ total: 1, price_count: 1250.5 }]];
            if (sql.includes('FROM sso.users')) return [[{ id: 42, label: 'Тестовый пользователь', role_id: 5 }]];
            if (sql.includes('FROM orders')) {
                if (sql.includes('FOR UPDATE')) {
                    state.events.push('lock');
                    if (Number(params[0]) !== state.order.id) return [[]];
                    if (sql.includes('sso_author_id = ?') && Number(params[1]) !== state.order.sso_author_id) return [[]];
                }
                return [[{ ...state.order }]];
            }
            throw new Error(`Unexpected fixture SELECT: ${sql}`);
        }
        if (/^UPDATE orders/i.test(sql.trim())) {
            state.events.push('write');
            if (sql.includes('SET quantity')) {
                [state.order.quantity, state.order.price, state.order.link] = params;
            } else {
                [state.order.good, state.order.quantity, state.order.price, state.order.link,
                    state.order.comment, state.order.arrival_date] = params;
            }
        }
        return [{ insertId: 18, affectedRows: 1 }];
    },
};

const fixtureUrl = import.meta.url;
const root = new URL('../../', fixtureUrl);
const urls = Object.fromEntries(['vendor/ssoAuth.js', 'vendor/logs.js', 'vendor/orderNotifications.js', 'buy.js']
    .map(path => [new URL(path, root).href, path]));
const fromFixture = `import { state, connection } from ${JSON.stringify(fixtureUrl)};`;
const noAuthAction = '(_req, res) => res.status(200).end()';

registerHooks({
    resolve(specifier, context, nextResolve) {
        if (specifier === 'mysql2/promise' || specifier === 'dotenv') {
            return { url: `order-fixture:${specifier}`, shortCircuit: true };
        }
        return nextResolve(specifier, context);
    },
    load(url, context, nextLoad) {
        let source;
        if (url === 'order-fixture:mysql2/promise') {
            source = `${fromFixture} export default { createPool: () => ({ getConnection: async () => connection }) };`;
        } else if (url === 'order-fixture:dotenv') {
            source = 'export function config() {} export default { config };';
        } else if (urls[url] === 'vendor/logs.js') {
            source = 'export function mlog() {}';
        } else if (urls[url] === 'vendor/orderNotifications.js') {
            source = `${fromFixture}
                export function startOrderNotificationDispatcher() {}
                export function hasOrderChanged() { return true; }
                export async function enqueueOrderNotifications(_connection, event) { state.notifications.push(event); }`;
        } else if (urls[url] === 'vendor/ssoAuth.js') {
            source = `export function createSsoAuth() { return {
                attachSession(req, _res, next) {
                    req.session = { isAuthenticated: true, user: { sso_id: 42, id: 42, is_admin: true, name: 'Тестовый пользователь' } };
                    next();
                },
                landingFor: () => '/myorders', login: ${noAuthAction}, callback: ${noAuthAction},
                logout: ${noAuthAction}, me: ${noAuthAction}
            }; }`;
        } else if (urls[url] === 'buy.js') {
            const loaded = nextLoad(url, context);
            return { ...loaded, source: String(loaded.source).replace('app.listen(port,', 'globalThis.orderTestServer = app.listen(port,') };
        }
        return source === undefined ? nextLoad(url, context) : { format: 'module', source, shortCircuit: true };
    },
});
