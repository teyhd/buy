-- phpMyAdmin SQL Dump
-- version 5.2.1
-- https://www.phpmyadmin.net/
--
-- Хост: localhost
-- Время создания: Июн 26 2024 г., 17:09
-- Версия сервера: 10.7.3-MariaDB
-- Версия PHP: 7.4.28

SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";
START TRANSACTION;
SET time_zone = "+00:00";


/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!40101 SET NAMES utf8mb4 */;

--
-- База данных: `purchase_service`
--

-- --------------------------------------------------------

--
-- Структура таблицы `orders`
--

CREATE TABLE `orders` (
  `id` bigint(20) UNSIGNED NOT NULL,
  `good` varchar(255) NOT NULL,
  `quantity` int(11) NOT NULL,
  `link` varchar(2048) NOT NULL,
  `creation_date` datetime DEFAULT NULL,
  `arrival_date` datetime DEFAULT NULL,
  `author_id` bigint(20) UNSIGNED DEFAULT NULL,
  `sso_author_id` int(11) DEFAULT NULL,
  `status` enum('На рассмотрении','Закупаем','Доставляем','Ожидает получения','Получен','Отменен') DEFAULT NULL,
  `price` decimal(10,2) DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Демо-данные таблицы `orders` удалены перед публикацией в git.
--

-- --------------------------------------------------------

--
-- Структура таблицы `order_accounting`
--

CREATE TABLE `order_accounting` (
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
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Демо-данные таблицы `order_accounting` удалены перед публикацией в git.
--

-- --------------------------------------------------------

--
-- Структура таблицы `users`
--

CREATE TABLE `users` (
  `id` bigint(20) UNSIGNED NOT NULL,
  `name` varchar(255) NOT NULL,
  `surname` varchar(255) NOT NULL,
  `patname` varchar(255) NOT NULL,
  `location` varchar(255) NOT NULL DEFAULT '0',
  `email` varchar(255) NOT NULL,
  `password` varchar(255) NOT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL,
  `is_admin` tinyint(1) NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Демо-данные таблицы `users` удалены перед публикацией в git.
--

--
-- Индексы сохранённых таблиц
--

--
-- Индексы таблицы `orders`
--
ALTER TABLE `orders`
  ADD PRIMARY KEY (`id`),
  ADD KEY `author_id` (`author_id`),
  ADD KEY `idx_orders_sso_author_id` (`sso_author_id`),
  ADD KEY `idx_orders_status_creation` (`status`,`creation_date`),
  ADD KEY `idx_orders_status_arrival` (`status`,`arrival_date`),
  ADD KEY `idx_orders_creation_date` (`creation_date`),
  ADD KEY `idx_orders_arrival_date` (`arrival_date`),
  ADD KEY `idx_orders_price` (`price`),
  ADD KEY `idx_orders_sso_author_status` (`sso_author_id`,`status`),
  ADD KEY `idx_orders_author_status` (`author_id`,`status`);

--
-- Индексы таблицы `order_accounting`
--
ALTER TABLE `order_accounting`
  ADD PRIMARY KEY (`order_id`),
  ADD KEY `idx_order_accounting_payment_status` (`payment_status`),
  ADD KEY `idx_order_accounting_fiscal_period` (`fiscal_period`),
  ADD KEY `idx_order_accounting_budget_category` (`budget_category`),
  ADD KEY `idx_order_accounting_supplier_name` (`supplier_name`),
  ADD KEY `idx_order_accounting_cost_center` (`cost_center`),
  ADD KEY `idx_order_accounting_payment_date` (`payment_date`);

--
-- Индексы таблицы `users`
--
ALTER TABLE `users`
  ADD PRIMARY KEY (`id`);

--
-- AUTO_INCREMENT для сохранённых таблиц
--

--
-- AUTO_INCREMENT для таблицы `orders`
--
ALTER TABLE `orders`
  MODIFY `id` bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT для таблицы `users`
--
ALTER TABLE `users`
  MODIFY `id` bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT;

--
-- Ограничения внешнего ключа сохраненных таблиц
--

--
-- Ограничения внешнего ключа таблицы `orders`
--
ALTER TABLE `orders`
  ADD CONSTRAINT `orders_author_one_source_chk` CHECK (
    (`author_id` IS NOT NULL AND `sso_author_id` IS NULL)
    OR (`author_id` IS NULL AND `sso_author_id` IS NOT NULL)
  ),
  ADD CONSTRAINT `orders_ibfk_1` FOREIGN KEY (`author_id`) REFERENCES `users` (`id`);

--
-- Ограничения внешнего ключа таблицы `order_accounting`
--
ALTER TABLE `order_accounting`
  ADD CONSTRAINT `order_accounting_order_fk`
    FOREIGN KEY (`order_id`) REFERENCES `orders` (`id`) ON DELETE CASCADE;
COMMIT;

/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
