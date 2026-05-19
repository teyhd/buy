-- Add a closed cancel status for user-initiated order cancellation.
-- This migration only changes the local purchase service schema and does not touch sso.*.

ALTER TABLE `orders`
  MODIFY `status` enum(
    'На рассмотрении',
    'Закупаем',
    'Доставляем',
    'Ожидает получения',
    'Получен',
    'Отменен'
  ) DEFAULT NULL;
