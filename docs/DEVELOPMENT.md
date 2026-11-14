# Продолжение разработки NEURAL LIGHT

Этот документ — карта проекта для Серёги и его агента. Общие рабочие правила находятся в корневом [AGENTS.md](../AGENTS.md), запуск с нуля — в [FOR-SERGEY.md](FOR-SERGEY.md).

## Два режима одного продукта

| Режим | Как запустить | Кто считает свет | Передача WLED |
|---|---|---|---|
| Браузерный симулятор | `npm run dev`, порт 5173 | TypeScript, Web Audio | Нет |
| Приложение Mac | `npm run app:build`, затем открыть `.app` | Swift/Accelerate + Metal; CPU fallback | Да, после явного включения |

React отвечает за редактор, а не за realtime clock. В приложении AppKit запускает локальный движок и WKWebView с собранными ресурсами. Световой RGB-кадр поступает в интерфейс через WebSocket; 3D-предпросмотр использует этот кадр и не генерирует отдельный выход на ленту.

Реализация интерфейса адаптируется к экрану телефона, но отдельного iOS-приложения нет. Прозрачные панели сделаны средствами CSS/WebKit и не являются системным API Liquid Glass.

## Окружение и обычный цикл

- Целевой компьютер: Apple Silicon, macOS 14+.
- Node.js 22.12+; зависимости устанавливать через `npm ci` по `package-lock.json`.
- В `native/Package.swift` указан `swift-tools-version: 5.9`; опубликованные локальные проверки выполнены Swift 6.4.2. Не обещать поддержку непроверенного toolchain по одному номеру в manifest.
- Google Chrome для Playwright. Внешние модели и платные API для запуска не нужны.

Перед правкой посмотри `git status` и соответствующие модули. Для отдельной задачи удобно создать ветку:

```sh
git switch -c feature/short-name
npm ci
npm run dev
```

Изменение React/CSS видно сразу на порту 5173. Для проверки внутри WKWebView заверши запущенный NEURAL LIGHT через `⌘Q`, затем:

```sh
npm run app:build
open "build/NEURAL LIGHT.app"
```

`app:build` собирает web и native, копирует ресурсы в bundle и ставит ad-hoc подпись. Не редактируй `dist/`, `build/` или `native/.build/` как исходники: они пересоздаются. Архивирование не входит в текущую передачу проекта; `app:package` для обычной разработки не нужен.

## Где что менять

| Задача | Основные файлы |
|---|---|
| Экран, открытие панелей, сохранения, выбор источника | `src/App.tsx` |
| Настройки цвета и скорости | `src/components/Inspector.tsx` |
| Звук и экран, объяснение деморитма | `src/components/SourcePanel.tsx`, `src/runtime/audio.ts` |
| Библиотека и изображения эффектов | `src/components/Scenes.tsx`, `src/styles-library.css` |
| Прозрачное стекло | `src/styles-glass.css` |
| Компоновка главного экрана | `src/styles.css`, `src/styles-studio.css` |
| Переходы, focus trap и закрытие по Escape | `src/components/useAnimatedDialog.ts`, `src/styles-motion.css` |
| Предпросмотр комнаты | `src/components/preview/RoomSimulator.tsx` |
| Canvas fallback комнаты | `src/components/preview/RoomPreview.ts` |
| Выбор WebGL/Canvas и схема LED | `src/components/Simulator.tsx` |
| Редактор физических координат | `src/components/Mapping.tsx`, `src/engine/mapping.ts` |
| Граф и таймлайн | `src/components/NodeEditor.tsx`, `src/engine/graph.ts`, `src/components/Timeline.tsx` |
| Модель сцены и примеры | `src/engine/types.ts`, `src/engine/presets.ts`, `examples/*.json` |
| Browser DSP, эффекты, смешивание кадров | `src/engine/dsp.ts`, `effects.ts`, `frame-transition.ts` |
| Runtime, бинарные кадры, телеметрия и reconnect | `src/runtime/runtime.ts` |
| Swift DSP, CPU-эффекты, mapping, протоколы пакетов | `native/Sources/NeuralCore/` |
| Нативный clock, GPU, захват, WebSocket и UDP | `native/Sources/NeuralRuntime/` |
| Окно Mac, файлы, разрешения bundle | `native/Sources/NeuralLightApp/`, `scripts/build-app.sh` |
| CLI движка и CPU-бенчмарк | `native/Sources/NeuralLight/main.swift` |

`styles.css` импортирует стили профессиональных панелей; специализированные стили подключаются из `App.tsx` после него. Проверяй порядок и специфичность селекторов, прежде чем добавлять очередное переопределение.

## Изменение светового алгоритма требует согласования трёх реализаций

Один эффект исполняется в TypeScript, Swift CPU и Metal. Правка только браузерной функции не меняет аппаратный вывод из приложения.

При добавлении эффекта проверь:

1. ID, модель и валидацию: `types.ts`, `presets.ts`, `native/Sources/NeuralCore/Scene.swift`.
2. Формулы: `src/engine/effects.ts`, `NeuralCore/Effects.swift`, `NeuralRuntime/Shaders.metal`.
3. Порядок ID и упаковку GPU-параметров: `Scene.effects`, `NeuralRuntime/MetalRenderer.swift`.
4. Палитры, граф, таймлайн, интерфейс выбора, переносимый пример в `examples/`.
5. Тесты и соответствие Metal/CPU. При изменении схемы обнови [PROTOCOL.md](PROTOCOL.md) и продумай чтение старых сохранений.

Аналогично синхронизируй TypeScript/Swift при изменении FFT, mapping и crossfade. Изменение обычной подписи или layout не требует переписывать движок.

## Что сохранять при развитии

- Кадры обновляются вне React state. В React передаются редкие снимки телеметрии и состояние редактора.
- Нативный clock целится в 60 Hz. Поздний кадр пропускается, а не ставится в растущую очередь.
- На контроллер максимум один ожидающий кадр; общая история компенсации ограничена 64 кадрами. Сохраняй ограничения и восстановление частоты после перегрузки.
- Выбор готовой/сохранённой сцены плавно смешивает кадры. Изменение топологии, нулевая яркость и Reduce Motion отменяют переход. Переходы фрагментов таймлайна пока мгновенные.
- Предметный 3D-вид — пример установки за монитором. Он читает реальные цвета кадра шестью источниками света, но не является фотометрией и не меняет физические координаты LED.
- Three.js загружается отдельным модулем; на потерю WebGL есть Canvas fallback. Освобождай RAF, listeners, observers, geometry, materials, textures и renderer при размонтировании. Не добавляй сетевые ассеты в обязательный путь запуска.
- Не превращай главный экран в диагностику. Подробности дизайна: [DESIGN.md](DESIGN.md), [UX-REVIEW.md](UX-REVIEW.md), [CLEAR-GLASS.md](CLEAR-GLASS.md). Обоснование 3D: [3D-SKILLS-RESEARCH.md](3D-SKILLS-RESEARCH.md).

## Сохранения и разрешения

Данные хранятся в `localStorage`, а не в репозитории:

| Ключ | Содержимое |
|---|---|
| `neural-light.scene.v1` | Текущая сцена |
| `neural-light.presets.v1` | Библиотека пользовательских сцен |
| `neural-light.devices.v1` | Настройки контроллеров |
| `neural-light.preview.v1` | Вид комнаты или схемы |

У браузера на 5173 и WKWebView на 8743 раздельное хранилище. Переносить сцены нужно через JSON export/import. Сначала экспортируй пользовательские данные, если задача действительно требует их сброса.

При старте источник возвращается в `demo`, движение включается, а сохранённые контроллеры загружаются с выключенной отправкой. Доступ к микрофону и экрану включается только по выбору пользователя. Деморитм не должен начинать звучать сам; его прослушивание — отдельное действие. В `audio.ts` generation token защищает от позднего запуска после выключения/закрытия — не убирай эту защиту при изменении AudioContext.

## Локальные порты и протокол

| Порт | Назначение |
|---|---|
| TCP 5173 | Vite, только 127.0.0.1 |
| TCP 8742 | WebSocket движка, только loopback |
| TCP 8743 | Локальные web-ресурсы `.app` |
| UDP 4048 | DDP к выбранному контроллеру |
| UDP 21324 | DNRGB к выбранному контроллеру |
| TCP 18742 | Отдельный engine интеграционного теста |

WebSocket требует временный session token. Нативное окно получает его автоматически. Для разработки редактора с живым Swift-движком закрой `.app`; в двух терминалах запусти:

```sh
# Терминал 1
npm run dev
```

```sh
# Терминал 2
npm run native:build
native/.build/release/neural-light-engine --port 8742 --print-url
```

Открой URL, напечатанный вторым процессом, только локально. Он содержит временный токен; не коммить его и не включай в публичные скриншоты. Не расширяй bind с loopback для обычной разработки. Команды, схема бинарного RGB-кадра и ограничения описаны в [PROTOCOL.md](PROTOCOL.md).

## Проверки по типу изменения

| Изменение | Минимальная подходящая проверка |
|---|---|
| React/CSS, тексты, панели | `npm run build`; затронутые сценарии `npm run test:ui`; посмотреть desktop/mobile скриншоты |
| Browser runtime, audio, pure core | `npm test`, `npm run build`; UI-сценарий затронутой функции |
| Swift/Metal, сцена, общая формула эффекта | `npm test`, `npm run native:test`, `npm run app:build`; визуальный запуск `.app` |
| WebSocket/UDP/ограничение нагрузки | `npm run native:build`, затем `npm run test:integration`; профильные unit-тесты |
| Геометрия/свет/производительность 3D | UI-тесты и скриншоты, проверка fallback, отдельный preview-бенчмарк |

Команды из корня проекта:

```sh
npm test
npm run build
npm run native:test
npm run test:ui
npm run native:build
npm run test:integration
```

`npm run verify` объединяет TS-тесты, web-сборку и Swift-тесты; UI и интеграция запускаются отдельно. Playwright поднимает dev-сервер сам или использует уже запущенный на 5173. Убедись, что существующий сервер принадлежит этому checkout. `test:integration` использует UDP loopback на 4048/21324, не реальные контроллеры.

Для измерений:

```sh
npm run bench
native/.build/release/neural-light-engine --benchmark
# При отдельно запущенном npm run dev:
node scripts/preview-benchmark.mjs
```

Не запускай нагрузочные измерения параллельно со сборкой и другими тестами. Замеры и скриншоты записываются в `artifacts/`; проверь diff перед коммитом. Частота браузерного кадра, время нативного рендера и задержка «звук → физический свет» — разные измерения. Условия прежних результатов есть в [BENCHMARKS.md](BENCHMARKS.md); повтори замер на новой машине, прежде чем обещать те же числа.

## Текущее состояние передачи

Доступны симулятор, Swift/Metal-движок, узлы, таймлайн, пресеты, mapping, управление несколькими адресами и компенсация вручную измеренной задержки. Код проверен без реальных ESP32, включая UDP loopback. Реальная лента, Wi-Fi-потери, захват с разрешениями пользователя и длительная стабильность требуют [аппаратного прогона](HARDWARE-CHECK.md).

Пока не реализованы автообнаружение WLED, RGBW, отдельные области экрана для каждого LED, crossfade фрагментов таймлайна и автоматическое физическое измерение задержки. Выбор следующего шага привязывай к задаче Серёги, а не к необходимости переписать уже рабочую архитектуру.
