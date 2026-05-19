document.addEventListener('DOMContentLoaded', function () {
    document.querySelectorAll('.js-table-expand-text').forEach(function (element) {
        var isOverflowing = element.scrollHeight > element.clientHeight + 1 || element.scrollWidth > element.clientWidth + 1;
        if (!isOverflowing) {
            element.removeAttribute('role');
            element.removeAttribute('tabindex');
            element.removeAttribute('aria-expanded');
            element.removeAttribute('title');
            return;
        }

        element.classList.add('is-toggle-ready');

        function toggleExpanded() {
            var expanded = element.classList.toggle('is-expanded');
            element.setAttribute('aria-expanded', expanded ? 'true' : 'false');
            element.setAttribute('title', expanded ? 'Нажмите, чтобы свернуть' : 'Нажмите, чтобы раскрыть');
        }

        element.addEventListener('click', toggleExpanded);
        element.addEventListener('keydown', function (event) {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                toggleExpanded();
            }
        });
    });
});
