ALTER TABLE `design_projects` ADD `mapId` text REFERENCES neural_maps(id);--> statement-breakpoint
CREATE INDEX `design_projects_map_id_idx` ON `design_projects` (`mapId`);--> statement-breakpoint
ALTER TABLE `design_saves` ADD `mapId` text REFERENCES neural_maps(id);--> statement-breakpoint
CREATE INDEX `design_saves_map_id_idx` ON `design_saves` (`mapId`);--> statement-breakpoint
ALTER TABLE `saved_scripts` ADD `mapId` text REFERENCES neural_maps(id);--> statement-breakpoint
CREATE INDEX `saved_scripts_map_id_idx` ON `saved_scripts` (`mapId`);