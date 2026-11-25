(function () {
    const GENERIC_ERROR = 'Не удалось сохранить. Проверьте соединение и попробуйте ещё раз.';
    let noticeTimeout;
    let pendingSaves = 0;
    let refreshUrl;
    let saveError;
    const openModals = new Set();

    function safeJson(response) {
        return response.text().then((text) => {
            if (!text) return {};
            try {
                return JSON.parse(text);
            } catch (_error) {
                return {};
            }
        });
    }

    function showNotice(type, message) {
        const text = message || GENERIC_ERROR;
        const alert = document.querySelector('[data-manage-alert]');

        if (alert) {
            window.clearTimeout(noticeTimeout);
            alert.className = `alert manage-orders-alert alert-${type === 'success' ? 'success' : 'danger'}`;
            alert.textContent = text;
            alert.classList.remove('d-none');

            if (type === 'success') {
                noticeTimeout = window.setTimeout(() => alert.classList.add('d-none'), 3500);
            }
        }

        if (type === 'success' && typeof window.snackBAR === 'function') {
            window.snackBAR(text);
        }
    }

    function setInlineState(select, type, message) {
        const control = select.closest('[data-status-control]');
        const state = control ? control.querySelector('[data-status-state]') : null;
        if (!state) return;

        state.classList.remove('inline-save-state--success', 'inline-save-state--error');
        if (type) {
            state.classList.add(`inline-save-state--${type}`);
        }
        state.textContent = message || '';
    }

    function requestBody(data) {
        const params = new URLSearchParams();
        Object.entries(data).forEach(([key, value]) => {
            params.set(key, value == null ? '' : String(value));
        });
        return params;
    }

    function clearModalErrors(form) {
        const modalError = form.querySelector('[data-modal-error]');
        if (modalError) {
            modalError.textContent = '';
            modalError.classList.add('d-none');
        }

        form.querySelectorAll('.is-invalid').forEach((field) => field.classList.remove('is-invalid'));
        form.querySelectorAll('[data-field-error]').forEach((fieldError) => {
            fieldError.textContent = '';
        });
    }

    function showModalError(form, message) {
        const modalError = form.querySelector('[data-modal-error]');
        if (!modalError) return;
        modalError.textContent = message || GENERIC_ERROR;
        modalError.classList.remove('d-none');
    }

    function applyFieldErrors(form, fieldErrors) {
        Object.entries(fieldErrors || {}).forEach(([name, message]) => {
            const field = form.elements[name];
            const error = form.querySelector(`[data-field-error="${name}"]`);
            if (field) {
                field.classList.add('is-invalid');
            }
            if (error) {
                error.textContent = message;
            }
        });
    }

    function updateOrderRow(order) {
        const row = document.querySelector(`[data-order-row="${order.id}"]`);
        if (!row) return;

        const quantity = row.querySelector('[data-order-quantity]');
        const price = row.querySelector('[data-order-price]');
        const link = row.querySelector('[data-order-link]');

        if (quantity) quantity.textContent = order.quantity;
        if (price) price.textContent = `${order.price_label} руб.`;
        if (link) {
            link.href = order.link;
            link.textContent = order.link_label;
        }
    }

    function refreshOrdersWhenReady() {
        // Reloading can discard an open form or cancel a save.
        if (pendingSaves > 0 || (refreshUrl && openModals.size > 0)) return;
        if (refreshUrl) {
            if (saveError) {
                refreshUrl.searchParams.delete('updated');
                refreshUrl.searchParams.set('error', saveError);
            }
            window.location.replace(refreshUrl);
            refreshUrl = undefined;
        }
        saveError = undefined;
    }

    function queueListRefresh(returnTo, message) {
        if (refreshUrl) return;
        refreshUrl = new URL(returnTo, window.location.href);
        refreshUrl.searchParams.delete('error');
        if (message) refreshUrl.searchParams.set('updated', message);
    }

    function initStatusAutosave() {
        document.addEventListener('change', async (event) => {
            const select = event.target.closest('[data-status-select]');
            if (!select) return;
            const previousStatus = select.dataset.originalStatus || '';
            const nextStatus = select.value;
            if (nextStatus === previousStatus) return;

            const returnTo = select.dataset.returnTo || window.location.pathname + window.location.search;
            pendingSaves += 1;
            select.disabled = true;
            setInlineState(select, null, 'Сохранение...');

            try {
                const response = await fetch(select.dataset.url, {
                    method: 'POST',
                    headers: {
                        Accept: 'application/json',
                        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
                        'X-Requested-With': 'XMLHttpRequest',
                    },
                    body: requestBody({
                        status: nextStatus,
                        previous_status: previousStatus,
                        return_to: returnTo,
                    }),
                });
                const data = await safeJson(response);

                if (!response.ok || data.ok !== true) {
                    if (response.status === 409 || response.status === 404) queueListRefresh(returnTo);
                    throw new Error(data.message || GENERIC_ERROR);
                }

                select.dataset.originalStatus = nextStatus;
                const message = data.message || 'Статус заказа сохранён.';
                const statusFilter = select.closest('[data-status-filter]').dataset.statusFilter;
                if (data.closed || (statusFilter && nextStatus !== statusFilter)) {
                    queueListRefresh(returnTo, message);
                }
                setInlineState(select, 'success', 'Сохранено');
                if (!saveError) showNotice('success', message);
            } catch (error) {
                saveError = error.message || GENERIC_ERROR;
                select.value = previousStatus;
                setInlineState(select, 'error', 'Ошибка');
                showNotice('error', saveError);
            } finally {
                select.disabled = false;
                pendingSaves -= 1;
                refreshOrdersWhenReady();
            }
        });
    }

    function initEditModals() {
        document.addEventListener('show.bs.modal', (event) => {
            openModals.add(event.target);
        });
        document.addEventListener('hidden.bs.modal', (event) => {
            openModals.delete(event.target);
            refreshOrdersWhenReady();
        });
        document.addEventListener('submit', async (event) => {
            const form = event.target.closest('.js-admin-edit-form');
            if (!form) return;
            event.preventDefault();
            clearModalErrors(form);
            pendingSaves += 1;

            const modalElement = form.closest('.modal');
            const submitButton = form.querySelector('[data-submit-button]');
            if (submitButton) {
                submitButton.disabled = true;
                submitButton.dataset.originalText = submitButton.textContent;
                submitButton.textContent = 'Сохранение...';
            }

            try {
                const response = await fetch(form.action, {
                    method: 'POST',
                    headers: {
                        Accept: 'application/json',
                        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
                        'X-Requested-With': 'XMLHttpRequest',
                    },
                    body: new URLSearchParams(new FormData(form)),
                });
                const data = await safeJson(response);

                if (response.status === 422) {
                    const message = data.message || 'Проверьте поля формы.';
                    const formVisible = modalElement?.classList.contains('show');
                    showModalError(form, message);
                    applyFieldErrors(form, data.fieldErrors || {});
                    form.dispatchEvent(new CustomEvent('order-link-rejected', { bubbles: true, detail: data }));
                    if (!formVisible) {
                        saveError = message;
                        showNotice('error', message);
                    }
                    return;
                }

                if (!response.ok || data.ok !== true) {
                    throw new Error(data.message || GENERIC_ERROR);
                }

                if (data.order) {
                    updateOrderRow(data.order);
                    form.elements.link.dataset.originalLink = data.order.link;
                }

                if (modalElement && window.bootstrap) {
                    window.bootstrap.Modal.getOrCreateInstance(modalElement).hide();
                }
                if (!saveError) showNotice('success', data.message || 'Данные заказа сохранены.');
            } catch (error) {
                const message = error.message || GENERIC_ERROR;
                if (!modalElement?.classList.contains('show')) saveError = message;
                showModalError(form, message);
                showNotice('error', message);
            } finally {
                if (submitButton) {
                    submitButton.disabled = false;
                    submitButton.textContent = submitButton.dataset.originalText || 'Сохранить';
                }
                pendingSaves -= 1;
                refreshOrdersWhenReady();
            }
        });
    }

    document.addEventListener('DOMContentLoaded', () => {
        initStatusAutosave();
        initEditModals();
    });
})();
