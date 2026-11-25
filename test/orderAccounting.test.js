import assert from 'node:assert/strict';
import { once } from 'node:events';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

test('order edits keep manual accounting and update amounts and periods derived from the order', async (t) => {
    const { connection } = await import('./support/order-test-runtime.js');
    const db = new DatabaseSync(':memory:');
    t.after(() => db.close());
    db.function('NOW', () => '2026-11-25 00:00:00');
    db.exec(`
        CREATE TABLE orders (
            id INTEGER PRIMARY KEY, good TEXT, quantity INTEGER, price NUMERIC, link TEXT, comment TEXT,
            arrival_date TEXT, sso_author_id INTEGER, status TEXT
        );
        CREATE TABLE order_accounting (
            order_id INTEGER PRIMARY KEY, payment_status TEXT, fiscal_period TEXT, planned_amount NUMERIC,
            actual_amount NUMERIC, document_status TEXT, created_at TEXT, updated_at TEXT
        );
    `);

    let failReadback = false;
    t.mock.method(connection, 'beginTransaction', async () => db.exec('BEGIN'));
    t.mock.method(connection, 'commit', async () => db.exec('COMMIT'));
    t.mock.method(connection, 'rollback', async () => db.exec('ROLLBACK'));
    t.mock.method(connection, 'query', async (sql, params = []) => {
        if (failReadback && sql.startsWith('SELECT id, quantity, price, link FROM orders')) {
            throw new Error('Saved order read failed');
        }
        // Translate the MariaDB syntax used by the edit routes for the local fixture.
        const statement = db.prepare(sql.replace(/\s+FOR UPDATE$/, '')
            .replaceAll('<=>', 'IS')
            .replace('ON DUPLICATE KEY UPDATE', 'ON CONFLICT(order_id) DO UPDATE SET')
            .replace(/VALUES\((\w+)\)/g, 'excluded.$1'));
        return [sql.startsWith('SELECT') ? statement.all(...params) : { affectedRows: statement.run(...params).changes }];
    });

    process.env.PORT = '0';
    await import('../buy.js');
    const server = globalThis.orderTestServer;
    t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
    if (!server.listening) await once(server, 'listening');
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const orderFields = {
        good: 'Тестовый товар', quantity: '3', price: '1800.00', link: 'https://shop.example/item',
        comment: 'Тест', arrival_date: '2100-01-15',
    };
    const edit = (path) => fetch(baseUrl + path, {
        method: 'POST', redirect: 'manual', headers: { accept: 'application/json' }, body: new URLSearchParams(orderFields),
    });
    const seed = ({ plan = 1250.5, period = '2099-12', actual = null, payment = 'not_planned', delivery = '2099-12-31' } = {}) => {
        db.exec('DELETE FROM order_accounting; DELETE FROM orders');
        db.prepare('INSERT INTO orders VALUES (17, ?, 2, 1250.50, ?, ?, ?, 42, ?)').run(
            orderFields.good, orderFields.link, orderFields.comment, delivery, 'На рассмотрении',
        );
        db.prepare('INSERT INTO order_accounting (order_id, payment_status, fiscal_period, planned_amount, actual_amount) VALUES (17, ?, ?, ?, ?)')
            .run(payment, period, plan, actual);
    };
    const readAccounting = () => {
        const row = db.prepare('SELECT planned_amount, fiscal_period FROM order_accounting WHERE order_id = 17').get();
        return [row.planned_amount, row.fiscal_period];
    };

    await t.test('user edits update each automatic field independently', async () => {
        const cases = [
            [{}, [1800, '2100-01']],
            [{ plan: 7777 }, [7777, '2100-01']],
            [{ period: '2099-09' }, [1800, '2099-09']],
            [{ period: null, delivery: null }, [1800, '2100-01']],
            [{ actual: 1250.5 }, [1250.5, '2099-12']],
            [{ payment: 'planned' }, [1250.5, '2099-12']],
        ];
        for (const [values, expected] of cases) {
            seed(values);
            assert.equal((await edit('/myorders/editorder/17')).status, 302);
            assert.deepEqual(readAccounting(), expected);
        }
    });

    await t.test('a real edit creates a missing accounting row for a historical order', async () => {
        seed();
        db.exec('DELETE FROM order_accounting');
        assert.equal((await edit('/myorders/editorder/17')).status, 302);
        assert.deepEqual(readAccounting(), [1800, '2100-01']);
    });

    await t.test('admin edits keep manual plans and update default plans', async () => {
        for (const [startingPlan, expectedPlan] of [[1250.5, 1800], [7777, 7777]]) {
            seed({ plan: startingPlan });
            const response = await edit('/manageorders/editorderadmin/17');
            assert.equal(response.status, 200);
            const data = await response.json();
            assert.equal(data.ok, true);
            assert.equal(Number(data.order.price), 1800);
            assert.deepEqual(readAccounting(), [expectedPlan, '2099-12']);
        }
    });

    await t.test('admin edit rolls back order and accounting if saved values cannot be read', async () => {
        seed();
        failReadback = true;
        assert.equal((await edit('/manageorders/editorderadmin/17')).status, 500);
        assert.equal(db.prepare('SELECT price FROM orders WHERE id = 17').get().price, 1250.5);
        assert.deepEqual(readAccounting(), [1250.5, '2099-12']);
    });
});
