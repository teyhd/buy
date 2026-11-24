-- Receipt time is recorded in UTC when an order reaches the received status.
ALTER TABLE orders ADD COLUMN received_at DATETIME(3) DEFAULT NULL COMMENT 'UTC receipt time', ALGORITHM=INSTANT;
