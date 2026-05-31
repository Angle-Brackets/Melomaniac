-- mime_type stores the IANA media type of the audio blob (e.g. "audio/mpeg", "audio/flac").
-- NULL for tracks ingested before this migration or where detection was not possible.
-- Required by iOS (AVAudioPlayer fileTypeHint) and Android (ExoPlayer setMimeType) because
-- CAS blob paths have no file extension and both platforms need an explicit format hint.
ALTER TABLE tracks ADD COLUMN mime_type TEXT;
