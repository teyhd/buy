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

const SSO_SERVICE_ID = Number(process.env.SSO_SERVICE_ID || 12);

const PAYMENT_STATUS = Object.freeze({
    NOT_PLANNED: 'not_planned',
    PLANNED: 'planned',
    INVOICE_RECEIVED: 'invoice_received',
    PAID: 'paid',
    CLOSED: 'closed',
});
const ALL_PAYMENT_STATUSES = Object.values(PAYMENT_STATUS);
const PAYMENT_STATUS_META = {
    [PAYMENT_STATUS.NOT_PLANNED]: { label: 'Не запланирована', className: 'secondary' },
    [PAYMENT_STATUS.PLANNED]: { label: 'Запланирована', className: 'primary' },
    [PAYMENT_STATUS.INVOICE_RECEIVED]: { label: 'Счёт получен', className: 'warning' },
    [PAYMENT_STATUS.PAID]: { label: 'Оплачено', className: 'success' },
    [PAYMENT_STATUS.CLOSED]: { label: 'Закрыто', className: 'dark' },
};

const DOCUMENT_STATUS = Object.freeze({
    NONE: 'none',
    INVOICE: 'invoice',
    CLOSING_DOCS: 'closing_docs',
    COMPLETE: 'complete',
});
const ALL_DOCUMENT_STATUSES = Object.values(DOCUMENT_STATUS);
const DOCUMENT_STATUS_META = {
    [DOCUMENT_STATUS.NONE]: { label: 'Нет документов', className: 'secondary' },
    [DOCUMENT_STATUS.INVOICE]: { label: 'Есть счёт', className: 'warning' },
    [DOCUMENT_STATUS.CLOSING_DOCS]: { label: 'Закрывающие', className: 'info' },
    [DOCUMENT_STATUS.COMPLETE]: { label: 'Полный комплект', className: 'success' },
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
const CREATED_BY_LABEL_SQL = `COALESCE(
    NULLIF(creator_users.name, ''),
    NULLIF(creator_users.nickname, ''),
    NULLIF(creator_users.msgnickname, ''),
    CONCAT('SSO #', orders.created_by_sso_id)
)`;
const ORDER_OWNER_SELECT = `orders.*,
    ${OWNER_LABEL_SQL} AS owner_label,
    ${OWNER_LABEL_SQL} AS email,
    ${OWNER_TYPE_SQL} AS owner_type,
    ${OWNER_REF_SQL} AS owner_ref,
    ${CREATED_BY_LABEL_SQL} AS created_by_label`;
const ORDER_OWNER_JOINS = `LEFT JOIN sso.users AS sso_users ON sso_users.id = orders.sso_author_id
    LEFT JOIN users AS legacy_users ON legacy_users.id = orders.author_id
    LEFT JOIN sso.users AS creator_users ON creator_users.id = orders.created_by_sso_id`;
const ACCOUNTING_JOIN = `LEFT JOIN order_accounting AS accounting ON accounting.order_id = orders.id`;
const ORDER_ANALYTICS_SELECT = `${ORDER_OWNER_SELECT},
    accounting.order_id AS accounting_order_id,
    accounting.budget_category,
    accounting.cost_center,
    accounting.supplier_name,
    accounting.invoice_number,
    accounting.invoice_date,
    accounting.payment_status,
    accounting.payment_date,
    accounting.fiscal_period,
    accounting.planned_amount,
    accounting.actual_amount,
    accounting.vat_amount,
    accounting.document_status,
    accounting.comment AS accounting_comment`;

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

function paymentStatusOptions(selected) {
    return ALL_PAYMENT_STATUSES.map((status) => ({
        value: status,
        label: PAYMENT_STATUS_META[status].label,
        selected: status === selected,
    }));
}

function documentStatusOptions(selected) {
    return ALL_DOCUMENT_STATUSES.map((status) => ({
        value: status,
        label: DOCUMENT_STATUS_META[status].label,
        selected: status === selected,
    }));
}

function normalizePaymentStatus(value) {
    return ALL_PAYMENT_STATUSES.includes(value) ? value : '';
}

function normalizeDocumentStatus(value) {
    return ALL_DOCUMENT_STATUSES.includes(value) ? value : '';
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
        created_by_admin: row.created_mode === 'admin_on_behalf',
        created_by_label: row.created_by_label || '',
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

function normalizeMonth(value) {
    const text = normalizeText(value);
    if (!/^\d{4}-\d{2}$/.test(text)) return '';
    const month = Number(text.slice(5, 7));
    return month >= 1 && month <= 12 ? text : '';
}

function normalizeNumberFilter(value) {
    const normalized = normalizePrice(value);
    if (normalized === null) return '';
    const number = Number(normalized);
    return Number.isFinite(number) && number >= 0 ? String(number) : '';
}

function normalizeOptionalMoney(value) {
    const normalized = normalizePrice(value);
    if (normalized === null) return null;
    const number = Number(normalized);
    if (!Number.isFinite(number) || number < 0 || number > 100000000) {
        return undefined;
    }
    return number.toFixed(2);
}

function normalizeLimitedText(value, maxLength = 255) {
    const text = normalizeText(value);
    return text.length > maxLength ? text.slice(0, maxLength) : text;
}

function dateInputValue(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function fiscalPeriodFromDate(value) {
    const date = normalizeDate(value);
    return date ? date.slice(0, 7) : '';
}

function normalizeAnalyticsScope(value) {
    const scope = normalizeText(value);
    return ['budget', 'active', 'fact', 'payments', 'documents', 'variance', 'all'].includes(scope) ? scope : 'budget';
}

function normalizeOwnerType(value) {
    return ['sso', 'legacy'].includes(value) ? value : '';
}

function normalizeDateField(value) {
    return ['creation_date', 'arrival_date', 'invoice_date', 'payment_date'].includes(value) ? value : 'creation_date';
}

function analyticsScopeOptions(selected) {
    return selectOptions([
        { value: 'budget', label: 'Бюджет: план' },
        { value: 'active', label: 'В работе' },
        { value: 'fact', label: 'Факт: оплачено' },
        { value: 'payments', label: 'Оплаты' },
        { value: 'documents', label: 'Документы' },
        { value: 'variance', label: 'Отклонения' },
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
        { value: 'invoice_date', label: 'Дата счёта' },
        { value: 'payment_date', label: 'Дата оплаты' },
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
        fiscal_from: normalizeMonth(query.fiscal_from),
        fiscal_to: normalizeMonth(query.fiscal_to),
        payment_status: normalizePaymentStatus(query.payment_status),
        document_status: normalizeDocumentStatus(query.document_status),
        budget_category: normalizeLimitedText(query.budget_category, 120),
        cost_center: normalizeLimitedText(query.cost_center, 120),
        supplier_name: normalizeLimitedText(query.supplier_name, 160),
        owner_type: normalizeOwnerType(query.owner_type),
        price_from: normalizeNumberFilter(query.price_from),
        price_to: normalizeNumberFilter(query.price_to),
    };

    if (filters.price_from && filters.price_to && Number(filters.price_from) > Number(filters.price_to)) {
        const tmp = filters.price_from;
        filters.price_from = filters.price_to;
        filters.price_to = tmp;
    }
    if (filters.fiscal_from && filters.fiscal_to && filters.fiscal_from > filters.fiscal_to) {
        const tmp = filters.fiscal_from;
        filters.fiscal_from = filters.fiscal_to;
        filters.fiscal_to = tmp;
    }

    return filters;
}

function buildAnalyticsFilter(filters) {
    const where = [];
    const params = [];
    const dateColumnMap = {
        creation_date: 'orders.creation_date',
        arrival_date: 'orders.arrival_date',
        invoice_date: 'accounting.invoice_date',
        payment_date: 'accounting.payment_date',
    };
    const dateColumn = dateColumnMap[filters.date_field] || 'orders.creation_date';
    const amountColumn = 'COALESCE(accounting.actual_amount, accounting.planned_amount, orders.price, 0)';

    if (filters.status) {
        where.push('orders.status = ?');
        params.push(filters.status);
    } else if (filters.scope === 'budget') {
        where.push('orders.status != ?');
        params.push(ORDER_STATUS.CANCELLED);
    } else if (filters.scope === 'active') {
        where.push('orders.status NOT IN (?, ?)');
        params.push(...CLOSED_STATUSES);
    } else if (filters.scope === 'fact') {
        where.push('accounting.payment_status = ?');
        params.push(PAYMENT_STATUS.PAID);
    } else if (filters.scope === 'payments') {
        where.push('accounting.payment_status IN (?, ?)');
        params.push(PAYMENT_STATUS.PLANNED, PAYMENT_STATUS.INVOICE_RECEIVED);
    } else if (filters.scope === 'documents') {
        where.push('(accounting.order_id IS NULL OR accounting.document_status IS NULL OR accounting.document_status != ?)');
        params.push(DOCUMENT_STATUS.COMPLETE);
    } else if (filters.scope === 'variance') {
        where.push('ABS(COALESCE(accounting.planned_amount, orders.price, 0) - COALESCE(accounting.actual_amount, 0)) >= 0.01');
    }

    if (filters.date_from) {
        where.push(`DATE(${dateColumn}) >= ?`);
        params.push(filters.date_from);
    }
    if (filters.date_to) {
        where.push(`DATE(${dateColumn}) <= ?`);
        params.push(filters.date_to);
    }
    if (filters.fiscal_from) {
        where.push('accounting.fiscal_period >= ?');
        params.push(filters.fiscal_from);
    }
    if (filters.fiscal_to) {
        where.push('accounting.fiscal_period <= ?');
        params.push(filters.fiscal_to);
    }
    if (filters.payment_status) {
        where.push('accounting.payment_status = ?');
        params.push(filters.payment_status);
    }
    if (filters.document_status) {
        where.push('accounting.document_status = ?');
        params.push(filters.document_status);
    }
    if (filters.budget_category) {
        where.push('accounting.budget_category LIKE ?');
        params.push(`%${filters.budget_category}%`);
    }
    if (filters.cost_center) {
        where.push('accounting.cost_center LIKE ?');
        params.push(`%${filters.cost_center}%`);
    }
    if (filters.supplier_name) {
        where.push('accounting.supplier_name LIKE ?');
        params.push(`%${filters.supplier_name}%`);
    }
    if (filters.owner_type === 'sso') {
        where.push('orders.sso_author_id IS NOT NULL');
    } else if (filters.owner_type === 'legacy') {
        where.push('orders.author_id IS NOT NULL');
    }
    if (filters.price_from) {
        where.push(`${amountColumn} >= ?`);
        params.push(filters.price_from);
    }
    if (filters.price_to) {
        where.push(`${amountColumn} <= ?`);
        params.push(filters.price_to);
    }
    if (filters.q) {
        const like = `%${filters.q}%`;
        where.push(`(orders.good LIKE ? OR orders.link LIKE ? OR ${OWNER_LABEL_SQL} LIKE ?
            OR accounting.supplier_name LIKE ? OR accounting.invoice_number LIKE ?
            OR accounting.budget_category LIKE ? OR accounting.cost_center LIKE ?)`);
        params.push(like, like, like, like, like, like, like);
    }

    return {
        dateColumn,
        amountColumn,
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

function attachAccountingGroupUi(row, totalAmount = 0) {
    const planned = Number(row.planned_amount || 0);
    const actual = Number(row.actual_amount || 0);
    const variance = planned - actual;
    return {
        ...row,
        planned_amount_label: formatMoney(planned),
        actual_amount_label: formatMoney(actual),
        variance_amount_label: formatMoney(variance),
        share_label: totalAmount > 0 ? formatPercent((planned / totalAmount) * 100) : '0,0',
    };
}

function accountingAttentionReasons(row) {
    const reasons = [];
    if (!row.accounting_order_id) {
        reasons.push('учёт не заполнен');
    }
    if (!normalizeText(row.budget_category)) {
        reasons.push('нет статьи бюджета');
    }
    if (!normalizeText(row.supplier_name)) {
        reasons.push('нет поставщика');
    }
    if ([PAYMENT_STATUS.INVOICE_RECEIVED, PAYMENT_STATUS.PAID, PAYMENT_STATUS.CLOSED].includes(row.payment_status) && !normalizeText(row.invoice_number)) {
        reasons.push('нет номера счёта');
    }
    if ([PAYMENT_STATUS.PLANNED, PAYMENT_STATUS.INVOICE_RECEIVED].includes(row.payment_status) && row.payment_date) {
        const paymentDate = new Date(row.payment_date);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        if (!Number.isNaN(paymentDate.getTime()) && paymentDate < today) {
            reasons.push('оплата просрочена');
        }
    }
    if ((row.document_status || DOCUMENT_STATUS.NONE) !== DOCUMENT_STATUS.COMPLETE) {
        reasons.push('документы не закрыты');
    }
    return reasons;
}

function attachAccountingOrderUi(row) {
    const paymentStatus = row.payment_status || PAYMENT_STATUS.NOT_PLANNED;
    const documentStatus = row.document_status || DOCUMENT_STATUS.NONE;
    const plannedAmount = row.planned_amount ?? row.price ?? '';
    const actualAmount = row.actual_amount ?? '';
    const plannedNumber = Number(plannedAmount || 0);
    const actualNumber = Number(actualAmount || 0);
    const variance = plannedNumber - actualNumber;
    const attentionReasons = accountingAttentionReasons({ ...row, payment_status: paymentStatus, document_status: documentStatus });

    return {
        ...attachOrderUi(row),
        accounting_missing: !row.accounting_order_id,
        budget_category_label: normalizeText(row.budget_category) || 'Без статьи',
        cost_center_label: normalizeText(row.cost_center) || 'Без центра',
        supplier_label: normalizeText(row.supplier_name) || 'Не указан',
        invoice_label: normalizeText(row.invoice_number) || 'Не указан',
        invoice_date_value: dateInputValue(row.invoice_date),
        payment_date_value: dateInputValue(row.payment_date),
        fiscal_period_value: row.fiscal_period || fiscalPeriodFromDate(dateInputValue(row.arrival_date)) || fiscalPeriodFromDate(dateInputValue(row.creation_date)),
        planned_amount_value: plannedAmount,
        actual_amount_value: actualAmount,
        vat_amount_value: row.vat_amount ?? '',
        planned_amount_label: formatMoney(plannedNumber),
        actual_amount_label: row.actual_amount === null || row.actual_amount === undefined ? '0,00' : formatMoney(actualNumber),
        vat_amount_label: row.vat_amount === null || row.vat_amount === undefined ? '0,00' : formatMoney(row.vat_amount),
        variance_amount_label: formatMoney(variance),
        payment_status: paymentStatus,
        payment_status_label: PAYMENT_STATUS_META[paymentStatus]?.label || paymentStatus,
        payment_status_class: PAYMENT_STATUS_META[paymentStatus]?.className || 'secondary',
        payment_status_options: paymentStatusOptions(paymentStatus),
        document_status: documentStatus,
        document_status_label: DOCUMENT_STATUS_META[documentStatus]?.label || documentStatus,
        document_status_class: DOCUMENT_STATUS_META[documentStatus]?.className || 'secondary',
        document_status_options: documentStatusOptions(documentStatus),
        accounting_comment: row.accounting_comment || '',
        attention_reasons: attentionReasons,
        has_attention: attentionReasons.length > 0,
        modal_id: `accounting-${row.id}`,
    };
}

function appendWhere(whereSql, condition) {
    return whereSql ? `${whereSql} AND ${condition}` : `WHERE ${condition}`;
}

function normalizeUrl(value) {
    const text = normalizeText(value);
    if (!text) return '';
    if (/^https?:\/\//i.test(text)) return text;
    return `https://${text}`;
}

function ssoUserLabel(row) {
    return row?.label || `SSO #${row?.id || ''}`;
}

async function loadBuySsoUsers(connection, { q = '', selectedId = null } = {}) {
    const where = ['sso_users.status = 1'];
    const params = [SSO_SERVICE_ID];
    if (q) {
        const like = `%${q}%`;
        where.push(`(
            sso_users.name LIKE ?
            OR sso_users.nickname LIKE ?
            OR sso_users.msgnickname LIKE ?
        )`);
        params.push(like, like, like);
    }

    const [rows] = await connection.query(
        `SELECT sso_users.id,
            COALESCE(
                NULLIF(sso_users.name, ''),
                NULLIF(sso_users.nickname, ''),
                NULLIF(sso_users.msgnickname, ''),
                CONCAT('SSO #', sso_users.id)
            ) AS label,
            MAX(sso_rights.role_id) AS role_id
         FROM sso.users AS sso_users
         INNER JOIN sso.rights AS sso_rights
            ON sso_rights.usr_id = sso_users.id
            AND sso_rights.srv_id = ?
            AND sso_rights.role_id > 0
         WHERE ${where.join(' AND ')}
         GROUP BY sso_users.id, sso_users.name, sso_users.nickname, sso_users.msgnickname
         ORDER BY label ASC
         LIMIT 50`,
        params
    );

    if (selectedId && !rows.some((row) => Number(row.id) === Number(selectedId))) {
        const selected = await loadBuySsoUserById(connection, selectedId);
        if (selected) {
            rows.unshift(selected);
        }
    }

    return rows;
}

async function loadBuySsoUserById(connection, ssoUserId) {
    const id = normalizeId(ssoUserId);
    if (!id) return null;

    const [rows] = await connection.query(
        `SELECT sso_users.id,
            COALESCE(
                NULLIF(sso_users.name, ''),
                NULLIF(sso_users.nickname, ''),
                NULLIF(sso_users.msgnickname, ''),
                CONCAT('SSO #', sso_users.id)
            ) AS label,
            MAX(sso_rights.role_id) AS role_id
         FROM sso.users AS sso_users
         INNER JOIN sso.rights AS sso_rights
            ON sso_rights.usr_id = sso_users.id
            AND sso_rights.srv_id = ?
            AND sso_rights.role_id > 0
         WHERE sso_users.id = ?
            AND sso_users.status = 1
         GROUP BY sso_users.id, sso_users.name, sso_users.nickname, sso_users.msgnickname
         LIMIT 1`,
        [SSO_SERVICE_ID, id]
    );
    return rows[0] || null;
}

function analyticsFilterQuery(filters) {
    return {
        q: filters.q,
        scope: filters.scope,
        status: filters.status,
        date_field: filters.date_field,
        date_from: filters.date_from,
        date_to: filters.date_to,
        fiscal_from: filters.fiscal_from,
        fiscal_to: filters.fiscal_to,
        payment_status: filters.payment_status,
        document_status: filters.document_status,
        budget_category: filters.budget_category,
        cost_center: filters.cost_center,
        supplier_name: filters.supplier_name,
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
    const limit = 10;
    const offset = (page - 1) * limit;
    const q = normalizeText(req.query.q || req.query.search);
    const status = isValidStatus(req.query.status) ? req.query.status : '';

    const where = ['orders.sso_author_id = ?'];
    const params = [ssoUserId];
    if (status) {
        where.push('orders.status = ?');
        params.push(status);
    }
    if (q) {
        where.push('(orders.good LIKE ? OR orders.link LIKE ?)');
        params.push(`%${q}%`, `%${q}%`);
    }

    const whereSql = `WHERE ${where.join(' AND ')}`;
    const [rows] = await connection.query(
        `SELECT ${ORDER_OWNER_SELECT}
         FROM orders
         ${ORDER_OWNER_JOINS}
         ${whereSql}
         ORDER BY orders.id DESC
         LIMIT ? OFFSET ?`,
        [...params, limit, offset]
    );
    const [totalRows] = await connection.query(`SELECT COUNT(*) AS total FROM orders ${whereSql}`, params);
    const [summaryRows] = await connection.query(
        `SELECT
            COUNT(*) AS total_count,
            SUM(CASE WHEN status NOT IN (?, ?) THEN 1 ELSE 0 END) AS active_count,
            SUM(CASE WHEN status IN (?, ?) THEN 1 ELSE 0 END) AS closed_count
         FROM orders
         WHERE sso_author_id = ?`,
        [...CLOSED_STATUSES, ...CLOSED_STATUSES, ssoUserId]
    );
    const total = Number(totalRows[0]?.total || 0);
    const summary = summaryRows[0] || {};

    return {
        rows: rows.map(attachOrderUi),
        hasRows: rows.length > 0,
        total,
        summary: {
            total_count: Number(summary.total_count || 0),
            active_count: Number(summary.active_count || 0),
            closed_count: Number(summary.closed_count || 0),
        },
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
            alert: req.query.created || req.query.updated || req.query.removed || req.query.error || null,
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

        const [summaryRows] = await connection.query(
            `SELECT
                COUNT(*) AS total_orders,
                COALESCE(SUM(COALESCE(accounting.planned_amount, orders.price, 0)), 0) AS planned_total,
                COALESCE(SUM(CASE WHEN orders.status != ? THEN COALESCE(accounting.planned_amount, orders.price, 0) ELSE 0 END), 0) AS budget_amount,
                COALESCE(SUM(CASE WHEN orders.status NOT IN (?, ?) THEN COALESCE(accounting.planned_amount, orders.price, 0) ELSE 0 END), 0) AS active_amount,
                COALESCE(SUM(CASE WHEN accounting.payment_status = ? THEN COALESCE(accounting.planned_amount, orders.price, 0) ELSE 0 END), 0) AS invoice_amount,
                COALESCE(SUM(CASE WHEN accounting.payment_status = ? THEN COALESCE(accounting.actual_amount, accounting.planned_amount, orders.price, 0) ELSE 0 END), 0) AS fact_amount,
                COALESCE(SUM(CASE WHEN accounting.payment_status IN (?, ?) AND accounting.payment_date < CURDATE() THEN COALESCE(accounting.planned_amount, orders.price, 0) ELSE 0 END), 0) AS overdue_amount,
                COALESCE(SUM(CASE WHEN orders.status = ? THEN COALESCE(accounting.planned_amount, orders.price, 0) ELSE 0 END), 0) AS pending_amount,
                COALESCE(SUM(CASE WHEN orders.status = ? THEN COALESCE(accounting.planned_amount, orders.price, 0) ELSE 0 END), 0) AS cancelled_amount,
                COALESCE(SUM(CASE WHEN accounting.document_status IS NULL OR accounting.document_status != ? THEN 1 ELSE 0 END), 0) AS docs_missing_count,
                COALESCE(SUM(CASE WHEN accounting.order_id IS NULL THEN 1 ELSE 0 END), 0) AS accounting_missing_count,
                COALESCE(AVG(COALESCE(accounting.actual_amount, accounting.planned_amount, orders.price, 0)), 0) AS avg_amount,
                COALESCE(SUM(COALESCE(accounting.planned_amount, orders.price, 0) - COALESCE(accounting.actual_amount, 0)), 0) AS variance_amount
             FROM orders
             ${ORDER_OWNER_JOINS}
             ${ACCOUNTING_JOIN}
             ${filter.whereSql}`,
            [
                ORDER_STATUS.CANCELLED,
                ...CLOSED_STATUSES,
                PAYMENT_STATUS.INVOICE_RECEIVED,
                PAYMENT_STATUS.PAID,
                PAYMENT_STATUS.PLANNED,
                PAYMENT_STATUS.INVOICE_RECEIVED,
                ORDER_STATUS.PENDING,
                ORDER_STATUS.CANCELLED,
                DOCUMENT_STATUS.COMPLETE,
                ...filter.params,
            ]
        );
        const summaryRow = summaryRows[0] || {};
        const totalAmount = Number(summaryRow.planned_total || 0);

        const [statusRowsRaw] = await connection.query(
            `SELECT orders.status,
                COUNT(*) AS orders_count,
                COALESCE(SUM(COALESCE(accounting.planned_amount, orders.price, 0)), 0) AS amount,
                COALESCE(AVG(COALESCE(accounting.actual_amount, accounting.planned_amount, orders.price, 0)), 0) AS avg_amount
             FROM orders
             ${ORDER_OWNER_JOINS}
             ${ACCOUNTING_JOIN}
             ${filter.whereSql}
             GROUP BY orders.status`,
            filter.params
        );
        const statusRows = statusRowsRaw
            .sort((a, b) => statusOrder(a.status) - statusOrder(b.status))
            .map((row) => attachAnalyticsAmountUi(row, totalAmount));

        const [monthRowsRaw] = await connection.query(
            `SELECT COALESCE(accounting.fiscal_period, DATE_FORMAT(orders.arrival_date, '%Y-%m'), DATE_FORMAT(orders.creation_date, '%Y-%m'), 'Без периода') AS period,
                COUNT(*) AS orders_count,
                COALESCE(SUM(COALESCE(accounting.planned_amount, orders.price, 0)), 0) AS planned_amount,
                COALESCE(SUM(CASE WHEN accounting.payment_status = ? THEN COALESCE(accounting.actual_amount, accounting.planned_amount, orders.price, 0) ELSE 0 END), 0) AS actual_amount,
                COALESCE(SUM(COALESCE(accounting.planned_amount, orders.price, 0) - COALESCE(accounting.actual_amount, 0)), 0) AS variance_amount
             FROM orders
             ${ORDER_OWNER_JOINS}
             ${ACCOUNTING_JOIN}
             ${filter.whereSql}
             GROUP BY period
             ORDER BY period DESC
             LIMIT 24`,
            [PAYMENT_STATUS.PAID, ...filter.params]
        );
        const monthRows = monthRowsRaw.map((row) => attachAccountingGroupUi(row, totalAmount));

        const [categoryRowsRaw] = await connection.query(
            `SELECT COALESCE(NULLIF(accounting.budget_category, ''), 'Без статьи') AS label,
                COUNT(*) AS orders_count,
                COALESCE(SUM(COALESCE(accounting.planned_amount, orders.price, 0)), 0) AS planned_amount,
                COALESCE(SUM(CASE WHEN accounting.payment_status = ? THEN COALESCE(accounting.actual_amount, accounting.planned_amount, orders.price, 0) ELSE 0 END), 0) AS actual_amount,
                COALESCE(SUM(COALESCE(accounting.planned_amount, orders.price, 0) - COALESCE(accounting.actual_amount, 0)), 0) AS variance_amount
             FROM orders
             ${ORDER_OWNER_JOINS}
             ${ACCOUNTING_JOIN}
             ${filter.whereSql}
             GROUP BY label
             ORDER BY planned_amount DESC
             LIMIT 20`,
            [PAYMENT_STATUS.PAID, ...filter.params]
        );
        const categoryRows = categoryRowsRaw.map((row) => attachAccountingGroupUi(row, totalAmount));

        const [supplierRowsRaw] = await connection.query(
            `SELECT COALESCE(NULLIF(accounting.supplier_name, ''), 'Поставщик не указан') AS label,
                COUNT(*) AS orders_count,
                COALESCE(SUM(COALESCE(accounting.planned_amount, orders.price, 0)), 0) AS planned_amount,
                COALESCE(SUM(CASE WHEN accounting.payment_status = ? THEN COALESCE(accounting.actual_amount, accounting.planned_amount, orders.price, 0) ELSE 0 END), 0) AS actual_amount,
                COALESCE(SUM(COALESCE(accounting.planned_amount, orders.price, 0) - COALESCE(accounting.actual_amount, 0)), 0) AS variance_amount
             FROM orders
             ${ORDER_OWNER_JOINS}
             ${ACCOUNTING_JOIN}
             ${filter.whereSql}
             GROUP BY label
             ORDER BY planned_amount DESC
             LIMIT 20`,
            [PAYMENT_STATUS.PAID, ...filter.params]
        );
        const supplierRows = supplierRowsRaw.map((row) => attachAccountingGroupUi(row, totalAmount));

        const [costCenterRowsRaw] = await connection.query(
            `SELECT COALESCE(NULLIF(accounting.cost_center, ''), 'Центр не указан') AS label,
                COUNT(*) AS orders_count,
                COALESCE(SUM(COALESCE(accounting.planned_amount, orders.price, 0)), 0) AS planned_amount,
                COALESCE(SUM(CASE WHEN accounting.payment_status = ? THEN COALESCE(accounting.actual_amount, accounting.planned_amount, orders.price, 0) ELSE 0 END), 0) AS actual_amount,
                COALESCE(SUM(COALESCE(accounting.planned_amount, orders.price, 0) - COALESCE(accounting.actual_amount, 0)), 0) AS variance_amount
             FROM orders
             ${ORDER_OWNER_JOINS}
             ${ACCOUNTING_JOIN}
             ${filter.whereSql}
             GROUP BY label
             ORDER BY planned_amount DESC
             LIMIT 20`,
            [PAYMENT_STATUS.PAID, ...filter.params]
        );
        const costCenterRows = costCenterRowsRaw.map((row) => attachAccountingGroupUi(row, totalAmount));

        const paymentWhereSql = appendWhere(filter.whereSql, 'accounting.payment_status IN (?, ?)');
        const [paymentRows] = await connection.query(
            `SELECT ${ORDER_ANALYTICS_SELECT}
             FROM orders
             ${ORDER_OWNER_JOINS}
             ${ACCOUNTING_JOIN}
             ${paymentWhereSql}
             ORDER BY accounting.payment_date IS NULL ASC, accounting.payment_date ASC, orders.id DESC
             LIMIT 30`,
            [...filter.params, PAYMENT_STATUS.PLANNED, PAYMENT_STATUS.INVOICE_RECEIVED]
        );

        const attentionWhereSql = appendWhere(
            filter.whereSql,
            `(accounting.order_id IS NULL
                OR NULLIF(accounting.budget_category, '') IS NULL
                OR NULLIF(accounting.supplier_name, '') IS NULL
                OR (accounting.payment_status IN (?, ?) AND accounting.payment_date < CURDATE())
                OR (accounting.payment_status IN (?, ?, ?) AND NULLIF(accounting.invoice_number, '') IS NULL)
                OR accounting.document_status IS NULL
                OR accounting.document_status != ?)`
        );
        const [attentionRows] = await connection.query(
            `SELECT ${ORDER_ANALYTICS_SELECT}
             FROM orders
             ${ORDER_OWNER_JOINS}
             ${ACCOUNTING_JOIN}
             ${attentionWhereSql}
             ORDER BY orders.id DESC
             LIMIT 50`,
            [
                ...filter.params,
                PAYMENT_STATUS.PLANNED,
                PAYMENT_STATUS.INVOICE_RECEIVED,
                PAYMENT_STATUS.INVOICE_RECEIVED,
                PAYMENT_STATUS.PAID,
                PAYMENT_STATUS.CLOSED,
                DOCUMENT_STATUS.COMPLETE,
            ]
        );

        const [detailRows] = await connection.query(
            `SELECT ${ORDER_ANALYTICS_SELECT}
             FROM orders
             ${ORDER_OWNER_JOINS}
             ${ACCOUNTING_JOIN}
             ${filter.whereSql}
             ORDER BY ${filter.dateColumn} IS NULL ASC, ${filter.dateColumn} DESC, orders.id DESC
             LIMIT 50`,
            filter.params
        );
        const paymentOrders = paymentRows.map(attachAccountingOrderUi);
        const attentionOrders = attentionRows.map(attachAccountingOrderUi);
        const detailOrders = detailRows.map(attachAccountingOrderUi);
        const accountingFormMap = new Map();
        [...attentionOrders, ...paymentOrders, ...detailOrders].forEach((row) => {
            accountingFormMap.set(row.id, row);
        });

        const summary = {
            total_orders: Number(summaryRow.total_orders || 0),
            total_amount_label: formatMoney(summaryRow.planned_total),
            budget_amount_label: formatMoney(summaryRow.budget_amount),
            active_amount_label: formatMoney(summaryRow.active_amount),
            invoice_amount_label: formatMoney(summaryRow.invoice_amount),
            fact_amount_label: formatMoney(summaryRow.fact_amount),
            overdue_amount_label: formatMoney(summaryRow.overdue_amount),
            pending_amount_label: formatMoney(summaryRow.pending_amount),
            cancelled_amount_label: formatMoney(summaryRow.cancelled_amount),
            variance_amount_label: formatMoney(summaryRow.variance_amount),
            docs_missing_count: Number(summaryRow.docs_missing_count || 0),
            accounting_missing_count: Number(summaryRow.accounting_missing_count || 0),
            avg_amount_label: formatMoney(summaryRow.avg_amount),
        };

        res.render('analytics', {
            title: 'Аналитика и учёт',
            filters,
            hasFilters: Boolean(filters.q || filters.status || filters.date_from || filters.date_to || filters.fiscal_from || filters.fiscal_to || filters.payment_status || filters.document_status || filters.budget_category || filters.cost_center || filters.supplier_name || filters.owner_type || filters.price_from || filters.price_to || filters.scope !== 'budget' || filters.date_field !== 'creation_date'),
            summary,
            statusRows,
            monthRows,
            categoryRows,
            supplierRows,
            costCenterRows,
            paymentRows: paymentOrders,
            attentionRows: attentionOrders,
            detailRows: detailOrders,
            accountingForms: [...accountingFormMap.values()],
            hasRows: summary.total_orders > 0,
            scopeOptions: analyticsScopeOptions(filters.scope),
            statusOptions: statusOptions(filters.status),
            paymentStatusOptions: [{ value: '', label: 'Все оплаты', selected: !filters.payment_status }, ...paymentStatusOptions(filters.payment_status)],
            documentStatusOptions: [{ value: '', label: 'Все документы', selected: !filters.document_status }, ...documentStatusOptions(filters.document_status)],
            ownerTypeOptions: ownerTypeOptions(filters.owner_type),
            dateFieldOptions: dateFieldOptions(filters.date_field),
            currentUrl: buildUrl('/analytics', query, 1),
            alert: req.query.updated || req.query.error || null,
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
             ${ACCOUNTING_JOIN}
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

export const updateOrderAccounting = async (req, res) => {
    let connection;
    const orderId = normalizeId(req.params.id);
    const redirectTo = localReturnTo(req.body.return_to, '/analytics');
    const redirectWith = (key, text) => {
        res.redirect(`${redirectTo}${redirectTo.includes('?') ? '&' : '?'}${key}=${encodeURIComponent(text)}`);
    };

    if (!orderId) {
        return redirectWith('error', 'Некорректный номер заказа.');
    }

    const paymentStatus = normalizePaymentStatus(req.body.payment_status) || PAYMENT_STATUS.NOT_PLANNED;
    const documentStatus = normalizeDocumentStatus(req.body.document_status) || DOCUMENT_STATUS.NONE;
    const plannedAmount = normalizeOptionalMoney(req.body.planned_amount);
    const actualAmount = normalizeOptionalMoney(req.body.actual_amount);
    const vatAmount = normalizeOptionalMoney(req.body.vat_amount);
    const invoiceDate = normalizeDate(req.body.invoice_date) || null;
    const paymentDate = normalizeDate(req.body.payment_date) || null;
    const fiscalPeriod = normalizeMonth(req.body.fiscal_period) || null;

    if ([plannedAmount, actualAmount, vatAmount].includes(undefined)) {
        return redirectWith('error', 'Проверьте суммы: допускаются только положительные числа.');
    }
    if (req.body.invoice_date && !invoiceDate) {
        return redirectWith('error', 'Некорректная дата счёта.');
    }
    if (req.body.payment_date && !paymentDate) {
        return redirectWith('error', 'Некорректная дата оплаты.');
    }
    if (req.body.fiscal_period && !fiscalPeriod) {
        return redirectWith('error', 'Некорректный финансовый месяц.');
    }

    try {
        connection = await pool.getConnection();
        const [orders] = await connection.query('SELECT id FROM orders WHERE id = ? LIMIT 1', [orderId]);
        if (orders.length === 0) {
            return redirectWith('error', 'Заказ не найден.');
        }

        await connection.query(
            `INSERT INTO order_accounting
                (order_id, budget_category, cost_center, supplier_name, invoice_number, invoice_date,
                 payment_status, payment_date, fiscal_period, planned_amount, actual_amount, vat_amount,
                 document_status, comment, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
             ON DUPLICATE KEY UPDATE
                budget_category = VALUES(budget_category),
                cost_center = VALUES(cost_center),
                supplier_name = VALUES(supplier_name),
                invoice_number = VALUES(invoice_number),
                invoice_date = VALUES(invoice_date),
                payment_status = VALUES(payment_status),
                payment_date = VALUES(payment_date),
                fiscal_period = VALUES(fiscal_period),
                planned_amount = VALUES(planned_amount),
                actual_amount = VALUES(actual_amount),
                vat_amount = VALUES(vat_amount),
                document_status = VALUES(document_status),
                comment = VALUES(comment),
                updated_at = NOW()`,
            [
                orderId,
                normalizeLimitedText(req.body.budget_category, 120) || null,
                normalizeLimitedText(req.body.cost_center, 120) || null,
                normalizeLimitedText(req.body.supplier_name, 160) || null,
                normalizeLimitedText(req.body.invoice_number, 120) || null,
                invoiceDate,
                paymentStatus,
                paymentDate,
                fiscalPeriod,
                plannedAmount,
                actualAmount,
                vatAmount,
                documentStatus,
                normalizeLimitedText(req.body.comment, 1000) || null,
            ]
        );
        redirectWith('updated', 'Учётные данные заказа сохранены.');
    } catch (err) {
        console.log(err);
        mlog(err);
        redirectWith('error', 'Не удалось сохранить учётные данные.');
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
        pageTitle: 'Оформить новый заказ',
        formAction: '/myorders/addorder',
        breadcrumbRootHref: '/myorders',
        breadcrumbRootText: 'Мои заказы',
        order: {},
        cancelUrl: '/myorders',
        isAuthenticated: req.session.isAuthenticated,
        user: req.session.user,
    });
};

export const formOrderForUser = async (req, res, fieldErrors = {}, alert = null) => {
    let connection;
    try {
        connection = await pool.getConnection();
        const ownerSearch = normalizeText(req.body.owner_q || req.query.owner_q);
        const selectedOwnerId = normalizeId(req.body.owner_sso_id || req.query.owner_sso_id);
        const ownerRows = await loadBuySsoUsers(connection, { q: ownerSearch, selectedId: selectedOwnerId });
        const ownerOptions = ownerRows.map((row) => ({
            value: row.id,
            label: `${ssoUserLabel(row)} · SSO #${row.id}`,
            selected: Number(row.id) === Number(selectedOwnerId),
        }));

        res.render('add-order', {
            title: 'Новый заказ за пользователя',
            pageTitle: 'Оформить заказ за пользователя',
            formAction: '/manageorders/addorder',
            breadcrumbRootHref: '/manageorders',
            breadcrumbRootText: 'Активные заказы',
            adminOnBehalf: true,
            ownerSearch,
            ownerOptions,
            hasOwnerOptions: ownerOptions.length > 0,
            order: req.body || {},
            fieldErrors,
            alert,
            cancelUrl: '/manageorders',
            isAuthenticated: req.session.isAuthenticated,
            user: req.session.user,
        });
    } catch (err) {
        console.log(err);
        mlog(err);
        renderError(res, req, 500, 'Ошибка сервера', 'Не удалось загрузить форму заказа за пользователя.');
    } finally {
        if (connection) connection.release();
    }
};

export const createOrder = async (req, res) => {
    let connection;
    const { good, quantity, arrival_date } = req.body;
    const link = normalizeUrl(req.body.link);
    const price = normalizePrice(req.body.price);
    const ssoAuthorId = getSsoUserId(req);
    try {
        connection = await pool.getConnection();
        await connection.beginTransaction();
        const [result] = await connection.query(
            `INSERT INTO orders
             SET good = ?, quantity = ?, price = ?, link = ?, creation_date = NOW(),
                 arrival_date = ?, author_id = NULL, sso_author_id = ?, created_by_sso_id = ?,
                 created_mode = ?, status = ?`,
            [good, quantity, price, link, arrival_date, ssoAuthorId, ssoAuthorId, 'self', ORDER_STATUS.PENDING]
        );
        await connection.query(
            `INSERT INTO order_accounting
                (order_id, payment_status, fiscal_period, planned_amount, document_status, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, NOW(), NOW())`,
            [result.insertId, PAYMENT_STATUS.NOT_PLANNED, fiscalPeriodFromDate(arrival_date), price, DOCUMENT_STATUS.NONE]
        );
        await connection.commit();
        mlog('Добавлен новый заказ.');
        res.redirect('/myorders?created=' + encodeURIComponent('Новый заказ добавлен.'));
    } catch (err) {
        if (connection) {
            try {
                await connection.rollback();
            } catch (rollbackErr) {
                mlog(rollbackErr);
            }
        }
        console.log(err);
        mlog(err);
        renderError(res, req, 500, 'Ошибка сервера', 'Не удалось создать заказ.');
    } finally {
        if (connection) connection.release();
    }
};

export const createOrderForUser = async (req, res) => {
    let connection;
    const { good, quantity, arrival_date } = req.body;
    const link = normalizeUrl(req.body.link);
    const price = normalizePrice(req.body.price);
    const creatorId = getSsoUserId(req);
    const ownerId = normalizeId(req.body.owner_sso_id);

    if (!ownerId) {
        return formOrderForUser(req, res, { owner_sso_id: 'Выберите заказчика из SSO.' }, 'Проверьте поля формы.');
    }

    try {
        connection = await pool.getConnection();
        const owner = await loadBuySsoUserById(connection, ownerId);
        if (!owner) {
            return formOrderForUser(req, res, { owner_sso_id: 'Пользователь не найден или у него нет роли buy.' }, 'Проверьте заказчика.');
        }

        const createdMode = ownerId === creatorId ? 'self' : 'admin_on_behalf';
        await connection.beginTransaction();
        const [result] = await connection.query(
            `INSERT INTO orders
             SET good = ?, quantity = ?, price = ?, link = ?, creation_date = NOW(),
                 arrival_date = ?, author_id = NULL, sso_author_id = ?, created_by_sso_id = ?,
                 created_mode = ?, status = ?`,
            [good, quantity, price, link, arrival_date, ownerId, creatorId, createdMode, ORDER_STATUS.PENDING]
        );
        await connection.query(
            `INSERT INTO order_accounting
                (order_id, payment_status, fiscal_period, planned_amount, document_status, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, NOW(), NOW())`,
            [result.insertId, PAYMENT_STATUS.NOT_PLANNED, fiscalPeriodFromDate(arrival_date), price, DOCUMENT_STATUS.NONE]
        );
        await connection.commit();
        mlog(`Администратор добавил заказ для SSO #${ownerId}.`);
        res.redirect('/manageorders?created=' + encodeURIComponent(`Заказ для ${ssoUserLabel(owner)} добавлен.`));
    } catch (err) {
        if (connection) {
            try {
                await connection.rollback();
            } catch (rollbackErr) {
                mlog(rollbackErr);
            }
        }
        console.log(err);
        mlog(err);
        renderError(res, req, 500, 'Ошибка сервера', 'Не удалось создать заказ за пользователя.');
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
    const { good, quantity, arrival_date } = req.body;
    const link = normalizeUrl(req.body.link);
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
        await connection.query(
            `INSERT INTO order_accounting
                (order_id, payment_status, fiscal_period, planned_amount, document_status, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, NOW(), NOW())
             ON DUPLICATE KEY UPDATE
                planned_amount = CASE
                    WHEN payment_status = VALUES(payment_status) AND actual_amount IS NULL THEN VALUES(planned_amount)
                    ELSE planned_amount
                END,
                fiscal_period = CASE
                    WHEN payment_status = VALUES(payment_status) AND actual_amount IS NULL THEN VALUES(fiscal_period)
                    ELSE fiscal_period
                END,
                updated_at = NOW()`,
            [req.params.id, PAYMENT_STATUS.NOT_PLANNED, fiscalPeriodFromDate(arrival_date), price, DOCUMENT_STATUS.NONE]
        );
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
