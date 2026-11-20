#!/usr/bin/env bash
#
# RIFQ Muslim icon pipeline.
#
# Every icon in the product is generated from ONE master image:
#
#   public/logo-source.png
#
# which is the icon artwork supplied by the app owner, byte-identical to the
# uploaded file_00000000d84c821082ddc66c950e7f3c.png (1254x1254 PNG, transparent
# outside the gold squircle border, deep emerald interior).
#
# Nothing is redesigned, redrawn or replaced here. The artwork is only scaled,
# cropped to a circle for Android's legacy round icon, or placed on the app's own
# deep emerald background for the two formats that are not allowed to carry
# transparency (the maskable PWA icon and the iOS home-screen icon).
#
# Outputs
#   web/PWA ....... public/favicon.ico, public/favicon.png,
#                   public/icons/{favicon-16,48,favicon-32,icon-192,icon-512,
#                   icon-1024,icon-maskable-192,icon-maskable-512,
#                   apple-touch-icon-180}.png
#   Android ....... res/mipmap-<density>/{ic_launcher,ic_launcher_round,
#                   ic_launcher_foreground}.png and
#                   res/drawable-nodpi/ic_splash_logo.png
#
# Usage: bash scripts/build-icons.sh
set -euo pipefail
cd "$(dirname "$0")/.."

SRC="public/logo-source.png"
BG="#041F17"                       # rifq_bg: the app's deep emerald
RES="android/app/src/main/res"

command -v convert >/dev/null || { echo "ImageMagick 'convert' is required"; exit 1; }
[ -f "$SRC" ] || { echo "master icon missing: $SRC"; exit 1; }

# The uploaded artwork, scaled to an exact pixel size with its transparent
# margin preserved (this is the icon as supplied).
exact() {
  local size=$1 out=$2
  mkdir -p "$(dirname "$out")"
  convert "$SRC" -filter Lanczos -resize "${size}x${size}" \
    -gravity center -background none -extent "${size}x${size}" \
    -strip "PNG32:$out"
}

# The same artwork trimmed to its visible border, then scaled to $2 of the
# canvas and centred on the emerald background. Used where transparency is not
# permitted: a transparent maskable icon renders as a black blob on Android.
on_bg() {
  local size=$1 ratio=$2 out=$3 inner
  inner=$(awk -v s="$size" -v r="$ratio" 'BEGIN{printf "%.0f", s*r}')
  mkdir -p "$(dirname "$out")"
  # -alpha remove is what actually guarantees opacity: the artwork's own squircle
  # corners are transparent, so compositing alone still leaves alpha in the file
  # and Android renders a maskable icon like that as a black-cornered blob.
  convert -size "${size}x${size}" "xc:${BG}" \
    \( "$SRC" -filter Lanczos -trim +repage -resize "${inner}x${inner}" \) \
    -gravity center -composite \
    -background "$BG" -alpha remove -alpha off \
    -strip "PNG24:$out"
}

# Android legacy round launcher icon: the artwork, trimmed and clipped to a
# circle so it reads as a round icon in launchers that ask for one.
round_icon() {
  local size=$1 out=$2 big mask
  big=$((size * 4))
  mask=$(mktemp /tmp/rifq-round-mask-XXXXXX.png)
  convert -size "${big}x${big}" xc:black -fill white \
    -draw "circle $((big / 2)),$((big / 2)) $((big / 2)),1" \
    -resize "${size}x${size}" "$mask"
  mkdir -p "$(dirname "$out")"
  convert "$SRC" -filter Lanczos -trim +repage -resize "${size}x${size}" \
    -gravity center -background none -extent "${size}x${size}" \
    "$mask" -alpha off -compose CopyOpacity -composite \
    -strip "PNG32:$out"
  rm -f "$mask"
}

# Adaptive-icon foreground: a 108dp canvas whose 66dp safe zone holds the whole
# artwork, so no launcher mask can cut off the gold border or the emblem.
adaptive_fg() {
  local size=$1 out=$2 inner
  inner=$(awk -v s="$size" 'BEGIN{printf "%.0f", s*66/108}')
  mkdir -p "$(dirname "$out")"
  convert -size "${size}x${size}" xc:none \
    \( "$SRC" -filter Lanczos -trim +repage -resize "${inner}x${inner}" \) \
    -gravity center -composite -strip "PNG32:$out"
}

# Splash logo: artwork inside the circle Android 12+ masks the splash icon with.
splash_logo() {
  local size=$1 out=$2 inner
  inner=$(awk -v s="$size" 'BEGIN{printf "%.0f", s*0.70}')
  mkdir -p "$(dirname "$out")"
  convert -size "${size}x${size}" xc:none \
    \( "$SRC" -filter Lanczos -trim +repage -resize "${inner}x${inner}" \) \
    -gravity center -composite -strip "PNG32:$out"
}

echo "Master icon: $SRC"

# ------------------------------- web / PWA --------------------------------
exact 1024 public/icons/icon-1024.png
exact 512  public/icons/icon-512.png
exact 192  public/icons/icon-192.png
exact 96   public/favicon.png
exact 48   public/icons/favicon-48.png
exact 32   public/icons/favicon-32.png
exact 16   public/icons/favicon-16.png
on_bg 512 0.78 public/icons/icon-maskable-512.png
on_bg 192 0.78 public/icons/icon-maskable-192.png
on_bg 180 0.82 public/icons/apple-touch-icon-180.png
convert public/icons/favicon-16.png public/icons/favicon-32.png \
  public/icons/favicon-48.png public/favicon.ico

# ----------------------------- android launcher ---------------------------
while read -r density size; do
  exact      "$size" "$RES/mipmap-$density/ic_launcher.png"
  round_icon "$size" "$RES/mipmap-$density/ic_launcher_round.png"
done <<'LAUNCHER'
mdpi 48
hdpi 72
xhdpi 96
xxhdpi 144
xxxhdpi 192
LAUNCHER

while read -r density size; do
  adaptive_fg "$size" "$RES/mipmap-$density/ic_launcher_foreground.png"
done <<'FOREGROUND'
mdpi 108
hdpi 162
xhdpi 216
xxhdpi 324
xxxhdpi 432
FOREGROUND

splash_logo 512 "$RES/drawable-nodpi/ic_splash_logo.png"

echo
echo "Generated icons:"
identify -format "%f %wx%h %[channels]\n" \
  public/favicon.png public/icons/*.png \
  "$RES"/mipmap-*/ic_launcher*.png \
  "$RES"/drawable-nodpi/ic_splash_logo.png | sort
