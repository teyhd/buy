import { createHmac, timingSafeEqual } from 'node:crypto';

const mine = 'https://buy.platoniks.ru/myorders';

export function mainportalOrders({ pool, getKey, serviceId, statuses }) {
    const active = [statuses.PENDING, statuses.PURCHASING, statuses.DELIVERING, statuses.WAITING];
    const closed = [statuses.RECEIVED, statuses.CANCELLED];
    return async (req, res) => {
        res.set('Cache-Control', 'no-store');
        const key = getKey();
        if (!key) return res.sendStatus(503);
        const timestamp = req.get('X-Mainportal-Timestamp') || '';
        const signature = req.get('X-Mainportal-Signature') || '';
        if (!/^\d{10}$/.test(timestamp) || Math.abs(Date.now() / 1000 - Number(timestamp)) > 60
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
                `SELECT owned.id, owned.good, owned.quantity, owned.status
                 FROM sso.users AS actor
                 LEFT JOIN (
                    SELECT id, good, quantity, status FROM orders
                    WHERE sso_author_id = ? AND status IN (?, ?, ?, ?)
                    UNION ALL
                    SELECT * FROM (
                        SELECT id, good, quantity, status FROM orders
                        WHERE sso_author_id = ? AND status IN (?, ?) ORDER BY id DESC LIMIT 5
                    ) AS recent_closed
                 ) AS owned ON 1 = 1
                 WHERE actor.id = ? AND actor.status = 1 AND EXISTS (
                    SELECT 1 FROM sso.rights AS rights
                    WHERE rights.usr_id = actor.id AND rights.srv_id = ? AND rights.role_id > 0
                 )
                 ORDER BY CASE WHEN owned.status = ? THEN 0
                    WHEN owned.status IN (?, ?) THEN 2 ELSE 1 END, owned.id DESC`,
                [actorId, ...active, actorId, ...closed, actorId, serviceId, statuses.WAITING, ...closed]
            );
            if (!rows.length) return res.sendStatus(403);
            const items = rows.filter(row => row.id != null).map(row => ({
                id: String(row.id), title: row.good, quantity: row.quantity, status: row.status,
                updatedAt: null, href: mine
            }));
            return res.json({ items, total: items.length });
        } catch {
            return res.sendStatus(503);
        }
    };
}
