# Apple design references

Проверено 14 ноября 2026 года. Исследование для переработки интерфейса NEURAL LIGHT; глобальная установка скиллов не выполнялась.

## Найденные скиллы

Прочитаны файлы из исходных репозиториев авторов, а не переупакованные копии:

- [SwiftUI Expert — Antoine van der Lee](https://github.com/AvdLee/SwiftUI-Agent-Skill/blob/main/skills/swiftui-expert-skill/SKILL.md). Разработка под macOS/iOS, управление состоянием, адаптивные окна, доступность. Для текущего проекта особенно полезны [macOS window styling](https://github.com/AvdLee/SwiftUI-Agent-Skill/blob/main/skills/swiftui-expert-skill/references/macos-window-styling.md) и [Liquid Glass](https://github.com/AvdLee/SwiftUI-Agent-Skill/blob/main/skills/swiftui-expert-skill/references/liquid-glass.md).
- [SwiftUI Liquid Glass — FloWritesCode](https://github.com/FloWritesCode/fwc-swiftui-skills/blob/main/skills/swiftui-liquid-glass/SKILL.md). Нативные API, группировка стеклянных элементов, ограничение эффекта областью управления, отсутствие лишних вложенных обводок.
- [SwiftUI Pro — Paul Hudson](https://github.com/twostraws/SwiftUI-Agent-Skill/blob/main/swiftui-pro/SKILL.md). Прочитаны разделы [Design](https://github.com/twostraws/SwiftUI-Agent-Skill/blob/main/swiftui-pro/references/design.md) и [Accessibility](https://github.com/twostraws/SwiftUI-Agent-Skill/blob/main/swiftui-pro/references/accessibility.md): единые токены, гибкая компоновка, зоны касания от 44 × 44, подписи для VoiceOver, уважение Reduce Motion.

Рекомендации по конкретным SwiftUI API применимы только к нативным SwiftUI-представлениям. Они не требуют переписывать существующий React-редактор.

## Что брать из Apple HIG

Liquid Glass выделяет плавающий слой управления и навигации над содержимым. Стеклянные карточки внутри основного содержимого нарушают эту иерархию. Для NEURAL LIGHT это означает крупный непрерывный предпросмотр света и небольшую отдельную группу основных контролов. [Apple: Materials](https://developer.apple.com/design/human-interface-guidelines/materials).

Эффект следует применять экономно; соседние действия объединять по смыслу. Окно должно свободно менять размер, а параметры доступности — уменьшать прозрачность и движение. Нативные панели используют системные API, которые сами учитывают эти настройки. [Apple: Adopting Liquid Glass](https://developer.apple.com/documentation/technologyoverviews/adopting-liquid-glass).

На Mac важны управление клавиатурой, изменение размеров окна и ожидаемое поведение меню. На iPhone — удобные касания, читаемость и адаптация к компактному экрану. Это рекомендации для адаптивного редактора; они не означают наличие отдельной iOS-сборки. [Apple: Designing for macOS](https://developer.apple.com/design/human-interface-guidelines/designing-for-macos), [Apple: Designing for iOS](https://developer.apple.com/design/human-interface-guidelines/designing-for-ios).

## Решение для этого проекта

Основной экран: название текущей сцены, свет, выбор сцены, воспроизведение и яркость. Настройки, оборудование, граф, таймлайн и диагностика открываются по запросу. Частота кадров и транспортные показатели не занимают постоянное место на экране.

React/WKWebView может воспроизвести композицию и полупрозрачную поверхность через CSS. Это оформление в духе Liquid Glass, а не системный материал Apple: настоящий материал предоставляют SwiftUI `glassEffect`, AppKit `NSGlassEffectView` и стандартные системные компоненты. Не называть CSS-размытие нативным Liquid Glass. Для совместимости сохранять непрозрачный fallback, `prefers-reduced-motion`, `prefers-reduced-transparency` и достаточный контраст.

Проверять основной пользовательский путь, клавиатуру, VoiceOver-метки, увеличенный текст и ширины 320/390/768/1440. Небольшой шрифт и низкая контрастность не должны становиться способом уменьшить количество информации.
