#!/bin/sh
# Builds spikes/build/Kikitori.app: the compiled gpuix app, the Swift audio helper, the
# kuromoji dictionary and an Info.plist with the permission strings. Ad-hoc signed (no
# Apple Developer account): open it with right-click → Open the first time.
set -eu
cd "$(dirname "$0")"
APP=build/Kikitori.app
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources" "$APP/Contents/Frameworks"

swiftc -O -o "$APP/Contents/MacOS/kikitori-audio" helper/main.swift \
  -Xlinker -sectcreate -Xlinker __TEXT -Xlinker __info_plist -Xlinker helper/Info.plist 2>/dev/null
(cd gpuix && bun build --compile entry.ts --outfile "../$APP/Contents/MacOS/kikitori")
cp gpuix/node_modules/@gpuix/native-darwin-arm64/gpuix-native.darwin-arm64.node "$APP/Contents/Frameworks/"
cp -R ../node_modules/kuromoji/dict "$APP/Contents/Resources/dict"
cp helper/Info.plist "$APP/Contents/Info.plist"

codesign --force --sign - "$APP/Contents/MacOS/kikitori-audio" "$APP/Contents/Frameworks/gpuix-native.darwin-arm64.node"
codesign --force --sign - "$APP"
du -sh "$APP"
