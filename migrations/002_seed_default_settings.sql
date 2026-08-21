-- Migration 002: Seed default monitor settings into system_settings.
-- The database is the source of truth for runtime configuration; these
-- defaults are inserted only when the key is absent (first-time databases
-- or keys not yet customized), so operator-configured values are preserved.

INSERT OR IGNORE INTO system_settings (key, value) VALUES
    ('radius_km', '50'),
    ('interval_minutes', '15'),
    ('inmet_min_severity', 'RED'),
    ('defesa_civil_min_severity', 'ORANGE');
