import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createHmac } from 'node:crypto';
import { mainportalOrders } from '../vendor/mainportalOrders.js';

test('signed portal requests return only owned orders for an active authorized account', async () => {
    const db = new DatabaseSync(':memory:');
    db.exec(`ATTACH DATABASE ':memory:' AS sso;
        CREATE TABLE sso.users (id INTEGER, status INTEGER);
        CREATE TABLE sso.rights (usr_id INTEGER, srv_id INTEGER, role_id INTEGER);
        CREATE TABLE orders (id INTEGER, good TEXT, quantity INTEGER, status TEXT, sso_author_id INTEGER);
        INSERT INTO sso.users VALUES (1,1),(2,1),(3,0),(4,1),(5,1);
        INSERT INTO sso.rights VALUES (1,12,5),(2,12,1),(3,12,1),(4,9,1),(5,12,1);
        INSERT INTO orders VALUES (10,'first',2,'pending',1),(7,'pickup',1,'waiting',1),
            (18,'another',2,'waiting',2),(19,'legacy',1,'waiting',NULL);`);
    for (let i = 1; i <= 6; i++) db.prepare('INSERT INTO orders VALUES (?, ?, 1, ?, 1)').run(i, 'closed', 'received');
    const handler = mainportalOrders({
        pool: { query: (sql, params) => [db.prepare(sql).all(...params)] },
        getKey: () => 'test-only', serviceId: 12,
        statuses: { PENDING:'pending', PURCHASING:'buy', DELIVERING:'delivery', WAITING:'waiting', RECEIVED:'received', CANCELLED:'cancelled' }
    });
    async function request(actorId, key = 'test-only', age = 0) {
        const body = Buffer.from(JSON.stringify({ actorId }));
        const timestamp = String(Math.floor(Date.now()/1000) - age);
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
    assert.equal(total,7);
    assert.deepEqual(items.map(item => item.id), ['7','10','6','5','4','3','2']);
    assert.deepEqual(items[0],{id:'7',title:'pickup',quantity:1,status:'waiting',updatedAt:null,href:'https://buy.platoniks.ru/myorders'});
    db.close();
});
