const calendarDatePattern = /^[1-9]\d{3}-\d{2}-\d{2}$/;
const mysqlDatePattern = /^(\d{4}-\d{2}-\d{2})(?: \d{2}:\d{2}:\d{2}(?:\.\d{1,6})?)?$/;
const moscowFormatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
});

export function isCalendarDate(value) {
    if (typeof value !== 'string' || !calendarDatePattern.test(value)) return false;
    const date = new Date(`${value}T00:00:00Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function moscowCalendarDate(now = Date.now()) {
    const { year, month, day } = Object.fromEntries(
        moscowFormatter.formatToParts(now).map(({ type, value }) => [type, value])
    );
    return `${year}-${month}-${day}`;
}

export function dateInputValue(value) {
    if (value instanceof Date && Number.isFinite(value.getTime())) {
        // mysql2 reads DATE and DATETIME into the process's local time by default.
        const year = value.getFullYear();
        const month = String(value.getMonth() + 1).padStart(2, '0');
        const day = String(value.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }
    const day = typeof value === 'string' ? mysqlDatePattern.exec(value)?.[1] : '';
    return isCalendarDate(day) ? day : '';
}

export function dateDisplayValue(value) {
    return dateInputValue(value).split('-').reverse().join('.');
}
