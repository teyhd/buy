import { BLOCKED_LINK_CODE, BLOCKED_LINK_MESSAGE, isBlockedOrderLink } from './order-link-policy.js';

const selector = 'input[data-order-link-input]';
const warning = document.getElementById('blocked-order-link');
let activeField = null;
let previousModal = null;
let showing = false;
const openingModals = new WeakSet();

document.addEventListener('show.bs.modal', event => openingModals.add(event.target));
document.addEventListener('shown.bs.modal', event => openingModals.delete(event.target));

function markField(field, message) {
    const error = field.parentElement.querySelector('[data-field-error="link"]');
    field.classList.toggle('is-invalid', Boolean(message));
    if (message) field.setAttribute('aria-invalid', 'true');
    else field.removeAttribute('aria-invalid');
    if (error) error.textContent = message;
}

function showWarning(field) {
    field.value = '';
    field.dataset.linkBlocked = 'true';
    markField(field, BLOCKED_LINK_MESSAGE);
    if (showing) return;
    activeField = field;
    showing = true;
    previousModal = field.closest('.modal.show');
    const show = () => window.bootstrap.Modal.getOrCreateInstance(warning, { backdrop: 'static' }).show();
    if (previousModal) {
        const modal = previousModal;
        const hide = () => {
            if (modal.contains(document.activeElement)) document.activeElement.blur();
            modal.addEventListener('hidden.bs.modal', show, { once: true });
            window.bootstrap.Modal.getOrCreateInstance(modal).hide();
        };
        // Bootstrap ignores hide() during its opening animation (including rapid repeated paste).
        if (openingModals.has(modal)) modal.addEventListener('shown.bs.modal', hide, { once: true });
        else hide();
    } else {
        show();
    }
}

function checkField(field) {
    if (!isBlockedOrderLink(field.value, field.dataset.originalLink)) return false;
    showWarning(field);
    return true;
}

warning.addEventListener('shown.bs.modal', () => warning.querySelector('button').focus());
warning.addEventListener('hide.bs.modal', () => {
    if (warning.contains(document.activeElement)) document.activeElement.blur();
});
warning.addEventListener('hidden.bs.modal', () => {
    const field = activeField;
    const modal = previousModal;
    showing = false;
    activeField = null;
    previousModal = null;
    if (modal) {
        modal.addEventListener('shown.bs.modal', () => field.focus(), { once: true });
        window.bootstrap.Modal.getOrCreateInstance(modal).show();
    } else {
        field?.focus();
    }
});

document.addEventListener('paste', event => {
    const field = event.target.closest(selector);
    if (!field) return;
    // Inspect clipboard content before insertion, including when replacing part of a URL.
    const pasted = event.clipboardData?.getData('text') || '';
    if (isBlockedOrderLink(pasted, field.dataset.originalLink)) {
        event.preventDefault();
        showWarning(field);
    } else {
        setTimeout(() => checkField(field), 0);
    }
});

document.addEventListener('input', event => {
    const field = event.target.closest(selector);
    if (!field) return;
    if (event.inputType === 'insertFromPaste' || event.inputType === 'insertFromDrop') checkField(field);
    if (field.value && !isBlockedOrderLink(field.value, field.dataset.originalLink)) {
        delete field.dataset.linkBlocked;
        markField(field, '');
    }
});

document.addEventListener('focusout', event => {
    const field = event.target.closest(selector);
    if (field) checkField(field);
});

// Capture runs before the admin AJAX submit listener.
document.addEventListener('submit', event => {
    const field = event.target.querySelector(selector);
    if (!field) return;
    if (checkField(field) || (!field.value && field.dataset.linkBlocked)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (!showing) field.focus();
    }
}, true);

document.addEventListener('order-link-rejected', event => {
    if (event.detail?.code !== BLOCKED_LINK_CODE) return;
    const field = event.target.querySelector(selector);
    if (field) showWarning(field);
});

if (warning.dataset.serverBlocked === 'true') {
    const field = document.querySelector(selector);
    if (field) showWarning(field);
}
