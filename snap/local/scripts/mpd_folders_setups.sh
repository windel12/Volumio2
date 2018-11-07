#!/bin/sh

echo "Creating Playlists folder"
PLAYLIST_FOLDER="$SNAP_COMMON/playlists"
if [ ! -d "$PLAYLIST_FOLDER" ]; then
  mkdir -p "$PLAYLIST_FOLDER"
fi

echo "Creating Music folder"
MUSIC_FOLDER="$SNAP_COMMON/music"
if [ ! -d "$MUSIC_FOLDER" ]; then
  mkdir -p "$MUSIC_FOLDER"
fi

echo "Creating Database File"
DB_FILE="$SNAP_COMMON/tag_cache"
if [ ! -f "$DB_FILE" ]; then
  touch "$DB_FILE"
fi


echo "Starting mpd"
exec "$SNAP/usr/bin/mpd" "$SNAP/etc/mpd.conf" --no-daemon --verbose
