import { createHmac, timingSafeEqual } from 'node:crypto';

const mine = 'https://buy.platoniks.ru/myorders';
const receiptWindowMs = 7 * 24 * 60 * 60 * 1000;
const utcSqlDate = time => new Date(time).toISOString().slice(0, 23).replace('T', ' ');

export function mainportalOrders({ pool, getKey, serviceId, statuses, now = Date.now }) {
    const active = [statuses.PENDING, statuses.PURCHASING, statuses.DELIVERING, statuses.WAITING];
    return async (req, res) => {
        res.set('Cache-Control', 'no-store');
        const key = getKey();
        if (!key) return res.sendStatus(503);
        const timestamp = req.get('X-Mainportal-Timestamp') || '';
        const signature = req.get('X-Mainportal-Signature') || '';
        const time = now();
        if (!/^\d{10}$/.test(timestamp) || Math.abs(time / 1000 - Number(timestamp)) > 60
            || !/^[a-f0-9]{64}$/.test(signature) || !Buffer.isBuffer(req.body)) return res.sendStatus(401);
        const expected = createHmac('sha256', key).update(timestamp + '\n').update(req.body).digest();
        if (!timingSafeEqual(expected, Buffer.from(signature, 'hex'))) return res.sendStatus(401);
        let actorId;
        try {
            ({ actorId } = JSON.parse(req.body));
        } catch {
            return res.sendStatus(400);
        }
        if (!Number.isSafeInteger(actorId) || actorId <= 0) return res.sendStatus(400);
        try {
            const [rows] = await pool.query(
                `SELECT owned.id, owned.good, owned.quantity, owned.status,
                        CAST(owned.received_at AS CHAR) AS receipt_utc
                 FROM sso.users AS actor
                 LEFT JOIN orders AS owned ON owned.sso_author_id = actor.id
                    AND (owned.status IN (?, ?, ?, ?)
                      OR (owned.status = ? AND owned.received_at BETWEEN ? AND ?))
                 WHERE actor.id = ? AND actor.status = 1 AND EXISTS (
                    SELECT 1 FROM sso.rights AS rights
                    WHERE rights.usr_id = actor.id AND rights.srv_id = ? AND rights.role_id > 0
                 )
                 ORDER BY CASE WHEN owned.status = ? THEN 0
                    WHEN owned.status = ? THEN 2 ELSE 1 END, owned.received_at DESC, owned.id DESC`,
                [...active, statuses.RECEIVED, utcSqlDate(time - receiptWindowMs), utcSqlDate(time),
                    actorId, serviceId, statuses.WAITING, statuses.RECEIVED]
            );
            if (!rows.length) return res.sendStatus(403);
            const items = rows.filter(row => row.id != null).map(row => ({
                id: String(row.id), title: row.good, quantity: row.quantity, status: row.status,
                receivedAt: row.receipt_utc ? row.receipt_utc.replace(' ', 'T') + 'Z' : null, href: mine
            }));
            return res.json({ items, total: items.length });
        } catch {
            return res.sendStatus(503);
        }
    };
}
