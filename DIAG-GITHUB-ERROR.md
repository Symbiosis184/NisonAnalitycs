# Диагностика ошибки GitHub: `Validation Failed; No commits between main and code-review-b8517`

## Причина

Pull request **#16** (`code-review-b8517` → `main`) был **уже смержен 25.10.2026**, но слияние
проходило через отдельную ветку `qwen-fix-review`. Из-за этого head-коммит PR (`b84c26fd`)
**не стал потомком `main`**: содержимое попало в `main` другим путём, а сама ветка
`code-review-b8517` осталась на старом коммите и теперь полностью «содержится» в `main`
по содержимому. GitHub вычисляет пустой diff между base и head и при любой повторной
операции по такому PR отвечает `422 Validation Failed: No commits between ...`.

Проверено (git ls-remote + API compare):
- `refs/heads/main` = `4cd9f258` (включает ВСЁ содержимое `b84c26fd`: гэпы Нисона `a016bbb1`,
  CI audit `99d0f5a7/b84c26fd`, порог стопа `48db906b` — подтверждено `git merge-base --is-ancestor`).
- Старый head `b84c26fd` не является предком `main` → формальный diff для PR #16 пуст.

## Что сделано (верифицировано push-ем и git ls-remote)

1. Ветка `code-review-b8517` обновлена: `b84c26fd` → `36ce7649`
   (merge-commit актуального `main` `4cd9f258` + `b84c26fd`; конфликтов нет, тесты 232 passed).
   Теперь `compare/main...code-review-b8517` отдаёт статус `ahead` вместо ошибки.
2. Создана ветка `qwen-code-b8517b3a-6f89-4e07-8948-b218bd6318f5` = тот же `36ce7649`
   (для задачи платформы с этим id).
3. В репозитории открыт issue **#17** («diag-test») как маркер диагностики.

## Что нужно сделать вручную (у текущего PAT нет прав Pull requests: Write — API отвечает 403)

- Создать новый PR: **base = `main`, head = `code-review-b8517`** (или `qwen-code-b8517b3a-…`).
  Он будет **пустым по дизайну** — это корректное состояние после мержа, ошибок больше не будет.
- Закрыть/удалить старый PR #16 из интерфейса платформы.
- Удалить диагностический issue: `gh issue delete 17` (или через веб-интерфейс).

## Безопасность

Оба GitHub PAT были переданы в открытом виде в чате — **немедленно отозвать**
(Settings → Developer settings → Personal access tokens) и выпустить новый с правами
Contents: Read/Write (+ Pull requests: Write, если нужны PR из CLI).
