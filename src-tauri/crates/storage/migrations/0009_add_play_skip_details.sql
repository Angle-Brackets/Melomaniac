-- Add duration_ms to plays so we can sum total listen time per track.
-- Add position_ms to skips so we know where in the track the user bailed.
-- Both columns are nullable so existing rows (from 0002) are unaffected.
ALTER TABLE plays ADD COLUMN duration_ms INTEGER;
ALTER TABLE skips ADD COLUMN position_ms INTEGER;
