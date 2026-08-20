import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';

import {
    createOrderNotificationDispatcher,
    enqueueOrderNotifications,
    formatOrderNotification,
    hasOrderChanged,
    retryDelaySeconds,
    sendBalalaikaNotification,
} from '../vendor/orderNotifications.js';

const actor = { ssoId: 42, name: 'Иван Петров' };
const order = {
    id: 17,
    good: 'Ноутбук',
    quantity: 2,
    price: '1250.5',
    link: 'https://shop.example/item',
    arrival_date: '2026-08-20',
};

test('formats a short order notification with current values', () => {
    const notification = formatOrderNotification('created', { order, actor });

    assert.equal(notification.title, 'Закупки');
    assert.match(notification.text, /Пользователь Иван Петров \(ID 42\) добавил заказ #17/);
    assert.match(notification.text, /Кол-во: 2; цена: 1250,50 ₽/);
    assert.match(notification.text, /ссылка: https:\/\/shop\.example\/item/);
});

test('detects only real user order changes', () => {
    assert.equal(hasOrderChanged(order, { ...order }), false);
    assert.equal(hasOrderChanged(order, { ...order, quantity: 3 }), true);
    assert.equal(hasOrderChanged(order, { ...order, arrival_date: '2026-08-21' }), true);
});

test('uses the configured retry schedule and caps it at one hour', () => {
    assert.equal(retryDelaySeconds(1), 60);
    assert.equal(retryDelaySeconds(2), 300);
    assert.equal(retryDelaySeconds(3), 900);
    assert.equal(retryDelaySeconds(4), 3600);
    assert.equal(retryDelaySeconds(99), 3600);
});

test('enqueues one notification for each active administrator', async () => {
    const calls = [];
    const connection = {
        async query(sql, params) {
            calls.push({ sql, params });
            if (sql.includes('SELECT DISTINCT sso_users.id')) {
                return [[{ id: 100 }, { id: 200 }]];
            }
            return [{ affectedRows: 2 }];
        },
    };

    const count = await enqueueOrderNotifications(connection, {
        eventType: 'updated',
        order,
        actor,
    });

    assert.equal(count, 2);
    const insert = calls.find((call) => call.sql.includes('INSERT INTO notification_outbox'));
    assert.ok(insert);
    assert.deepEqual(insert.params.slice(0, 4), [100, 17, 42, 'updated']);
    assert.deepEqual(insert.params.slice(6, 10), [200, 17, 42, 'updated']);
});

test('sends the documented request to a local HTTP stub', async () => {
    let received;
    const server = http.createServer((req, res) => {
        received = { url: req.url, key: req.headers['x-notify-key'] };
        res.writeHead(204).end();
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

    try {
        const address = server.address();
        await sendBalalaikaNotification(
            { recipient_sso_id: 100, title: 'Закупки', message_text: 'Тест' },
            { config: { url: `http://127.0.0.1:${address.port}/notify`, key: 'test-key' } }
        );

        assert.equal(received.key, 'test-key');
        const params = new URL(`http://localhost${received.url}`).searchParams;
        assert.equal(params.get('title'), 'Закупки');
        assert.equal(params.get('txt'), 'Тест');
        assert.equal(params.get('type'), '1');
        assert.equal(params.get('who'), '100');
    } finally {
        await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
});

function dispatcherPool({ activeAdmin, row }) {
    const directQueries = [];
    const connection = {
        async beginTransaction() {},
        async commit() {},
        async rollback() {},
        release() {},
        async query(sql) {
            if (sql.includes('SELECT id, recipient_sso_id')) return [[row]];
            return [{}];
        },
    };
    return {
        directQueries,
        pool: {
            async getConnection() {
                return connection;
            },
            async query(sql, params) {
                directQueries.push({ sql, params });
                if (sql.includes('FROM sso.users AS sso_users')) {
                    return [activeAdmin ? [{ ok: 1 }] : []];
                }
                return [{}];
            },
        },
    };
}

test('skips a queued notification when its recipient lost the admin role', async () => {
    const { pool, directQueries } = dispatcherPool({
        activeAdmin: false,
        row: { id: 1, recipient_sso_id: 100, title: 'Закупки', message_text: 'Тест', attempts: 0 },
    });
    const dispatcher = createOrderNotificationDispatcher({
        pool,
        config: { url: 'http://127.0.0.1/notify', key: 'test-key' },
        fetchImpl: () => {
            throw new Error('The inactive admin must not receive a request');
        },
        logger: () => {},
    });

    await dispatcher.dispatchOnce();

    assert.ok(directQueries.some((call) => call.sql.includes("delivery_state = 'skipped'")));
});

test('returns failed delivery to the retry queue', async () => {
    const { pool, directQueries } = dispatcherPool({
        activeAdmin: true,
        row: { id: 2, recipient_sso_id: 100, title: 'Закупки', message_text: 'Тест', attempts: 0 },
    });
    const dispatcher = createOrderNotificationDispatcher({
        pool,
        config: { url: 'http://127.0.0.1/notify', key: 'test-key' },
        fetchImpl: async () => ({ ok: false, status: 503 }),
        logger: () => {},
    });

    await dispatcher.dispatchOnce();

    const retry = directQueries.find((call) => call.sql.includes("delivery_state = 'pending', attempts"));
    assert.ok(retry);
    assert.deepEqual(retry.params, [1, 'Notification endpoint returned HTTP 503', 2]);
    assert.match(retry.sql, /INTERVAL 60 SECOND/);
});
