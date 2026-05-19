import dotenv from 'dotenv';
dotenv.config();
import { pool } from '../buy.js';
import { mlog } from './logs.js';

export const ORDER_STATUS = Object.freeze({
    PENDING: 'На рассмотрении',
    PURCHASING: 'Закупаем',
    DELIVERING: 'Доставляем',
    WAITING: 'Ожидает получения',
    RECEIVED: 'Получен',
    CANCELLED: 'Отменен',
});

const ACTIVE_STATUSES = [
    ORDER_STATUS.PENDING,
    ORDER_STATUS.PURCHASING,
    ORDER_STATUS.DELIVERING,
    ORDER_STATUS.WAITING,
];
const CLOSED_STATUSES = [ORDER_STATUS.RECEIVED, ORDER_STATUS.CANCELLED];
const ALL_STATUSES = [...ACTIVE_STATUSES, ...CLOSED_STATUSES];
const STATUS_CLASS = {
    [ORDER_STATUS.PENDING]: 'secondary',
    [ORDER_STATUS.PURCHASING]: 'primary',
    [ORDER_STATUS.DELIVERING]: 'info',
    [ORDER_STATUS.WAITING]: 'warning',
    [ORDER_STATUS.RECEIVED]: 'success',
    [ORDER_STATUS.CANCELLED]: 'dark',
};

const OWNER_LABEL_SQL = `COALESCE(
    NULLIF(sso_users.name, ''),
    NULLIF(sso_users.nickname, ''),
    NULLIF(sso_users.msgnickname, ''),
    legacy_users.email,
    CONCAT('SSO #', orders.sso_author_id),
    CONCAT('Legacy #', orders.author_id)
)`;
const OWNER_TYPE_SQL = `CASE WHEN orders.sso_author_id IS NULL THEN 'legacy' ELSE 'sso' END`;
const OWNER_REF_SQL = `COALESCE(orders.sso_author_id, orders.author_id)`;
const ORDER_OWNER_SELECT = `orders.*,
    ${OWNER_LABEL_SQL} AS owner_label,
    ${OWNER_LABEL_SQL} AS email,
    ${OWNER_TYPE_SQL} AS owner_type,
    ${OWNER_REF_SQL} AS owner_ref`;
const ORDER_OWNER_JOINS = `LEFT JOIN sso.users AS sso_users ON sso_users.id = orders.sso_author_id
    LEFT JOIN users AS legacy_users ON legacy_users.id = orders.author_id`;

function getSsoUserId(req) {
    const id = Number(req.session?.user?.sso_id || req.session?.user?.id);
    if (!Number.isFinite(id) || id <= 0) {
        throw new Error('Missing SSO user id in session');
    }
    return id;
}

function normalizePage(value) {
    const page = Number(value);
    return Number.isInteger(page) && page > 0 ? page : 1;
}

function normalizeId(value) {
    const id = Number(value);
    return Number.isInteger(id) && id > 0 ? id : null;
}

function normalizeText(value) {
    return String(value || '').trim();
}

function normalizePrice(value) {
    const normalized = String(value || '').replace(',', '.').trim();
    return normalized === '' ? null : normalized;
}

function statusOptions(selected, statuses = ALL_STATUSES) {
    return statuses.map((status) => ({
        value: status,
        label: status,
        selected: status === selected,
    }));
}

function isValidStatus(status) {
    return ALL_STATUSES.includes(status);
}

function isActiveStatus(status) {
    return ACTIVE_STATUSES.includes(status);
}

function isClosedStatus(status) {
    return CLOSED_STATUSES.includes(status);
}

function selectOptions(options, selected) {
    return options.map((option) => ({
        ...option,
        selected: option.value === selected,
    }));
}

function scopeOptions(selected) {
    return [
        { value: 'active', label: 'Активные', selected: selected === 'active' },
        { value: 'closed', label: 'Закрытые', selected: selected === 'closed' },
        { value: 'all', label: 'Все', selected: selected === 'all' },
    ];
}

function normalizeScope(value, fallback = 'active') {
    return ['active', 'closed', 'all'].includes(value) ? value : fallback;
}

function shortLink(link) {
    const value = String(link || '').trim();
    if (!value) return '';
    try {
        const url = new URL(value);
        const path = url.pathname === '/' ? '' : url.pathname;
        const label = `${url.host}${path}`;
        return label.length > 48 ? `${label.slice(0, 45)}...` : label;
    } catch {
        return value.length > 48 ? `${value.slice(0, 45)}...` : value;
    }
}

function formatMoney(value) {
    const amount = Number(value || 0);
    return amount.toLocaleString('ru-RU', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    });
}

function formatPercent(value) {
    const amount = Number(value || 0);
    return amount.toLocaleString('ru-RU', {
        minimumFractionDigits: 1,
        maximumFractionDigits: 1,
    });
}

function attachOrderUi(row) {
    return {
        ...row,
        status_class: STATUS_CLASS[row.status] || 'secondary',
        status_options: statusOptions(row.status),
        is_pending: row.status === ORDER_STATUS.PENDING,
        is_closed: isClosedStatus(row.status),
        link_label: shortLink(row.link),
        price_label: formatMoney(row.price),
    };
}

function attachCustomerUi(row) {
    return {
        ...row,
        source_label: row.owner_type === 'sso' ? 'SSO' : 'legacy',
        owner_link: `/dashboard/vieworder/${row.owner_type}/${row.owner_ref}?scope=all`,
        total_price_label: formatMoney(row.total_price),
    };
}

function buildUrl(basePath, query, page) {
    const params = new URLSearchParams();
    Object.entries(query || {}).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') {
            params.set(key, String(value));
        }
    });
    if (page && page > 1) {
        params.set('page', String(page));
    } else {
        params.delete('page');
    }
    const qs = params.toString();
    return qs ? `${basePath}?${qs}` : basePath;
}

function pagination(basePath, page, total, limit, query = {}) {
    const totalPages = Math.ceil(Number(total || 0) / limit);
    const safePage = totalPages > 0 ? Math.min(page, totalPages) : 1;
    const pages = Array.from({ length: totalPages }, (_, i) => {
        const number = i + 1;
        return {
            number,
            isCurrent: number === safePage,
            url: buildUrl(basePath, query, number),
        };
    });

    return {
        page: safePage,
        totalPages,
        prevUrl: safePage > 1 ? buildUrl(basePath, query, safePage - 1) : null,
        nextUrl: safePage < totalPages ? buildUrl(basePath, query, safePage + 1) : null,
        pages,
    };
}

function localReturnTo(value, fallback) {
    const returnTo = String(value || '');
    if (!returnTo || !returnTo.startsWith('/') || returnTo.startsWith('//')) {
        return fallback;
    }
    return returnTo;
}

function buildOrderFilter({ scope = 'active', status = '', q = '' }) {
    const where = [];
    const params = [];

    if (scope === 'active') {
        if (isActiveStatus(status)) {
            where.push('orders.status = ?');
            params.push(status);
        } else {
            where.push('orders.status NOT IN (?, ?)');
            params.push(...CLOSED_STATUSES);
        }
    } else if (scope === 'closed') {
        if (isClosedStatus(status)) {
            where.push('orders.status = ?');
            params.push(status);
        } else {
            where.push('orders.status IN (?, ?)');
            params.push(...CLOSED_STATUSES);
        }
    } else if (isValidStatus(status)) {
        where.push('orders.status = ?');
        params.push(status);
    }

    if (q) {
        const like = `%${q}%`;
        where.push(`(orders.good LIKE ? OR orders.link LIKE ? OR ${OWNER_LABEL_SQL} LIKE ?)`);
        params.push(like, like, like);
    }

    return {
        whereSql: where.length ? `WHERE ${where.join(' AND ')}` : '',
        params,
    };
}

function buildOwnerScopeFilter(ownerColumn, ownerId, scope) {
    const where = [`orders.${ownerColumn} = ?`];
    const params = [ownerId];

    if (scope === 'active') {
        where.push('orders.status NOT IN (?, ?)');
        params.push(...CLOSED_STATUSES);
    } else if (scope === 'closed') {
        where.push('orders.status IN (?, ?)');
        params.push(...CLOSED_STATUSES);
    }

    return {
        whereSql: `WHERE ${where.join(' AND ')}`,
        params,
    };
}

function normalizeDate(value) {
    const text = normalizeText(value);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return '';
    return text;
}

function normalizeNumberFilter(value) {
    const normalized = normalizePrice(value);
    if (normalized === null) return '';
    const number = Number(normalized);
    return Number.isFinite(number) && number >= 0 ? String(number) : '';
}

function normalizeAnalyticsScope(value) {
    const scope = normalizeText(value);
    return ['budget', 'active', 'received', 'closed', 'all'].includes(scope) ? scope : 'budget';
}

function normalizeOwnerType(value) {
    return ['sso', 'legacy'].includes(value) ? value : '';
}

function normalizeDateField(value) {
    return value === 'arrival_date' ? 'arrival_date' : 'creation_date';
}

function analyticsScopeOptions(selected) {
    return selectOptions([
        { value: 'budget', label: 'Бюджет: все кроме отменённых' },
        { value: 'active', label: 'В работе' },
        { value: 'received', label: 'Факт: получено' },
        { value: 'closed', label: 'Закрытые' },
        { value: 'all', label: 'Все заказы' },
    ], selected);
}

function ownerTypeOptions(selected) {
    return selectOptions([
        { value: '', label: 'Все источники' },
        { value: 'sso', label: 'SSO' },
        { value: 'legacy', label: 'Legacy' },
    ], selected);
}

function dateFieldOptions(selected) {
    return selectOptions([
        { value: 'creation_date', label: 'Дата заказа' },
        { value: 'arrival_date', label: 'Желаемая доставка' },
    ], selected);
}

function normalizeAnalyticsFilters(query) {
    const filters = {
        q: normalizeText(query.q || query.search),
        scope: normalizeAnalyticsScope(query.scope),
        status: isValidStatus(query.status) ? query.status : '',
        date_field: normalizeDateField(query.date_field),
        date_from: normalizeDate(query.date_from),
        date_to: normalizeDate(query.date_to),
        owner_type: normalizeOwnerType(query.owner_type),
        price_from: normalizeNumberFilter(query.price_from),
        price_to: normalizeNumberFilter(query.price_to),
    };

    if (filters.price_from && filters.price_to && Number(filters.price_from) > Number(filters.price_to)) {
        const tmp = filters.price_from;
        filters.price_from = filters.price_to;
        filters.price_to = tmp;
    }

    return filters;
}

function buildAnalyticsFilter(filters) {
    const where = [];
    const params = [];
    const dateColumn = filters.date_field === 'arrival_date' ? 'orders.arrival_date' : 'orders.creation_date';

    if (filters.status) {
        where.push('orders.status = ?');
        params.push(filters.status);
    } else if (filters.scope === 'budget') {
        where.push('orders.status != ?');
        params.push(ORDER_STATUS.CANCELLED);
    } else if (filters.scope === 'active') {
        where.push('orders.status NOT IN (?, ?)');
        params.push(...CLOSED_STATUSES);
    } else if (filters.scope === 'received') {
        where.push('orders.status = ?');
        params.push(ORDER_STATUS.RECEIVED);
    } else if (filters.scope === 'closed') {
        where.push('orders.status IN (?, ?)');
        params.push(...CLOSED_STATUSES);
    }

    if (filters.date_from) {
        where.push(`DATE(${dateColumn}) >= ?`);
        params.push(filters.date_from);
    }
    if (filters.date_to) {
        where.push(`DATE(${dateColumn}) <= ?`);
        params.push(filters.date_to);
    }
    if (filters.owner_type === 'sso') {
        where.push('orders.sso_author_id IS NOT NULL');
    } else if (filters.owner_type === 'legacy') {
        where.push('orders.author_id IS NOT NULL');
    }
    if (filters.price_from) {
        where.push('orders.price >= ?');
        params.push(filters.price_from);
    }
    if (filters.price_to) {
        where.push('orders.price <= ?');
        params.push(filters.price_to);
    }
    if (filters.q) {
        const like = `%${filters.q}%`;
        where.push(`(orders.good LIKE ? OR orders.link LIKE ? OR ${OWNER_LABEL_SQL} LIKE ?)`);
        params.push(like, like, like);
    }

    return {
        dateColumn,
        whereSql: where.length ? `WHERE ${where.join(' AND ')}` : '',
        params,
    };
}

function statusOrder(status) {
    const index = ALL_STATUSES.indexOf(status);
    return index === -1 ? ALL_STATUSES.length : index;
}

function attachAnalyticsAmountUi(row, totalAmount = 0) {
    const amount = Number(row.amount || 0);
    return {
        ...row,
        amount_label: formatMoney(amount),
        avg_label: formatMoney(row.avg_amount),
        share_label: totalAmount > 0 ? formatPercent((amount / totalAmount) * 100) : '0,0',
        status_class: STATUS_CLASS[row.status] || 'secondary',
    };
}

function analyticsFilterQuery(filters) {
    return {
        q: filters.q,
        scope: filters.scope,
        status: filters.status,
        date_field: filters.date_field,
        date_from: filters.date_from,
        date_to: filters.date_to,
        owner_type: filters.owner_type,
        price_from: filters.price_from,
        price_to: filters.price_to,
    };
}

function csvValue(value) {
    const text = String(value ?? '');
    return `"${text.replace(/"/g, '""')}"`;
}

function analyticsCsv(rows) {
    const header = [
        'ID',
        'Дата заказа',
        'Желаемая доставка',
        'Автор',
        'Источник',
        'Товар',
        'Количество',
        'Стоимость',
        'Статус',
        'Ссылка',
    ];
    const lines = [header.map(csvValue).join(';')];
    rows.forEach((row) => {
        lines.push([
            row.id,
            row.creation_date ? new Date(row.creation_date).toISOString().slice(0, 10) : '',
            row.arrival_date ? new Date(row.arrival_date).toISOString().slice(0, 10) : '',
            row.owner_label,
            row.owner_type === 'sso' ? 'SSO' : 'legacy',
            row.good,
            row.quantity,
            row.price,
            row.status,
            row.link,
        ].map(csvValue).join(';'));
    });
    return `\uFEFF${lines.join('\n')}`;
}

function renderError(res, req, status, heading, message) {
    return res.status(status).render('error', {
        title: heading,
        code: status,
        heading,
        message,
        isAuthenticated: req.session?.isAuthenticated,
        user: req.session?.user,
    });
}

async function loadMyOrdersPage(connection, req) {
    const ssoUserId = getSsoUserId(req);
    const page = normalizePage(req.query.page);
    const limit = 5;
    const offset = (page - 1) * limit;
    const q = normalizeText(req.query.q || req.query.search);
    const status = isValidStatus(req.query.status) ? req.query.status : '';

    const where = ['sso_author_id = ?'];
    const params = [ssoUserId];
    if (status) {
        where.push('status = ?');
        params.push(status);
    }
    if (q) {
        where.push('(good LIKE ? OR link LIKE ?)');
        params.push(`%${q}%`, `%${q}%`);
    }

    const whereSql = `WHERE ${where.join(' AND ')}`;
    const [rows] = await connection.query(
        `SELECT * FROM orders ${whereSql} ORDER BY id DESC LIMIT ? OFFSET ?`,
        [...params, limit, offset]
    );
    const [totalRows] = await connection.query(`SELECT COUNT(*) AS total FROM orders ${whereSql}`, params);
    const total = Number(totalRows[0]?.total || 0);

    return {
        rows: rows.map(attachOrderUi),
        hasRows: rows.length > 0,
        total,
        filters: { q, status },
        hasFilters: Boolean(q || status),
        statusOptions: statusOptions(status),
        ...pagination('/myorders', page, total, limit, { q, status }),
    };
}

function renderMyOrders(res, req, pageData, alert = null) {
    const flash = alert || req.query.created || req.query.updated || req.query.cancelled || req.query.error || null;
    res.render('myorders', {
        title: 'Мои заказы',
        ...pageData,
        alert: flash,
        isAuthenticated: req.session.isAuthenticated,
        user: req.session.user,
    });
}

// Admin customers list. Local users are legacy-only and are used only for historical order labels.
export const view = async (req, res) => {
    let connection;
    try {
        connection = await pool.getConnection();
        const page = normalizePage(req.query.page);
        const limit = 10;
        const offset = (page - 1) * limit;
        const q = normalizeText(req.query.q || req.query.search);
        const whereSql = q ? `WHERE ${OWNER_LABEL_SQL} LIKE ?` : '';
        const searchParams = q ? [`%${q}%`] : [];

        const groupedSelect = `SELECT
                ${OWNER_TYPE_SQL} AS owner_type,
                ${OWNER_REF_SQL} AS owner_ref,
                ${OWNER_LABEL_SQL} AS owner_label,
                SUM(CASE WHEN orders.status NOT IN (?, ?) THEN 1 ELSE 0 END) AS active_count,
                SUM(CASE WHEN orders.status IN (?, ?) THEN 1 ELSE 0 END) AS closed_count,
                COUNT(*) AS total_count,
                COALESCE(SUM(orders.price), 0) AS total_price
            FROM orders
            ${ORDER_OWNER_JOINS}
            ${whereSql}
            GROUP BY owner_type, owner_ref, owner_label`;

        const [rows] = await connection.query(
            `${groupedSelect}
             ORDER BY owner_label ASC
             LIMIT ? OFFSET ?`,
            [...CLOSED_STATUSES, ...CLOSED_STATUSES, ...searchParams, limit, offset]
        );
        const [totalRows] = await connection.query(
            `SELECT COUNT(*) AS total FROM (
                SELECT ${OWNER_TYPE_SQL} AS owner_type, ${OWNER_REF_SQL} AS owner_ref
                FROM orders
                ${ORDER_OWNER_JOINS}
                ${whereSql}
                GROUP BY owner_type, owner_ref
            ) customers`,
            searchParams
        );
        const total = Number(totalRows[0]?.total || 0);

        res.render('dashboard', {
            title: 'Заказчики',
            rows: rows.map(attachCustomerUi),
            hasRows: rows.length > 0,
            total,
            filters: { q },
            hasFilters: Boolean(q),
            alert: req.query.error || req.query.updated || null,
            ...pagination('/dashboard', page, total, limit, { q }),
            isAuthenticated: req.session.isAuthenticated,
            user: req.session.user,
        });
    } catch (err) {
        console.log(err);
        mlog(err);
        renderError(res, req, 500, 'Ошибка сервера', 'Не удалось загрузить заказчиков.');
    } finally {
        if (connection) connection.release();
    }
};

export const find = async (req, res) => {
    const q = normalizeText(req.body.search || req.body.q);
    res.redirect(buildUrl('/dashboard', { q }, 1));
};

export const vieworder = async (req, res) => {
    let connection;
    try {
        connection = await pool.getConnection();
        const page = normalizePage(req.query.page);
        const limit = 10;
        const offset = (page - 1) * limit;
        const source = req.params.source === 'sso' ? 'sso' : 'legacy';
        const ownerId = normalizeId(req.params.id);
        if (!ownerId) {
            return renderError(res, req, 404, 'Заказчик не найден', 'Некорректный идентификатор заказчика.');
        }

        const ownerColumn = source === 'sso' ? 'sso_author_id' : 'author_id';
        const scope = normalizeScope(req.query.scope, 'active');

        let viewedUser;
        if (source === 'sso') {
            const [rows] = await connection.query(
                `SELECT id,
                    COALESCE(NULLIF(name, ''), NULLIF(nickname, ''), NULLIF(msgnickname, ''), CONCAT('SSO #', id)) AS label,
                    COALESCE(NULLIF(nickname, ''), NULLIF(msgnickname, ''), CONCAT('SSO #', id)) AS email
                 FROM sso.users
                 WHERE id = ?
                 LIMIT 1`,
                [ownerId]
            );
            viewedUser = rows[0] || { id: ownerId, label: `SSO #${ownerId}`, email: `SSO #${ownerId}` };
        } else {
            const [rows] = await connection.query(
                `SELECT id, email,
                    TRIM(CONCAT(COALESCE(surname, ''), ' ', COALESCE(name, ''), ' ', COALESCE(patname, ''))) AS label
                 FROM users
                 WHERE id = ?
                 LIMIT 1`,
                [ownerId]
            );
            viewedUser = rows[0] || { id: ownerId, label: `Legacy #${ownerId}`, email: `Legacy #${ownerId}` };
        }

        const filter = buildOwnerScopeFilter(ownerColumn, ownerId, scope);
        const [totalRows] = await connection.query(
            `SELECT COUNT(*) AS total FROM orders ${filter.whereSql}`,
            filter.params
        );
        const total = Number(totalRows[0]?.total || 0);
        const [orderRows] = await connection.query(
            `SELECT * FROM orders ${filter.whereSql} ORDER BY id DESC LIMIT ? OFFSET ?`,
            [...filter.params, limit, offset]
        );

        res.render('view-order', {
            title: 'История заказчика',
            viewedUser,
            orders: orderRows.map(attachOrderUi),
            hasRows: orderRows.length > 0,
            ownerSource: source,
            scope,
            scopeOptions: scopeOptions(scope),
            total,
            ...pagination(`/dashboard/vieworder/${source}/${ownerId}`, page, total, limit, { scope }),
            isAuthenticated: req.session.isAuthenticated,
            user: req.session.user,
        });
    } catch (err) {
        console.log(err);
        mlog(err);
        renderError(res, req, 500, 'Ошибка сервера', 'Не удалось загрузить историю заказчика.');
    } finally {
        if (connection) connection.release();
    }
};

export const editOrderAdmin = async (req, res) => {
    let connection;
    try {
        connection = await pool.getConnection();
        const [rows] = await connection.query('SELECT * FROM orders WHERE id = ? LIMIT 1', [req.params.id]);
        if (rows.length === 0) {
            return renderError(res, req, 404, 'Заказ не найден', 'Заказ не найден или был удалён.');
        }
        res.render('edit-order-admin', {
            title: 'Изменение заказа',
            order: attachOrderUi(rows[0]),
            isAuthenticated: req.session.isAuthenticated,
            user: req.session.user,
        });
    } catch (err) {
        console.log(err);
        mlog(err);
        renderError(res, req, 500, 'Ошибка сервера', 'Не удалось открыть заказ.');
    } finally {
        if (connection) connection.release();
    }
};

export const updateOrderAdmin = async (req, res) => {
    let connection;
    const { quantity, link } = req.body;
    const price = normalizePrice(req.body.price);
    try {
        connection = await pool.getConnection();
        await connection.query(
            'UPDATE orders SET quantity = ?, price = ?, link = ? WHERE id = ?',
            [quantity, price, link, req.params.id]
        );
        mlog('Заказ был отредактирован администратором.');
        res.redirect('/manageorders?updated=' + encodeURIComponent('Данные заказа обновлены.'));
    } catch (err) {
        console.log(err);
        mlog(err);
        renderError(res, req, 500, 'Ошибка сервера', 'Не удалось обновить заказ.');
    } finally {
        if (connection) connection.release();
    }
};

export const updateOrderStatus = async (req, res) => {
    let connection;
    const status = req.body.status;
    const redirectTo = localReturnTo(req.body.return_to, '/manageorders');
    if (!isValidStatus(status)) {
        return res.redirect(`${redirectTo}${redirectTo.includes('?') ? '&' : '?'}error=${encodeURIComponent('Недопустимый статус заказа.')}`);
    }

    try {
        connection = await pool.getConnection();
        await connection.query('UPDATE orders SET status = ? WHERE id = ?', [status, req.params.id]);
        res.redirect(`${redirectTo}${redirectTo.includes('?') ? '&' : '?'}updated=${encodeURIComponent('Статус заказа обновлён.')}`);
    } catch (err) {
        console.log(err);
        mlog(err);
        res.redirect(`${redirectTo}${redirectTo.includes('?') ? '&' : '?'}error=${encodeURIComponent('Не удалось обновить статус заказа.')}`);
    } finally {
        if (connection) connection.release();
    }
};

export const deleteOrder = async (req, res) => {
    let connection;
    const redirectTo = localReturnTo(req.body.return_to, '/ordersarchive');
    try {
        connection = await pool.getConnection();
        const [result] = await connection.query(
            'DELETE FROM orders WHERE id = ? AND status IN (?, ?)',
            [req.params.id, ...CLOSED_STATUSES]
        );
        const key = result.affectedRows > 0 ? 'removed' : 'error';
        const text = result.affectedRows > 0
            ? 'Закрытый заказ удалён.'
            : 'Удалять можно только закрытые заказы.';
        res.redirect(`${redirectTo}${redirectTo.includes('?') ? '&' : '?'}${key}=${encodeURIComponent(text)}`);
    } catch (err) {
        console.log(err);
        mlog(err);
        res.redirect(`${redirectTo}${redirectTo.includes('?') ? '&' : '?'}error=${encodeURIComponent('Не удалось удалить заказ.')}`);
    } finally {
        if (connection) connection.release();
    }
};

export const viewarchive = async (req, res) => {
    let connection;
    try {
        connection = await pool.getConnection();
        const page = normalizePage(req.query.page);
        const limit = 10;
        const offset = (page - 1) * limit;
        const q = normalizeText(req.query.q || req.query.search);
        const status = isClosedStatus(req.query.status) ? req.query.status : '';
        const filter = buildOrderFilter({ scope: 'closed', status, q });

        const [orderRows] = await connection.query(
            `SELECT ${ORDER_OWNER_SELECT}
             FROM orders
             ${ORDER_OWNER_JOINS}
             ${filter.whereSql}
             ORDER BY orders.id DESC
             LIMIT ? OFFSET ?`,
            [...filter.params, limit, offset]
        );
        const [summaryRows] = await connection.query(
            `SELECT COUNT(*) AS total, COALESCE(SUM(orders.price), 0) AS price_count
             FROM orders
             ${ORDER_OWNER_JOINS}
             ${filter.whereSql}`,
            filter.params
        );
        const total = Number(summaryRows[0]?.total || 0);

        res.render('orders-archive', {
            title: 'Архив заказов',
            orders: orderRows.map(attachOrderUi),
            hasRows: orderRows.length > 0,
            total,
            price_count: formatMoney(summaryRows[0]?.price_count),
            filters: { q, status },
            hasFilters: Boolean(q || status),
            statusOptions: statusOptions(status, CLOSED_STATUSES),
            currentUrl: buildUrl('/ordersarchive', { q, status }, page),
            alert: req.query.removed || req.query.error || null,
            ...pagination('/ordersarchive', page, total, limit, { q, status }),
            isAuthenticated: req.session.isAuthenticated,
            user: req.session.user,
        });
    } catch (err) {
        console.log(err);
        mlog(err);
        renderError(res, req, 500, 'Ошибка сервера', 'Не удалось загрузить архив.');
    } finally {
        if (connection) connection.release();
    }
};

export const manageOrders = async (req, res) => {
    let connection;
    try {
        connection = await pool.getConnection();
        const page = normalizePage(req.query.page);
        const limit = 10;
        const offset = (page - 1) * limit;
        const q = normalizeText(req.query.q || req.query.search);
        const status = isActiveStatus(req.query.status) ? req.query.status : '';
        const filter = buildOrderFilter({ scope: 'active', status, q });

        const [orderRows] = await connection.query(
            `SELECT ${ORDER_OWNER_SELECT}
             FROM orders
             ${ORDER_OWNER_JOINS}
             ${filter.whereSql}
             ORDER BY orders.id DESC
             LIMIT ? OFFSET ?`,
            [...filter.params, limit, offset]
        );
        const [summaryRows] = await connection.query(
            `SELECT COUNT(*) AS total, COALESCE(SUM(orders.price), 0) AS price_count
             FROM orders
             ${ORDER_OWNER_JOINS}
             ${filter.whereSql}`,
            filter.params
        );
        const total = Number(summaryRows[0]?.total || 0);

        res.render('manage-orders', {
            title: 'Активные заказы',
            orders: orderRows.map(attachOrderUi),
            hasRows: orderRows.length > 0,
            total,
            price_count: formatMoney(summaryRows[0]?.price_count),
            filters: { q, status },
            hasFilters: Boolean(q || status),
            statusOptions: statusOptions(status, ACTIVE_STATUSES),
            currentUrl: buildUrl('/manageorders', { q, status }, page),
            alert: req.query.updated || req.query.removed || req.query.error || null,
            ...pagination('/manageorders', page, total, limit, { q, status }),
            isAuthenticated: req.session.isAuthenticated,
            user: req.session.user,
        });
    } catch (err) {
        console.log(err);
        mlog(err);
        renderError(res, req, 500, 'Ошибка сервера', 'Не удалось загрузить активные заказы.');
    } finally {
        if (connection) connection.release();
    }
};

export const orderAnalytics = async (req, res) => {
    let connection;
    try {
        connection = await pool.getConnection();
        const filters = normalizeAnalyticsFilters(req.query);
        const query = analyticsFilterQuery(filters);
        const filter = buildAnalyticsFilter(filters);
        const totalQueryParams = filter.params;

        const [summaryRows] = await connection.query(
            `SELECT
                COUNT(*) AS total_orders,
                COALESCE(SUM(orders.price), 0) AS total_amount,
                COALESCE(SUM(CASE WHEN orders.status != ? THEN orders.price ELSE 0 END), 0) AS budget_amount,
                COALESCE(SUM(CASE WHEN orders.status NOT IN (?, ?) THEN orders.price ELSE 0 END), 0) AS active_amount,
                COALESCE(SUM(CASE WHEN orders.status = ? THEN orders.price ELSE 0 END), 0) AS fact_amount,
                COALESCE(SUM(CASE WHEN orders.status = ? THEN orders.price ELSE 0 END), 0) AS pending_amount,
                COALESCE(SUM(CASE WHEN orders.status = ? THEN orders.price ELSE 0 END), 0) AS cancelled_amount,
                COALESCE(AVG(orders.price), 0) AS avg_amount
             FROM orders
             ${ORDER_OWNER_JOINS}
             ${filter.whereSql}`,
            [
                ORDER_STATUS.CANCELLED,
                ...CLOSED_STATUSES,
                ORDER_STATUS.RECEIVED,
                ORDER_STATUS.PENDING,
                ORDER_STATUS.CANCELLED,
                ...totalQueryParams,
            ]
        );
        const summaryRow = summaryRows[0] || {};
        const totalAmount = Number(summaryRow.total_amount || 0);

        const [statusRowsRaw] = await connection.query(
            `SELECT orders.status, COUNT(*) AS orders_count, COALESCE(SUM(orders.price), 0) AS amount, COALESCE(AVG(orders.price), 0) AS avg_amount
             FROM orders
             ${ORDER_OWNER_JOINS}
             ${filter.whereSql}
             GROUP BY orders.status`,
            filter.params
        );
        const statusRows = statusRowsRaw
            .sort((a, b) => statusOrder(a.status) - statusOrder(b.status))
            .map((row) => attachAnalyticsAmountUi(row, totalAmount));

        const [monthRowsRaw] = await connection.query(
            `SELECT COALESCE(DATE_FORMAT(${filter.dateColumn}, '%Y-%m'), 'Без даты') AS period,
                COUNT(*) AS orders_count,
                COALESCE(SUM(orders.price), 0) AS amount,
                COALESCE(AVG(orders.price), 0) AS avg_amount
             FROM orders
             ${ORDER_OWNER_JOINS}
             ${filter.whereSql}
             GROUP BY period
             ORDER BY period DESC
             LIMIT 24`,
            filter.params
        );
        const monthRows = monthRowsRaw.map((row) => attachAnalyticsAmountUi(row, totalAmount));

        const [ownerRowsRaw] = await connection.query(
            `SELECT ${OWNER_TYPE_SQL} AS owner_type,
                ${OWNER_REF_SQL} AS owner_ref,
                ${OWNER_LABEL_SQL} AS owner_label,
                COUNT(*) AS orders_count,
                COALESCE(SUM(orders.price), 0) AS amount,
                COALESCE(SUM(CASE WHEN orders.status NOT IN (?, ?) THEN orders.price ELSE 0 END), 0) AS active_amount,
                COALESCE(SUM(CASE WHEN orders.status = ? THEN orders.price ELSE 0 END), 0) AS fact_amount,
                COALESCE(AVG(orders.price), 0) AS avg_amount
             FROM orders
             ${ORDER_OWNER_JOINS}
             ${filter.whereSql}
             GROUP BY owner_type, owner_ref, owner_label
             ORDER BY amount DESC
             LIMIT 15`,
            [...CLOSED_STATUSES, ORDER_STATUS.RECEIVED, ...filter.params]
        );
        const ownerRows = ownerRowsRaw.map((row) => ({
            ...attachAnalyticsAmountUi(row, totalAmount),
            source_label: row.owner_type === 'sso' ? 'SSO' : 'legacy',
            owner_link: `/dashboard/vieworder/${row.owner_type}/${row.owner_ref}?scope=all`,
            active_amount_label: formatMoney(row.active_amount),
            fact_amount_label: formatMoney(row.fact_amount),
        }));

        const [productRowsRaw] = await connection.query(
            `SELECT orders.good,
                COUNT(*) AS orders_count,
                COALESCE(SUM(orders.quantity), 0) AS quantity_count,
                COALESCE(SUM(orders.price), 0) AS amount,
                COALESCE(AVG(orders.price), 0) AS avg_amount
             FROM orders
             ${ORDER_OWNER_JOINS}
             ${filter.whereSql}
             GROUP BY orders.good
             ORDER BY amount DESC
             LIMIT 15`,
            filter.params
        );
        const productRows = productRowsRaw.map((row) => attachAnalyticsAmountUi(row, totalAmount));

        const [recentRows] = await connection.query(
            `SELECT ${ORDER_OWNER_SELECT}
             FROM orders
             ${ORDER_OWNER_JOINS}
             ${filter.whereSql}
             ORDER BY ${filter.dateColumn} DESC, orders.id DESC
             LIMIT 50`,
            filter.params
        );

        const summary = {
            total_orders: Number(summaryRow.total_orders || 0),
            total_amount_label: formatMoney(summaryRow.total_amount),
            budget_amount_label: formatMoney(summaryRow.budget_amount),
            active_amount_label: formatMoney(summaryRow.active_amount),
            fact_amount_label: formatMoney(summaryRow.fact_amount),
            pending_amount_label: formatMoney(summaryRow.pending_amount),
            cancelled_amount_label: formatMoney(summaryRow.cancelled_amount),
            avg_amount_label: formatMoney(summaryRow.avg_amount),
        };

        res.render('analytics', {
            title: 'Аналитика заказов',
            filters,
            hasFilters: Boolean(filters.q || filters.status || filters.date_from || filters.date_to || filters.owner_type || filters.price_from || filters.price_to || filters.scope !== 'budget' || filters.date_field !== 'creation_date'),
            summary,
            statusRows,
            monthRows,
            ownerRows,
            productRows,
            recentOrders: recentRows.map(attachOrderUi),
            hasRows: summary.total_orders > 0,
            scopeOptions: analyticsScopeOptions(filters.scope),
            statusOptions: statusOptions(filters.status),
            ownerTypeOptions: ownerTypeOptions(filters.owner_type),
            dateFieldOptions: dateFieldOptions(filters.date_field),
            csvUrl: buildUrl('/analytics/export.csv', query, 1),
            isAuthenticated: req.session.isAuthenticated,
            user: req.session.user,
        });
    } catch (err) {
        console.log(err);
        mlog(err);
        renderError(res, req, 500, 'Ошибка сервера', 'Не удалось загрузить аналитику заказов.');
    } finally {
        if (connection) connection.release();
    }
};

export const orderAnalyticsCsv = async (req, res) => {
    let connection;
    try {
        connection = await pool.getConnection();
        const filters = normalizeAnalyticsFilters(req.query);
        const filter = buildAnalyticsFilter(filters);
        const [rows] = await connection.query(
            `SELECT ${ORDER_OWNER_SELECT}
             FROM orders
             ${ORDER_OWNER_JOINS}
             ${filter.whereSql}
             ORDER BY ${filter.dateColumn} DESC, orders.id DESC`,
            filter.params
        );
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename="purchase-analytics.csv"');
        res.send(analyticsCsv(rows));
    } catch (err) {
        console.log(err);
        mlog(err);
        renderError(res, req, 500, 'Ошибка сервера', 'Не удалось выгрузить аналитику заказов.');
    } finally {
        if (connection) connection.release();
    }
};

export const myorders = async (req, res) => {
    let connection;
    try {
        connection = await pool.getConnection();
        const pageData = await loadMyOrdersPage(connection, req);
        renderMyOrders(res, req, pageData);
    } catch (err) {
        console.log(err);
        mlog(err);
        renderError(res, req, 500, 'Ошибка сервера', 'Не удалось загрузить ваши заказы.');
    } finally {
        if (connection) connection.release();
    }
};

export const findOrders = async (req, res) => {
    const q = normalizeText(req.body.search || req.body.q);
    res.redirect(buildUrl('/myorders', { q }, 1));
};

export const formOrder = (req, res) => {
    res.render('add-order', {
        title: 'Новый заказ',
        order: {},
        cancelUrl: '/myorders',
        isAuthenticated: req.session.isAuthenticated,
        user: req.session.user,
    });
};

export const createOrder = async (req, res) => {
    let connection;
    const { good, quantity, link, arrival_date } = req.body;
    const price = normalizePrice(req.body.price);
    const ssoAuthorId = getSsoUserId(req);
    try {
        connection = await pool.getConnection();
        await connection.query(
            `INSERT INTO orders
             SET good = ?, quantity = ?, price = ?, link = ?, creation_date = NOW(),
                 arrival_date = ?, author_id = NULL, sso_author_id = ?, status = ?`,
            [good, quantity, price, link, arrival_date, ssoAuthorId, ORDER_STATUS.PENDING]
        );
        mlog('Добавлен новый заказ.');
        res.redirect('/myorders?created=' + encodeURIComponent('Новый заказ добавлен.'));
    } catch (err) {
        console.log(err);
        mlog(err);
        renderError(res, req, 500, 'Ошибка сервера', 'Не удалось создать заказ.');
    } finally {
        if (connection) connection.release();
    }
};

export const editOrder = async (req, res) => {
    let connection;
    try {
        connection = await pool.getConnection();
        const [rows] = await connection.query(
            'SELECT * FROM orders WHERE id = ? AND sso_author_id = ? LIMIT 1',
            [req.params.id, getSsoUserId(req)]
        );
        if (rows.length === 0) {
            return res.redirect('/myorders?error=' + encodeURIComponent('Заказ не найден.'));
        }
        if (rows[0].status !== ORDER_STATUS.PENDING) {
            return res.redirect('/myorders?error=' + encodeURIComponent('Редактировать можно только заказ со статусом "На рассмотрении".'));
        }
        res.render('edit-order', {
            title: 'Изменение заказа',
            order: attachOrderUi(rows[0]),
            cancelUrl: '/myorders',
            isAuthenticated: req.session.isAuthenticated,
            user: req.session.user,
        });
    } catch (err) {
        console.log(err);
        mlog(err);
        renderError(res, req, 500, 'Ошибка сервера', 'Не удалось открыть заказ.');
    } finally {
        if (connection) connection.release();
    }
};

export const updateOrder = async (req, res) => {
    let connection;
    const { good, quantity, link, arrival_date } = req.body;
    const price = normalizePrice(req.body.price);
    try {
        connection = await pool.getConnection();
        const [result] = await connection.query(
            `UPDATE orders
             SET good = ?, quantity = ?, price = ?, link = ?, arrival_date = ?
             WHERE id = ? AND sso_author_id = ? AND status = ?`,
            [good, quantity, price, link, arrival_date, req.params.id, getSsoUserId(req), ORDER_STATUS.PENDING]
        );
        if (result.affectedRows === 0) {
            return res.redirect('/myorders?error=' + encodeURIComponent('Заказ уже нельзя редактировать.'));
        }
        mlog('Заказ был отредактирован пользователем.');
        res.redirect('/myorders?updated=' + encodeURIComponent('Данные заказа обновлены.'));
    } catch (err) {
        console.log(err);
        mlog(err);
        renderError(res, req, 500, 'Ошибка сервера', 'Не удалось обновить заказ.');
    } finally {
        if (connection) connection.release();
    }
};

export const cancelOrder = async (req, res) => {
    let connection;
    try {
        connection = await pool.getConnection();
        const [result] = await connection.query(
            'UPDATE orders SET status = ? WHERE id = ? AND sso_author_id = ? AND status = ?',
            [ORDER_STATUS.CANCELLED, req.params.id, getSsoUserId(req), ORDER_STATUS.PENDING]
        );
        const key = result.affectedRows > 0 ? 'cancelled' : 'error';
        const text = result.affectedRows > 0
            ? 'Заказ отменён.'
            : 'Отменить можно только заказ со статусом "На рассмотрении".';
        res.redirect(`/myorders?${key}=${encodeURIComponent(text)}`);
    } catch (err) {
        console.log(err);
        mlog(err);
        renderError(res, req, 500, 'Ошибка сервера', 'Не удалось отменить заказ.');
    } finally {
        if (connection) connection.release();
    }
};
