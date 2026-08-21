# Video files

This folder is not used by the current MVP and should stay empty.

The current MVP loads videos only from Supabase:

1. Query all rows in `videos`.
2. Sort `video_id` ascending from `video_001` to `video_020`.
3. Use each row's private Storage `bucket` and `file_path`.
4. Generate a temporary signed URL for the HTML5 video source.
