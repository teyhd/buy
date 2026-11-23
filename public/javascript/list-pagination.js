import { initTableExpandText } from './table-expand-text.js';

const pagination = document.querySelector('[data-list-pagination]');
const rows = document.querySelector('[data-list-rows]');
const more = pagination.querySelector('[data-list-more]');
const status = pagination.querySelector('[data-list-status]');
const modals = document.querySelector('[data-list-modals]');
let loading = false;

const observer = 'IntersectionObserver' in window
    ? new IntersectionObserver(entries => {
        if (entries.some(entry => entry.isIntersecting)) loadMore();
    }, { rootMargin: '0px 0px 180px' })
    : null;

async function loadMore() {
    if (loading || !more.isConnected) return;
    loading = true;
    observer?.unobserve(more);
    more.setAttribute('aria-disabled', 'true');
    more.textContent = 'Загрузка…';
    status.textContent = 'Загружаются записи.';
    rows.setAttribute('aria-busy', 'true');

    try {
        const response = await fetch(more.dataset.nextUrl, { redirect: 'error', cache: 'no-store' });
        if (!response.ok) throw new Error('Не удалось загрузить записи.');
        const fragment = new DOMParser().parseFromString(await response.text(), 'text/html');
        const navigation = fragment.querySelector('[data-list-pagination]');
        if (!navigation) throw new Error('Ответ не содержит список.');

        const batch = Array.from(fragment.querySelector('[data-list-rows]')?.rows || []);
        const next = navigation.querySelector('[data-list-more]');
        if (modals) {
            const batchModals = fragment.querySelector('[data-list-modals]');
            if (batchModals) modals.append(...batchModals.children);
        }
        rows.append(...batch);
        batch.forEach(initTableExpandText);

        if (document.activeElement === more && batch.length) {
            batch[0].tabIndex = -1;
            batch[0].focus();
        }
        if (next) {
            more.setAttribute('href', next.getAttribute('href'));
            more.dataset.nextUrl = next.dataset.nextUrl;
            more.textContent = 'Загрузить ещё';
            status.textContent = `Загружено записей: ${batch.length}.`;
            observer?.observe(more);
        } else {
            more.remove();
            status.textContent = 'Все записи загружены.';
        }
    } catch {
        more.textContent = 'Повторить загрузку';
        status.textContent = 'Не удалось загрузить записи. Попробуйте ещё раз.';
    } finally {
        loading = false;
        more.removeAttribute('aria-disabled');
        rows.removeAttribute('aria-busy');
    }
}

more.addEventListener('click', event => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    loadMore();
});

observer?.observe(more);
