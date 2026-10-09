CREATE TABLE `broker_connections_new` (
  `owner_ref` text NOT NULL,
  `broker` text NOT NULL,
  `account_ref` text NOT NULL,
  `environment` text NOT NULL,
  `trading_scope` integer DEFAULT false NOT NULL,
  `token_iv` text NOT NULL,
  `token_ciphertext` text NOT NULL,
  `connected_at` text NOT NULL,
  PRIMARY KEY (`owner_ref`, `broker`, `environment`)
);
INSERT INTO `broker_connections_new`
  (`owner_ref`, `broker`, `account_ref`, `environment`, `trading_scope`, `token_iv`, `token_ciphertext`, `connected_at`)
  SELECT `owner_ref`, `broker`, `account_ref`, `environment`, `trading_scope`, `token_iv`, `token_ciphertext`, `connected_at`
  FROM `broker_connections`;
DROP TABLE `broker_connections`;
ALTER TABLE `broker_connections_new` RENAME TO `broker_connections`;
