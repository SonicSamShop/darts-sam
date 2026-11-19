#!/bin/sh
# Darts S.A.M. Copyright (C) 2026 Sam Cramphorn. Free software under the GNU
# AGPL v3: see LICENSE and NOTICE, or https://github.com/SonicSamShop/darts-sam
# SPDX-License-Identifier: AGPL-3.0-only
#
# Darts S.A.M for Linux: puts the program in your app menu. No sudo needed:
# everything goes in your own home folder.
#
#   ./install.sh               install, or update to this version
#   ./install.sh --uninstall   take it out again (your players and games stay)
#
# Players, games, calibration and reports are kept in ~/.local/share/dartssam,
# which installing a newer version does not touch.
set -e

here=$(cd "$(dirname "$0")" && pwd)
data=${XDG_DATA_HOME:-$HOME/.local/share}
bin=$HOME/.local/bin
app=$data/applications/dartssam.desktop
icon=$data/icons/hicolor/512x512/apps/dartssam.png

refresh() {
  command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database -q "$data/applications" 2>/dev/null || true
  command -v gtk-update-icon-cache >/dev/null 2>&1 && gtk-update-icon-cache -q -t "$data/icons/hicolor" 2>/dev/null || true
}

if [ "$1" = "--uninstall" ]; then
  rm -f "$bin/DartsSAM" "$app" "$icon"
  refresh
  echo "Darts S.A.M is uninstalled. Your players and games are still in $data/dartssam:"
  echo "delete that folder too to remove them."
  exit 0
fi

if [ "$(uname -m)" != "x86_64" ]; then
  echo "This Darts S.A.M is for 64-bit Intel and AMD PCs (x86_64), and this one is $(uname -m)."
  echo "On a Raspberry Pi, run it from the code instead: see the README."
  exit 1
fi

mkdir -p "$bin" "$(dirname "$app")" "$(dirname "$icon")"
install -m 755 "$here/DartsSAM" "$bin/DartsSAM"
install -m 644 "$here/dartssam.png" "$icon"
# Terminal=true: the window that opens says it is running, and closing it stops Darts S.A.M.
cat > "$app" <<EOF
[Desktop Entry]
Type=Application
Name=Darts S.A.M
Comment=Automatic dart scoring with your cameras
Exec="$bin/DartsSAM"
Icon=dartssam
Terminal=true
Categories=Game;SportsGame;
Keywords=darts;scoring;dartboard;
EOF
chmod 644 "$app"
refresh

echo "Darts S.A.M is installed. Start it from your app menu (search \"Darts\"),"
echo "or type DartsSAM in a terminal. Its page opens in your browser."

# The cameras are /dev/video*: on most desktops you may already use them, but
# not on every system.
for dev in /dev/video*; do
  [ -e "$dev" ] || break
  if [ ! -r "$dev" ]; then
    echo
    echo "You can't use the cameras yet. Run this once, then log out and back in:"
    echo "  sudo usermod -aG video $USER"
  fi
  break
done
