# Локальные шрифты

Эти файлы лежат в репозитории, поэтому GitHub Pages не делает запросов к внешнему каталогу шрифтов. Лицензионные тексты сохранены рядом с файлами шрифтов.

## Newsreader

- Источник: [productiontype/Newsreader](https://github.com/productiontype/Newsreader), каталог `fonts/variable/woff2`.
- Файлы: `Newsreader-Variable.woff2` и `Newsreader-Variable-Italic.woff2`.
- Лицензия: SIL Open Font License 1.1, см. `Newsreader-OFL.txt`.
- Это оригинальные variable WOFF2-файлы из официального репозитория; они не перекодировались.

## Commit Mono

- Источник: [eigilnikolajsen/commit-mono](https://github.com/eigilnikolajsen/commit-mono), архив релиза `CommitMono-1.143.zip`.
- В репозиторий положены regular 400 и 700 из `ttfautohint`, преобразованные в WOFF2 локально с fontTools 4.63.0: `CommitMono-400.woff2` и `CommitMono-700.woff2`.
- Лицензия шрифта: SIL Open Font License 1.1, см. `CommitMono-OFL.txt` (официальный `LICENSE-FONT`). Код сайта Commit Mono распространяется отдельно под MIT и сюда не включён.

## Кириллица и fallback

Newsreader и Commit Mono в этих официальных сборках не содержат русских букв `А–Я`, `а–я` и `Ёё`. Они содержат нужную латинскую графику и базовую пунктуацию, включая `№`, кавычки и тире. Для русских подписей браузер использует следующий шрифт в CSS-стеке, а для чисел и латинских подписей — локальный файл. Поэтому кириллица не зависит от отсутствующего glyph coverage и не превращается в квадраты.

Проверка покрытия выполнена через fontTools: Newsreader — 564 кодовых точки, Commit Mono — 1 209; русские буквы отсутствуют в обоих файлах.
