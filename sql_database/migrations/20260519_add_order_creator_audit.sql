-- Track who created a purchase order without duplicating SSO users.
-- This migration only changes the local buy schema and does not touch sso.*.

ALTER TABLE `orders`
  ADD COLUMN `created_by_sso_id` int(11) NULL AFTER `sso_author_id`,
  ADD COLUMN `created_mode` enum('self','admin_on_behalf') NOT NULL DEFAULT 'self' AFTER `created_by_sso_id`,
  ADD KEY `idx_orders_created_by_sso_id` (`created_by_sso_id`),
  ADD KEY `idx_orders_created_mode` (`created_mode`);

UPDATE `orders`
SET `created_by_sso_id` = `sso_author_id`,
    `created_mode` = 'self'
WHERE `sso_author_id` IS NOT NULL
  AND `created_by_sso_id` IS NULL;
