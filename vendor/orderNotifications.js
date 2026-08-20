import { mlog } from './logs.js';

const SSO_SERVICE_ID = Number(process.env.SSO_SERVICE_ID || 12);
const ADMIN_ROLE_ID = 5;
const NOTIFICATION_TITLE = 'Закупки';
const DEFAULT_NOTIFY_URL = 'https://msg.platoniks.ru/notify';
const DELIVERY_BATCH_SIZE = 25;
const DELIVERY_INTERVAL_MS = 15_000;
const DELIVERY_TIMEOUT_MS = 5_000;
const STALE_LOCK_MINUTES = 10;
const RETRY_DELAYS_SECONDS = [60, 5 * 60, 15 * 60, 60 * 60];

const EVENT_ACTIONS = Object.freeze({
    created: 'добавил',
    updated: 'изменил',
    cancelled: 'отменил',
});

function compactText(value, limit) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    if (text.length <= limit) return text;
    return `${text.slice(0, Math.max(0, limit - 1)).trimEnd()}…`;
}

function priceLabel(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return '—';
    return numeric.toFixed(2).replace('.', ',');
}

function dateOnly(value) {
    if (!value) return '';
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
        return value.toISOString().slice(0, 10);
    }
    return String(value).slice(0, 10);
}

function actorLabel(actor) {
    return compactText(actor?.name || actor?.owner_label || `SSO #${actor?.ssoId || actor?.id || ''}`, 80);
}

function actorId(actor) {
    const id = Number(actor?.ssoId || actor?.sso_id || actor?.id);
    if (!Number.isInteger(id) || id <= 0) {
        throw new Error('Missing SSO actor id for order notification');
    }
    return id;
}

function toErrorMessage(error) {
    return compactText(error?.message || String(error || 'Unknown notification error'), 500);
}

export function formatOrderNotification(eventType, { order, actor }) {
    const action = EVENT_ACTIONS[eventType];
    if (!action) throw new Error(`Unsupported order notification event: ${eventType}`);

    const orderId = Number(order?.id);
    if (!Number.isInteger(orderId) || orderId <= 0) {
        throw new Error('Missing order id for notification');
    }

    const good = compactText(order.good, 120) || 'без названия';
    const quantity = Number.isFinite(Number(order.quantity)) ? Number(order.quantity) : '—';
    const link = String(order.link || '').trim() || '—';
    const comment = compactText(order.comment, 300);
    const commentPart = comment ? `; комментарий: ${comment}` : '';

    return {
        title: NOTIFICATION_TITLE,
        text: `Пользователь ${actorLabel(actor)} (ID ${actorId(actor)}) ${action} заказ #${orderId}: ${good}. Кол-во: ${quantity}; цена: ${priceLabel(order.price)} ₽; ссылка: ${link}${commentPart}`,
    };
}

export function retryDelaySeconds(attempts) {
    const attempt = Math.max(1, Number(attempts) || 1);
    return RETRY_DELAYS_SECONDS[Math.min(attempt - 1, RETRY_DELAYS_SECONDS.length - 1)];
}

export function hasOrderChanged(existingOrder, nextOrder) {
    return String(existingOrder.good || '') !== String(nextOrder.good || '')
        || Number(existingOrder.quantity) !== Number(nextOrder.quantity)
        || Number(existingOrder.price) !== Number(nextOrder.price)
        || String(existingOrder.link || '') !== String(nextOrder.link || '')
        || String(existingOrder.comment || '') !== String(nextOrder.comment || '')
        || dateOnly(existingOrder.arrival_date) !== dateOnly(nextOrder.arrival_date);
}

export async function enqueueOrderNotifications(connection, { eventType, order, actor }) {
    const notification = formatOrderNotification(eventType, { order, actor });
    const senderId = actorId(actor);
    const [admins] = await connection.query(
        `SELECT DISTINCT sso_users.id
         FROM sso.users AS sso_users
         INNER JOIN sso.rights AS sso_rights
            ON sso_rights.usr_id = sso_users.id
         WHERE sso_users.status = 1
            AND sso_rights.srv_id = ?
            AND sso_rights.role_id = ?`,
        [SSO_SERVICE_ID, ADMIN_ROLE_ID]
    );

    if (admins.length === 0) return 0;

    const values = admins.map(() => '(?, ?, ?, ?, ?, ?)').join(', ');
    const params = admins.flatMap((admin) => [
        Number(admin.id),
        Number(order.id),
        senderId,
        eventType,
        notification.title,
        notification.text,
    ]);
    await connection.query(
        `INSERT INTO notification_outbox
            (recipient_sso_id, order_id, actor_sso_id, event_type, title, message_text)
         VALUES ${values}`,
        params
    );

    return admins.length;
}

function getNotifyConfig(env = process.env) {
    return {
        url: String(env.BALALAIKA_NOTIFY_URL || DEFAULT_NOTIFY_URL).trim(),
        key: String(env.BALALAIKA_NOTIFY_KEY || '').trim(),
    };
}

async function recoverStaleLocks(pool) {
    await pool.query(
        `UPDATE notification_outbox
         SET delivery_state = 'pending', locked_at = NULL, next_attempt_at = NOW()
         WHERE delivery_state = 'sending'
            AND locked_at < DATE_SUB(NOW(), INTERVAL ${STALE_LOCK_MINUTES} MINUTE)`
    );
}

async function claimDueNotifications(pool, limit) {
    let connection;
    try {
        connection = await pool.getConnection();
        await connection.beginTransaction();
        const [rows] = await connection.query(
            `SELECT id, recipient_sso_id, title, message_text, attempts
             FROM notification_outbox
             WHERE delivery_state = 'pending'
                AND next_attempt_at <= NOW()
             ORDER BY id ASC
             LIMIT ?
             FOR UPDATE`,
            [limit]
        );

        if (rows.length > 0) {
            const ids = rows.map((row) => Number(row.id));
            const placeholders = ids.map(() => '?').join(', ');
            await connection.query(
                `UPDATE notification_outbox
                 SET delivery_state = 'sending', locked_at = NOW()
                 WHERE id IN (${placeholders})`,
                ids
            );
        }

        await connection.commit();
        return rows;
    } catch (error) {
        if (connection) {
            try {
                await connection.rollback();
            } catch (rollbackError) {
                mlog(`Не удалось откатить захват очереди уведомлений: ${toErrorMessage(rollbackError)}`);
            }
        }
        throw error;
    } finally {
        if (connection) connection.release();
    }
}

async function isActiveBuyAdmin(pool, ssoUserId) {
    const [rows] = await pool.query(
        `SELECT 1
         FROM sso.users AS sso_users
         INNER JOIN sso.rights AS sso_rights
            ON sso_rights.usr_id = sso_users.id
         WHERE sso_users.id = ?
            AND sso_users.status = 1
            AND sso_rights.srv_id = ?
            AND sso_rights.role_id = ?
         LIMIT 1`,
        [ssoUserId, SSO_SERVICE_ID, ADMIN_ROLE_ID]
    );
    return rows.length > 0;
}

async function markSent(pool, id) {
    await pool.query(
        `UPDATE notification_outbox
         SET delivery_state = 'sent', sent_at = NOW(), locked_at = NULL, last_error = NULL
         WHERE id = ? AND delivery_state = 'sending'`,
        [id]
    );
}

async function markSkipped(pool, id) {
    await pool.query(
        `UPDATE notification_outbox
         SET delivery_state = 'skipped', locked_at = NULL, last_error = NULL
         WHERE id = ? AND delivery_state = 'sending'`,
        [id]
    );
}

async function scheduleRetry(pool, row, error) {
    const attempts = Number(row.attempts || 0) + 1;
    const delaySeconds = retryDelaySeconds(attempts);
    await pool.query(
        `UPDATE notification_outbox
         SET delivery_state = 'pending', attempts = ?,
             next_attempt_at = DATE_ADD(NOW(), INTERVAL ${delaySeconds} SECOND),
             locked_at = NULL, last_error = ?
         WHERE id = ? AND delivery_state = 'sending'`,
        [attempts, toErrorMessage(error), row.id]
    );
}

export async function sendBalalaikaNotification(row, { fetchImpl = globalThis.fetch, config = getNotifyConfig() } = {}) {
    if (!config.key) throw new Error('BALALAIKA_NOTIFY_KEY is not configured');
    if (typeof fetchImpl !== 'function') throw new Error('Global fetch is unavailable');

    const url = new URL(config.url);
    url.searchParams.set('title', row.title);
    url.searchParams.set('txt', row.message_text);
    url.searchParams.set('type', '1');
    url.searchParams.set('who', String(row.recipient_sso_id));

    const response = await fetchImpl(url, {
        method: 'GET',
        headers: { 'X-Notify-Key': config.key },
        signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
    });
    if (!response.ok) {
        throw new Error(`Notification endpoint returned HTTP ${response.status}`);
    }
}

export function createOrderNotificationDispatcher({
    pool,
    fetchImpl = globalThis.fetch,
    config = getNotifyConfig(),
    logger = mlog,
    batchSize = DELIVERY_BATCH_SIZE,
    intervalMs = DELIVERY_INTERVAL_MS,
} = {}) {
    if (!pool) throw new Error('Notification dispatcher requires a database pool');
    let running = false;
    let timer = null;

    async function dispatchOnce() {
        if (running || !config.key) return;
        running = true;
        try {
            await recoverStaleLocks(pool);
            const rows = await claimDueNotifications(pool, batchSize);
            for (const row of rows) {
                try {
                    if (!await isActiveBuyAdmin(pool, row.recipient_sso_id)) {
                        await markSkipped(pool, row.id);
                        continue;
                    }
                    await sendBalalaikaNotification(row, { fetchImpl, config });
                    await markSent(pool, row.id);
                } catch (error) {
                    await scheduleRetry(pool, row, error);
                    logger(`Не удалось отправить уведомление по заказу: ${toErrorMessage(error)}`);
                }
            }
        } finally {
            running = false;
        }
    }

    function start() {
        if (!config.key) {
            logger('Очередь уведомлений Balalaika не запущена: BALALAIKA_NOTIFY_KEY не настроен.');
            return () => {};
        }
        void dispatchOnce().catch((error) => logger(`Ошибка очереди уведомлений: ${toErrorMessage(error)}`));
        timer = setInterval(() => {
            void dispatchOnce().catch((error) => logger(`Ошибка очереди уведомлений: ${toErrorMessage(error)}`));
        }, intervalMs);
        timer.unref?.();
        return () => {
            if (timer) clearInterval(timer);
            timer = null;
        };
    }

    return { dispatchOnce, start };
}

export function startOrderNotificationDispatcher(pool) {
    return createOrderNotificationDispatcher({ pool }).start();
}
