#!/bin/bash
# Builds MacDisplay.app from the source in this folder.
#
#   bash build.sh              build and open the app
#   bash build.sh --install    build, copy to /Applications and open it
#
# Needs Apple's Command Line Tools (one-time:  xcode-select --install).
# Because you build it yourself on your own Mac, macOS shows no "unverified developer" warning.
set -e
cd "$(dirname "$0")"

APP="MacDisplay.app"

if ! command -v swiftc >/dev/null 2>&1; then
  echo "The Swift compiler was not found."
  echo "Install Apple's Command Line Tools with:   xcode-select --install"
  echo "then run this script again."
  exit 1
fi

ARCH="$(uname -m)"          # arm64 or x86_64
echo "Building MacDisplay for $ARCH ..."

rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"

swiftc -O -swift-version 5 -target "$ARCH-apple-macos13.0" Sources/*.swift \
  -o "$APP/Contents/MacOS/MacDisplay"

cp Resources/Info.plist "$APP/Contents/Info.plist"
cp -R Resources/web "$APP/Contents/Resources/web"
if [ -f Resources/AppIcon.icns ]; then cp Resources/AppIcon.icns "$APP/Contents/Resources/AppIcon.icns"; fi

# Ad-hoc signature (no developer account needed). After a rebuild macOS may ask for the
# Location / Music permissions again, because each build has a new signature.
xattr -cr "$APP" 2>/dev/null || true
codesign --force --deep --sign - "$APP"

echo "Built $APP"

if [ "$1" = "--install" ]; then
  rm -rf "/Applications/$APP"
  cp -R "$APP" "/Applications/"
  echo "Installed to /Applications/$APP"
  open "/Applications/$APP"
else
  open "$APP"
fi
