(function () {
    const GENERIC_ERROR = 'Не удалось сохранить. Проверьте соединение и попробуйте ещё раз.';

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
            alert.className = `alert manage-orders-alert alert-${type === 'success' ? 'success' : 'danger'}`;
            alert.textContent = text;
            alert.classList.remove('d-none');

            if (type === 'success') {
                window.setTimeout(() => alert.classList.add('d-none'), 3500);
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

    function initStatusAutosave() {
        document.querySelectorAll('[data-status-select]').forEach((select) => {
            select.addEventListener('change', async () => {
                const previousStatus = select.dataset.originalStatus || '';
                const nextStatus = select.value;
                if (nextStatus === previousStatus) return;

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
                            return_to: select.dataset.returnTo || window.location.pathname + window.location.search,
                        }),
                    });
                    const data = await safeJson(response);

                    if (!response.ok || data.ok === false) {
                        throw new Error(data.message || GENERIC_ERROR);
                    }

                    select.dataset.originalStatus = nextStatus;
                    const message = data.message || 'Статус заказа сохранён.';
                    setInlineState(select, 'success', data.closed ? 'Сохранено, уйдёт в архив' : 'Сохранено');
                    showNotice('success', message);
                } catch (error) {
                    select.value = previousStatus;
                    setInlineState(select, 'error', 'Ошибка');
                    showNotice('error', error.message || GENERIC_ERROR);
                } finally {
                    select.disabled = false;
                }
            });
        });
    }

    function initEditModals() {
        document.querySelectorAll('.js-admin-edit-form').forEach((form) => {
            form.addEventListener('submit', async (event) => {
                event.preventDefault();
                clearModalErrors(form);

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
                        showModalError(form, data.message || 'Проверьте поля формы.');
                        applyFieldErrors(form, data.fieldErrors || {});
                        return;
                    }

                    if (!response.ok || data.ok === false) {
                        throw new Error(data.message || GENERIC_ERROR);
                    }

                    if (data.order) {
                        updateOrderRow(data.order);
                    }

                    const modalElement = form.closest('.modal');
                    if (modalElement && window.bootstrap) {
                        window.bootstrap.Modal.getOrCreateInstance(modalElement).hide();
                    }
                    showNotice('success', data.message || 'Данные заказа сохранены.');
                } catch (error) {
                    showModalError(form, error.message || GENERIC_ERROR);
                    showNotice('error', error.message || GENERIC_ERROR);
                } finally {
                    if (submitButton) {
                        submitButton.disabled = false;
                        submitButton.textContent = submitButton.dataset.originalText || 'Сохранить';
                    }
                }
            });
        });
    }

    document.addEventListener('DOMContentLoaded', () => {
        initStatusAutosave();
        initEditModals();
    });
})();
