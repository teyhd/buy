-- Add local accounting contour for Purchase Service analytics.
-- This migration does not write to sso.* and does not duplicate SSO users.

CREATE TABLE IF NOT EXISTS `order_accounting` (
  `order_id` bigint(20) UNSIGNED NOT NULL,
  `budget_category` varchar(120) DEFAULT NULL,
  `cost_center` varchar(120) DEFAULT NULL,
  `supplier_name` varchar(160) DEFAULT NULL,
  `invoice_number` varchar(120) DEFAULT NULL,
  `invoice_date` date DEFAULT NULL,
  `payment_status` enum('not_planned','planned','invoice_received','paid','closed') NOT NULL DEFAULT 'not_planned',
  `payment_date` date DEFAULT NULL,
  `fiscal_period` char(7) DEFAULT NULL,
  `planned_amount` decimal(12,2) DEFAULT NULL,
  `actual_amount` decimal(12,2) DEFAULT NULL,
  `vat_amount` decimal(12,2) DEFAULT NULL,
  `document_status` enum('none','invoice','closing_docs','complete') NOT NULL DEFAULT 'none',
  `comment` text DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`order_id`),
  KEY `idx_order_accounting_payment_status` (`payment_status`),
  KEY `idx_order_accounting_fiscal_period` (`fiscal_period`),
  KEY `idx_order_accounting_budget_category` (`budget_category`),
  KEY `idx_order_accounting_supplier_name` (`supplier_name`),
  KEY `idx_order_accounting_cost_center` (`cost_center`),
  KEY `idx_order_accounting_payment_date` (`payment_date`),
  CONSTRAINT `order_accounting_order_fk`
    FOREIGN KEY (`order_id`) REFERENCES `orders` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
