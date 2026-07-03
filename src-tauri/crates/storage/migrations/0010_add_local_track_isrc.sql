-- ISRC for local tracks, nullable. NULL for every existing/newly-ingested
-- track until an acoustic-fingerprinting/MusicBrainz enrichment pass (not
-- yet built) populates it. Lets the Spotify matcher short-circuit to an
-- exact match when both sides have an ISRC, with zero rework needed later.
ALTER TABLE tracks ADD COLUMN isrc TEXT;
