-- Migration 005: Migrate boolean category toggles to intensity tiers.
-- Previous implementation stored '1' (enabled) / '0' (disabled).
-- New model stores RED/ORANGE/YELLOW/OFF like institute thresholds.

UPDATE system_settings SET value = 'YELLOW' WHERE key LIKE 'alert_cat_%' AND value = '1';
UPDATE system_settings SET value = 'OFF' WHERE key LIKE 'alert_cat_%' AND value = '0';
