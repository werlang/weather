-- Migration 003: Seed granular alert-category delivery preferences.
-- Every category uses an intensity tier (RED/ORANGE/YELLOW/OFF) like the
-- institute thresholds. Default is YELLOW (most permissive) for all.
-- INSERT OR IGNORE preserves operator choices.

INSERT OR IGNORE INTO system_settings (key, value) VALUES
    ('alert_cat_chuva', 'YELLOW'),
    ('alert_cat_temperatura', 'YELLOW'),
    ('alert_cat_vento', 'YELLOW'),
    ('alert_cat_umidade', 'YELLOW'),
    ('alert_cat_rio', 'YELLOW');
