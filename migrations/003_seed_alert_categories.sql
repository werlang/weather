-- Migration 003: Seed granular alert-category delivery preferences.
-- Every category is enabled ('1') by default; operators can toggle them
-- via the Telegram settings menu. INSERT OR IGNORE preserves choices.

INSERT OR IGNORE INTO system_settings (key, value) VALUES
    ('alert_cat_chuva', '1'),
    ('alert_cat_temperatura', '1'),
    ('alert_cat_vento', '1'),
    ('alert_cat_umidade', '1'),
    ('alert_cat_rio', '1');
