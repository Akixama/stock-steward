CREATE TABLE `active_modules` (
  `owner_ref` text NOT NULL,
  `mandate_version` integer NOT NULL,
  `safe` text NOT NULL,
  `module` text NOT NULL,
  `verified_at` text NOT NULL,
  PRIMARY KEY (`owner_ref`, `mandate_version`)
);
