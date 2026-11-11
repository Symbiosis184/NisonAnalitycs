## Nison audit fixes — PR #40

Ветка `nison-audit-fixes` (head `3816f74`) против `main` (`346ed4a`). Аудит кода детектора свечных моделей по канону С. Нисон («Японские свечи», «За пределами японских свечей») с исправлениями и регресс-тестами.

### 1. Результаты проверок (полный цикл)

| Проверка | Команда | Результат |
|---|---|---|
| Typecheck | `tsc --noEmit` | ✅ 0 ошибок |
| Тесты | `vitest run` | ✅ **46 файлов / 391 тест — все зелёные** |
| Build | `vite build` | ✅ успешно, `dist/` пересобран и закоммичен (`3816f74`) |

### 2. Таблица исправлений

| ID | Модель / модуль | Проблема | Исправление | Коммит | Регресс-тест |
|---|---|---|---|---|---|
| P0-1 | Висельник (hanging man) | взаимоисключающие условия `atLocalHigh` → модель не детектировалась | хелпер `atLocalHighBodyUp` | `89295fe` | `nison_audit_regressions.test.ts` |
| P0-2 | Семейство «ниже шеи» / «на шее» | привязки не соответствовали канону ЯС | приведены к канону (`isNeckFamily`) | `45d260a` | `nison_audit_regressions.test.ts` |
| P0-3 | Downgap side-by-side white lines | **ошибочная реализация**: введена ветка с ЧЁРНЫМИ свечами, метод `isGappingSideBySideLegacy`, ID `SIDE_BY_SIDE_GAP_BLACK_DOWN` | **отменено (#A1)**: удалены чёрная ветка/legacy-метод/ID и их вызовы; возвращена каноническая форма — ДВЕ БЕЛЫЕ свечи после гэпа вниз на падающем рынке, медвежье продолжение (гл. 7 ЯС, глоссарий А). Имя `ГЭП СМЕЖНЫХ БЕЛЫХ СВЕЧЕЙ (ВНИЗ)` сохранено | `c256338` | `nison_canon_fixes.test.tsx` |
| A1b | `patternStory` (patterns.ts) | нисходящий гэп смежных белых свечей получал бычий текст «продолжение роста» | явная медвежья ветка ДО общей | `ee2b7d6` | тест на описание в `nison_canon_fixes.test.tsx` |
| P1-1 | Завеса / Просвет | жёсткий гэп там, где канон допускает адаптивный overlap (вариант A) | адаптивный допуск; метки `(ГЭП)` только при настоящем разрыве; фикстура STOCKS | `323ea46` | `nison_audit_regressions.test.ts` |
| P1-2 | `nearestStructuralTarget` | равное расстояние → выбирался свинг вместо S/R-зоны | приоритет зоны над свингом | `60ad372` | регресс через мок `ZoneVoter.collect` |
| P1-3 | `candle.gapUpFrom/gapDownFrom` | гэп считался по телам, а не по диапазонам | гэп = разрыв диапазонов (канон «Окна») | `20e9e6f` | `nison_audit_regressions.test.ts` |
| P1-4 | UI «Consensus Score» | балл /95 подавался как процент confidence | переименовано в UI в «Широта согласия» (балл /95), формула не изменена | `d288e71` | `nison_audit_regressions.test.ts` |
| P2-1a | Завеса / Просвет | абсолютная длина тела вместо относительной | относительная длина по канону «Построение свечей» | `3259902` | `nison_audit_regressions.test.ts` |
| P2-1e | Лестничное дно | отклонения от канона гл. 6 | остановка 4-й свечи (`close >= c3.close`), разворотная длинная белая над максимумами `c4/c5.open`, `formationSize=5`, эталонная фикстура + негативные кейсы | `bae6474` | `ladder_bottom_fixture.test.ts` |
| P2-1f | Advance block | альтернативный признак по теням | только канонический признак убывающих тел (гл. 7 ЯС) | `bdb91a0` | `nison_audit_regressions.test.ts` |
| P2-2 | `isLevelTest` | EMA вместо SMA | SMA (канон «Скользящие средние», согласованность с `zone_voter`) | `cfd0c84` | `nison_audit_regressions.test.ts` |
| P2-3 | Renko | кирпич от тела предыдущего → перекрытие при развороте, нулевая длительность | кирпич от границы предыдущего кирпича | `655155c` | `nison_p3_regressions.test.ts` |
| P2-4 | Три белых солдата / `isFlatMarket` | требовался спад вместо базы/консолидации; NaN-guard при истории <65 баров | база/консолидация допустима (гл. 7); усечённое окно SMA | `d46b93c` | `nison_audit_regressions.test.ts` |
| P2-5 | `isVolSpin` | новый экстремум давал автоматический pos=0/1 | позиция по окну предшествующих свечей | `fbd0e58` | `nison_audit_regressions.test.ts` |
| P2-6 | Лестничное дно | отсутствовало требование нисходящего контекста | `precededByDeclineOrFormation` с fallback по ступеням формации | `7f8f093` | `nison_audit_regressions.test.ts` |
| P2-7 | Отбитое наступление | заметность убывания тел по медиане предыстории | порог по формации (`c3 <= 0.6*c1`) | `f373ea2` | `nison_audit_regressions.test.ts` |
| P3-1 | `isDoji` | нулевой диапазон трактовался как дожи | контракт: нулевой диапазон = неликвидность, не дожи | `ed223d5` | `nison_p3_regressions.test.ts` |
| P3-2 | `isEngulfing` | толерантные неравенства границ тел | проектное ужесточение (строгие неравенства) | `ed223d5` | `nison_p3_regressions.test.ts` |
| P3-3 | Kagi | без документации ограничения стиля инь/ян | JSDoc: стиль инь/ян на сегмент целиком, без смены толщины внутри вертикали (ЗГ Kagi) | `b78c30d` | — (docs) |
| P3-4 | `mkGap` | `prevClose` = граница зоны вместо реального закрытия предыдущего бара | `prevClose` = реальное закрытие предыдущего бара (по контракту GapDTO) | `f274560` | `nison_p3_regressions.test.ts` |
| P3-5 | `detectGaps` | статусы fill/break за O(n·m) | один обратный проход O(n+g), семантика `time > g.time` сохранена | `f274560` | `nison_p3_regressions.test.ts` |
| P3-6 | `collectSwingLevels` | дубли уровней на плато (асимметрия `>` prev / `>=` next) | дедупликация уровней | `83acd88` | `nison_p3_regressions.test.ts` |

### 3. Затронутые файлы

`src/utils/pattern_engine.ts`, `pattern_ids.ts`, `patterns.ts`, `candle.ts`, `gaps.ts`, `nison_targets.ts`, `trend_detection.ts`, `beyond_candlesticks.ts`; `src/i18n/dictionaries.ts`; `src/components/analysis/MarketContextSection.tsx`, `src/pages/Dashboard.tsx`; тесты: `nison_audit_regressions.test.ts`, `nison_canon_fixes.test.tsx`, `nison_p3_regressions.test.ts`, `ladder_bottom_fixture.test.ts`, `beyond_candlesticks.test.ts`, `nison_trend_filter.test.ts`; пересобранный `dist/`.

### 4. Известные ограничения

- Задачи **A2–A6** из плана возобновления не выполнены: спецификации задач не были переданы исполнителю (в вводных содержались только A1/A1b/A8). Могут быть добавлены отдельными атомарными коммитами со спецификациями.
- `node_modules/.vite/vitest/.../results.json` случайно попал в diff ветки (кэш vitest) — не влияет на сборку; можно удалить follow-up коммитом при желании.
