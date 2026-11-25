import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import { dateDisplayValue, dateInputValue, isCalendarDate, moscowCalendarDate } from '../vendor/orderDates.js';

test('validates exact calendar dates and uses midnight in Moscow', () => {
    assert.equal(isCalendarDate('2028-02-29'), true);
    assert.equal(isCalendarDate('2027-02-29'), false);
    assert.equal(isCalendarDate('2099-02-30'), false);
    assert.equal(isCalendarDate('2099-2-03'), false);
    assert.equal(isCalendarDate('2099-02-03T00:00:00Z'), false);
    assert.equal(isCalendarDate('0000-01-01'), false);
    assert.equal(moscowCalendarDate(new Date('2026-11-24T20:59:59Z')), '2026-11-24');
    assert.equal(moscowCalendarDate(new Date('2026-11-24T21:00:00Z')), '2026-11-25');
});

test('formats the day from MySQL without UTC conversion', t => {
    const previousTimezone = process.env.TZ;
    t.after(() => {
        if (previousTimezone === undefined) delete process.env.TZ;
        else process.env.TZ = previousTimezone;
    });
    process.env.TZ = 'Europe/Moscow';
    const mysqlDate = new Date(2026, 10, 25);
    assert.equal(mysqlDate.toISOString().slice(0, 10), '2026-11-24');
    assert.equal(dateInputValue(mysqlDate), '2026-11-25');
    assert.equal(dateInputValue('2026-11-25 00:00:00.000'), '2026-11-25');
    assert.equal(dateDisplayValue(mysqlDate), '25.11.2026');
    assert.equal(dateDisplayValue(null), '');

    process.env.TZ = 'America/Los_Angeles';
    assert.equal(dateInputValue('2026-11-25'), '2026-11-25');
    assert.equal(dateDisplayValue('2026-11-25'), '25.11.2026');
});

test('order form validates and preserves the calendar date', async t => {
    const previousTimezone = process.env.TZ;
    process.env.TZ = 'America/Los_Angeles';
    t.mock.method(Date, 'now', () => Date.parse('2026-11-24T21:00:00Z'));
    t.after(() => {
        if (previousTimezone === undefined) delete process.env.TZ;
        else process.env.TZ = previousTimezone;
    });
    const { state, reset } = await import('./support/order-test-runtime.js');
    process.env.PORT = '0';
    await import('../buy.js');
    const server = globalThis.orderTestServer;
    t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
    if (!server.listening) await once(server, 'listening');
    const base = `http://127.0.0.1:${server.address().port}`;
    const today = '2026-11-25';
    const form = { good: 'Fixture product', quantity: '2', price: '1250.50',
        link: 'https://ozon.ru/item', arrival_date: today };
    const post = (fields, accept = 'application/json') => fetch(`${base}/myorders/addorder`, {
        method: 'POST', redirect: 'manual', headers: { accept }, body: new URLSearchParams({ ...form, ...fields }),
    });

    for (const arrival_date of ['2099-02-30', '2099-12-31T01:02:03Z', '2026-11-24']) {
        reset();
        const response = await post({ arrival_date });
        assert.equal(response.status, 422);
        assert.ok((await response.json()).fieldErrors.arrival_date);
        assert.equal(state.queries.some(({ sql }) => /INSERT INTO orders\s/.test(sql)), false);
    }
    const invalidQuantity = await post({ quantity: '0' }, 'text/html');
    assert.equal(invalidQuantity.status, 422);
    assert.match(await invalidQuantity.text(), new RegExp(`id="order-arrival-date" value="${today}"`));
    const response = await post({});
    assert.equal(response.status, 302);
    const orderInsert = state.queries.find(({ sql }) => /INSERT INTO orders\s/.test(sql));
    assert.equal(orderInsert.params[5], today);

    for (const [field, value, message] of [
        ['invoice_date', '2099-02-30', 'Некорректная дата счёта.'],
        ['payment_date', '2099-04-31', 'Некорректная дата оплаты.'],
    ]) {
        reset();
        const accounting = await fetch(`${base}/analytics/17/accounting`, {
            method: 'POST', redirect: 'manual', body: new URLSearchParams({ [field]: value }),
        });
        assert.equal(accounting.status, 302);
        assert.equal(new URL(accounting.headers.get('location'), base).searchParams.get('error'), message);
        assert.equal(state.queries.length, 0);
    }

    const missingOwner = await fetch(`${base}/manageorders/addorder`, {
        method: 'POST', redirect: 'manual', body: new URLSearchParams(form),
    });
    assert.equal(missingOwner.status, 422);
    assert.match(await missingOwner.text(), /Выберите заказчика из SSO\./);
    assert.equal(state.queries.some(({ sql }) => /INSERT INTO orders\s/.test(sql)), false);
});
