-- Purchase Service SSO ownership migration.
-- Keeps legacy author_id for old orders and stores new SSO-owned orders in sso_author_id.
-- This migration does not write to sso.*.

ALTER TABLE `orders`
  DROP FOREIGN KEY `orders_ibfk_1`;

ALTER TABLE `orders`
  MODIFY `author_id` bigint(20) UNSIGNED NULL,
  ADD COLUMN `sso_author_id` int(11) NULL AFTER `author_id`,
  ADD KEY `idx_orders_sso_author_id` (`sso_author_id`);

ALTER TABLE `orders`
  ADD CONSTRAINT `orders_author_one_source_chk`
    CHECK (
      (`author_id` IS NOT NULL AND `sso_author_id` IS NULL)
      OR (`author_id` IS NULL AND `sso_author_id` IS NOT NULL)
    );

ALTER TABLE `orders`
  ADD CONSTRAINT `orders_ibfk_1`
    FOREIGN KEY (`author_id`) REFERENCES `users` (`id`);
