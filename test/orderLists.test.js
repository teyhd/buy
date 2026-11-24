import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';

test('closing the eleventh active order leaves one page and no further batch', async t => {
    const { state, connection } = await import('./support/order-test-runtime.js');
    let activeIds = Array.from({ length: 11 }, (_, i) => 11 - i);
    const db = new DatabaseSync(':memory:');
    let statementTime = '2026-11-24 09:15:00.000';
    db.function('UTC_TIMESTAMP', (_precision) => statementTime);
    db.exec("CREATE TABLE orders(id INTEGER, status TEXT, received_at TEXT); INSERT INTO orders VALUES(1, 'Ожидает получения', NULL)");
    const readReceipt = () => db.prepare('SELECT received_at FROM orders WHERE id = 1').get().received_at;
    t.after(() => db.close());

    t.mock.method(connection, 'query', async (sql, params) => {
        if (sql.startsWith('UPDATE orders')) {
            db.prepare(sql).run(...params);
            activeIds = activeIds.filter(id => id !== Number(params.at(-1)));
            return [{ affectedRows: 1 }];
        }
        if (sql.startsWith('SELECT id FROM orders WHERE id')) return [[{ id: params[0] }]];
        if (sql.includes('COUNT(*) AS total')) return [[{ total: activeIds.length }]];
        assert.match(sql, /ORDER BY orders.id DESC LIMIT \? OFFSET \?/);
        const [limit, offset] = params.slice(-2);
        const eligible = sql.includes('orders.id < CAST')
            ? activeIds.filter(id => id < Number(params.at(-3)))
            : activeIds;
        return [eligible.slice(offset, offset + limit).map(id => ({ ...state.order, id }))];
    });

    process.env.PORT = '0';
    await import('../buy.js');
    const server = globalThis.orderTestServer;
    t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
    if (!server.listening) await once(server, 'listening');
    const base = `http://127.0.0.1:${server.address().port}/manageorders`;
    const get = async (query = '') => {
        const response = await fetch(base + query);
        assert.equal(response.status, 200);
        return response.text();
    };
    const secondPage = await get('?page=2');
    assert.match(secondPage, /data-order-row="1"/);
    assert.match(secondPage, /Предыдущая страница/);
    assert.match(await get(), /data-list-more/);

    const setStatus = status => fetch(`${base}/1/status`, {
        method: 'POST',
        headers: { accept: 'application/json' },
        body: new URLSearchParams({ status }),
    });
    const response = await setStatus('Получен');
    assert.equal(response.status, 200);
    assert.equal((await response.json()).closed, true);
    assert.equal(readReceipt(), statementTime);

    const stalePage = await get('?page=2');
    assert.match(stalePage, /<title>Активные заказы<\/title>/);
    assert.equal(stalePage.match(/data-order-row=/g)?.length, 10);
    assert.doesNotMatch(stalePage, /data-list-more/);

    const staleBatch = await get('?page=2&after=2');
    assert.match(staleBatch, /data-list-pagination/);
    assert.doesNotMatch(staleBatch, /<title>|data-order-row=|data-list-more/);

    statementTime = '2026-11-24 10:00:00.000';
    assert.equal((await setStatus('Получен')).status, 200);
    assert.equal(readReceipt(), '2026-11-24 09:15:00.000');
    assert.equal((await setStatus('Ожидает получения')).status, 200);
    assert.equal(readReceipt(), null);
    assert.equal((await setStatus('Получен')).status, 200);
    assert.equal(readReceipt(), statementTime);
});
