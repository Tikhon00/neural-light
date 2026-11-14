#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
npm run build
swift build --package-path native -c release
APP="build/NEURAL LIGHT.app"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources/Web"
cp native/.build/release/NeuralLightApp "$APP/Contents/MacOS/NeuralLightApp"
rsync -a --delete dist/ "$APP/Contents/Resources/Web/"
cp -R native/.build/release/NeuralLight_NeuralRuntime.bundle "$APP/Contents/Resources/"
swift scripts/make-icon.swift build/NeuralLight.iconset
iconutil -c icns build/NeuralLight.iconset -o "$APP/Contents/Resources/AppIcon.icns"
cat > "$APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>NeuralLightApp</string>
<key>CFBundleIdentifier</key><string>studio.neurallight.app</string>
<key>CFBundleName</key><string>NEURAL LIGHT</string>
<key>CFBundleDisplayName</key><string>NEURAL LIGHT</string>
<key>CFBundleVersion</key><string>1</string>
<key>CFBundleShortVersionString</key><string>0.1.0</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleIconFile</key><string>AppIcon</string>
<key>LSMinimumSystemVersion</key><string>14.0</string>
<key>NSHighResolutionCapable</key><true/>
<key>NSMicrophoneUsageDescription</key><string>NEURAL LIGHT анализирует звук микрофона, чтобы управлять светом. Аудио не сохраняется и не отправляется в облако.</string>
<key>NSAudioCaptureUsageDescription</key><string>Звук выбранного экрана управляет световыми эффектами локально на Mac.</string>
<key>NSLocalNetworkUsageDescription</key><string>NEURAL LIGHT передаёт цветовые кадры вашим контроллерам WLED в локальной сети.</string>
<key>NSAppTransportSecurity</key><dict><key>NSAllowsLocalNetworking</key><true/><key>NSAllowsArbitraryLoadsInWebContent</key><true/></dict>
</dict></plist>
PLIST
codesign --force --deep --sign - "$APP"
printf 'Built: %s/build/NEURAL LIGHT.app\n' "$PWD"
