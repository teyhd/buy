import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import { domainToASCII } from 'node:url';
import { isWildberriesLink, isBlockedOrderLink, BLOCKED_LINK_CODE } from '../public/javascript/order-link-policy.js';

test('checks only the hostname, including IDN labels and scheme-less links', () => {
    for (const domain of ['wildberries.ru', 'www.WILDBERRIES.RU', 'shop-wildberries.example',
        'вайлдбериз.рф', 'магазин-вайлдберриз.рф', 'www.вайлдберриз-магазин.рф']) {
        for (const hostname of [domain, domainToASCII(domain)]) {
            for (const prefix of ['', 'https://', 'http://', '//']) {
                assert.equal(isWildberriesLink(` ${prefix}${hostname}/catalog/1 `), true, `${prefix}${hostname}`);
            }
        }
    }
    for (const link of ['https://ozon.ru/item', 'shop.example/wildberries.ru',
        'https://shop.example/?url=https://wildberries.ru', 'https://wildberries.ru@shop.example/item',
        'https://wb.example/item', '', 'not a url', 'https://xn--.ru']) {
        assert.equal(isWildberriesLink(link), false, link);
    }
    assert.equal(isWildberriesLink('https://shop.example@wildberries.ru/item'), true);
});

test('grandfathers only an unchanged stored link', () => {
    const old = 'https://wildberries.ru/catalog/old';
    assert.equal(isBlockedOrderLink(old, old), false);
    assert.equal(isBlockedOrderLink(' wildberries.ru/catalog/old ', old), false);
    assert.equal(isBlockedOrderLink(`${old}?different=1`, old), true);
    assert.equal(isBlockedOrderLink(old), true);
    assert.equal(isBlockedOrderLink('https://ozon.ru/item', old), false);
});

test('order routes reject new WB links without writes and preserve historical links', async t => {
    const { state, reset } = await import('./support/order-test-runtime.js');
    process.env.PORT = '0';
    await import('../buy.js');
    const server = globalThis.orderTestServer;
    t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
    if (!server.listening) await once(server, 'listening');
    const base = `http://127.0.0.1:${server.address().port}`;
    const payload = { good: 'Тестовый товар', quantity: '3', price: '1250.50',
        link: 'https://wildberries.ru/catalog/new', comment: 'Не терять', arrival_date: '2099-12-31', owner_sso_id: '42' };
    const post = (path, values = {}, accept = 'application/json') => fetch(base + path, {
        method: 'POST', redirect: 'manual', headers: { accept }, body: new URLSearchParams({ ...payload, ...values }),
    });
    const paths = ['/myorders/addorder', '/manageorders/addorder', '/myorders/editorder/17', '/manageorders/editorderadmin/17'];

    for (const path of paths) {
        await t.test(`blocked direct POST: ${path}`, async () => {
            reset();
            const response = await post(path, { originalOrderLink: payload.link, quantity: '0' });
            assert.equal(response.status, 422);
            const data = await response.json();
            assert.equal(data.code, BLOCKED_LINK_CODE);
            assert.ok(data.fieldErrors.link);
            assert.ok(data.fieldErrors.quantity);
            assert.equal(state.queries.some(({ sql }) => /^\s*(INSERT|UPDATE|DELETE)/i.test(sql)), false);
            assert.equal(state.notifications.length, 0);
            if (path.includes('editorder')) assert.deepEqual(state.events, ['begin', 'lock', 'rollback']);
        });
        await t.test(`HTML rejection preserves other fields: ${path}`, async () => {
            reset();
            const response = await post(path, {}, 'text/html');
            assert.equal(response.status, 422);
            const html = await response.text();
            const field = html.match(/<input[^>]*data-order-link-input[^>]*>/)?.[0];
            assert.match(field, /value=""/);
            assert.match(html, /data-server-blocked="true"/);
            assert.match(html, /value="3"/);
            if (!path.includes('editorderadmin')) assert.match(html, /Не терять/);
        });
    }
    for (const path of paths.filter(path => path.includes('editorder'))) {
        await t.test(`unchanged legacy link: ${path}`, async () => {
            reset();
            const old = state.order.link;
            const response = await post(path, { link: old });
            assert.ok([200, 302].includes(response.status));
            assert.equal(state.order.link, old);
            assert.equal(Number(state.order.quantity), 3);
            assert.deepEqual(state.events, ['begin', 'lock', 'write', 'commit']);
        });
        await t.test(`replacement on Ozon then attempted return to WB: ${path}`, async () => {
            reset();
            const old = state.order.link;
            assert.ok([200, 302].includes((await post(path, { link: 'ozon.ru/item' })).status));
            assert.equal(state.order.link, 'https://ozon.ru/item');
            assert.equal((await post(path, { link: old, originalOrderLink: old })).status, 422);
            assert.equal(state.order.link, 'https://ozon.ru/item');
        });
        await t.test(`ordinary validation preserves trusted baseline: ${path}`, async () => {
            reset();
            const response = await post(path, { link: state.order.link, quantity: '0' }, 'text/html');
            assert.equal(response.status, 422);
            const html = await response.text();
            assert.match(html, /data-original-link="https:\/\/wildberries.ru\/catalog\/old"/);
            assert.doesNotMatch(html, /data-server-blocked="true"/);
            assert.ok(!state.events.includes('write'));
        });
    }
    await t.test('ownership is checked before the historical-link exception', async () => {
        reset();
        state.order.sso_author_id = 999;
        const response = await post('/myorders/editorder/17', { link: state.order.link });
        assert.equal(response.status, 302);
        assert.ok(!state.events.includes('write'));
    });
    for (const path of paths.filter(path => path.includes('addorder'))) {
        await t.test(`allowed creation: ${path}`, async () => {
            reset();
            assert.equal((await post(path, { link: 'https://ozon.ru/item' })).status, 302);
            assert.equal(state.queries.filter(({ sql }) => /INSERT INTO orders\s/.test(sql)).length, 1);
            assert.ok(state.events.includes('commit'));
        });
    }
});
