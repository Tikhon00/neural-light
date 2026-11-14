#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
test -d "build/NEURAL LIGHT.app"
PACKAGE="build/NEURAL-LIGHT-Preview"
mkdir -p "$PACKAGE/Инструкции" "$PACKAGE/Примеры сцен"
ditto "build/NEURAL LIGHT.app" "$PACKAGE/NEURAL LIGHT.app"
cp docs/WLED.md docs/HARDWARE-CHECK.md docs/BENCHMARKS.md "$PACKAGE/Инструкции/"
cp examples/*.json "$PACKAGE/Примеры сцен/"
cat > "$PACKAGE/Начните здесь.txt" <<'TEXT'
NEURAL LIGHT 0.1 Preview
macOS 14+ · Apple Silicon

Откройте NEURAL LIGHT.app. Терминал, Node.js и Xcode не нужны.
Выберите сцену в нижней панели. Предпросмотр работает без ESP32.
Нажмите «Подключить свою», чтобы добавить WLED. Передача включается вручную.
Микрофон и экран запрашивают системное разрешение только после вашего выбора.

Подробности подключения: Инструкции/WLED.md
Порядок аппаратного прогона: Инструкции/HARDWARE-CHECK.md

Это локальная preview-сборка с ad-hoc подписью, без Apple notarization.
Если macOS не допускает её запуск после передачи, используйте сборку
из исходников на своём Mac или дистрибутив с Developer ID от разработчика.

Физическая задержка и поведение конкретного ESP32 ещё требуют проверки.
Все данные остаются на вашем Mac; RGB передаётся только включённым WLED.
TEXT
ditto -c -k --sequesterRsrc --keepParent "$PACKAGE" build/NEURAL-LIGHT-macOS-arm64.zip
printf 'Archive: %s/build/NEURAL-LIGHT-macOS-arm64.zip\n' "$PWD"
