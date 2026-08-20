-- Idempotent production migration for Balalaika order notifications.
CREATE TABLE IF NOT EXISTS `notification_outbox` (
  `id` bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT,
  `recipient_sso_id` int(11) NOT NULL,
  `order_id` bigint(20) UNSIGNED NOT NULL,
  `actor_sso_id` int(11) NOT NULL,
  `event_type` enum('created','updated','cancelled') NOT NULL,
  `title` varchar(120) NOT NULL,
  `message_text` text NOT NULL,
  `delivery_state` enum('pending','sending','sent','skipped') NOT NULL DEFAULT 'pending',
  `attempts` int(10) UNSIGNED NOT NULL DEFAULT 0,
  `next_attempt_at` datetime NOT NULL DEFAULT current_timestamp(),
  `locked_at` datetime DEFAULT NULL,
  `sent_at` datetime DEFAULT NULL,
  `last_error` varchar(500) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_notification_outbox_due` (`delivery_state`,`next_attempt_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
