-- Add an optional requester comment to purchase orders.
-- This migration only changes the local buy schema and does not touch sso.*.

ALTER TABLE `orders`
  ADD COLUMN `comment` text DEFAULT NULL AFTER `link`;
