import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createHmac } from 'node:crypto';
import { mainportalOrders } from '../vendor/mainportalOrders.js';

test('signed portal requests return only owned orders for an active authorized account', async () => {
    const now = Date.parse('2026-11-24T09:00:00.000Z');
    const db = new DatabaseSync(':memory:');
    db.exec(`ATTACH DATABASE ':memory:' AS sso;
        CREATE TABLE sso.users (id INTEGER, status INTEGER);
        CREATE TABLE sso.rights (usr_id INTEGER, srv_id INTEGER, role_id INTEGER);
        CREATE TABLE orders (id INTEGER, good TEXT, quantity INTEGER, status TEXT, sso_author_id INTEGER, received_at TEXT);
        INSERT INTO sso.users VALUES (1,1),(2,1),(3,0),(4,1),(5,1);
        INSERT INTO sso.rights VALUES (1,12,5),(2,12,1),(3,12,1),(4,9,1),(5,12,1);
        INSERT INTO orders VALUES (10,'first',2,'pending',1,NULL),(7,'pickup',1,'waiting',1,NULL),
            (18,'another',2,'waiting',2,NULL),(19,'legacy author',1,'waiting',NULL,NULL),
            (4,'early receipt',1,'received',1,'2026-11-17 08:59:59.999'),
            (5,'cutoff receipt',1,'received',1,'2026-11-17 09:00:00.000'),
            (6,'new receipt',1,'received',1,'2026-11-24 08:59:00.000'),
            (8,'undated receipt',1,'received',1,NULL),(9,'cancelled',1,'cancelled',1,NULL),
            (11,'future receipt',1,'received',1,'2026-11-24 09:00:00.001'),
            (12,'another recent',1,'received',2,'2026-11-24 08:58:00.000');`);
    const handler = mainportalOrders({
        pool: { query: (sql, params) => [db.prepare(sql).all(...params)] },
        getKey: () => 'test-only', serviceId: 12, now: () => now,
        statuses: { PENDING:'pending', PURCHASING:'buy', DELIVERING:'delivery', WAITING:'waiting', RECEIVED:'received', CANCELLED:'cancelled' }
    });
    async function request(actorId, key = 'test-only', age = 0) {
        const body = Buffer.from(JSON.stringify({ actorId }));
        const timestamp = String(Math.floor(now/1000) - age);
        const signature = createHmac('sha256',key).update(timestamp+'\n').update(body).digest('hex');
        return handler({body, get: name => name.endsWith('Timestamp') ? timestamp : signature},
            {set() {}, sendStatus: n => n, json: data => data});
    }
    assert.equal(await request(1,'wrong'),401);
    assert.equal(await request(1,'test-only',90),401);
    assert.equal(await request('1'),400);
    for (const actor of [3,4,99]) assert.equal(await request(actor),403);
    assert.deepEqual(await request(5),{items:[],total:0});
    const {items,total} = await request(1);
    assert.equal(total,4);
    assert.deepEqual(items.map(item => item.id), ['7','10','6','5']);
    assert.deepEqual(items[0],{id:'7',title:'pickup',quantity:1,status:'waiting',receivedAt:null,href:'https://buy.platoniks.ru/myorders'});
    assert.equal(items[3].receivedAt,'2026-11-17T09:00:00.000Z');
    db.close();
});
