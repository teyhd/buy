-- Optimize local purchase service tables for order filtering and analytics.
-- This migration does not touch sso.*.

ALTER TABLE `orders`
  ADD KEY `idx_orders_status_creation` (`status`, `creation_date`),
  ADD KEY `idx_orders_status_arrival` (`status`, `arrival_date`),
  ADD KEY `idx_orders_creation_date` (`creation_date`),
  ADD KEY `idx_orders_arrival_date` (`arrival_date`),
  ADD KEY `idx_orders_price` (`price`),
  ADD KEY `idx_orders_sso_author_status` (`sso_author_id`, `status`),
  ADD KEY `idx_orders_author_status` (`author_id`, `status`);
