// buildUpdate.ts — детект «произошло обновление сайта» (вариант 1).
// При сборке vite подставляет уникальный BUILD_ID (см. vite.config.ts).
// Клиент сравнивает его с последним виденным значением в localStorage:
// если ID изменился — значит с момента прошлого визита был задеплоен новый билд.
// localStorage может быть недоступен (приватный режим/запрет) — все операции
// оборачиваем в try/catch, при ошибке считаем что обновления нет.

export const BUILD_ID_KEY = 'nison_build_id';
const LS_UNAVAILABLE = '__ls_unavailable__';

/** Текущий id сборки; undefined в тестовой среде (vitest не инжектирует define). */
export function currentBuildId(): string | undefined {
  return import.meta.env.VITE_BUILD_ID || undefined;
}

function lsGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return LS_UNAVAILABLE;
  }
}

function lsSet(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* приватный режим — молча игнорируем */
  }
}

/** true, если это первый визит на текущий билд (ID отличается от сохранённого). */
export function isNewBuild(id: string | undefined = currentBuildId()): boolean {
  if (!id) return false;
  const seen = lsGet(BUILD_ID_KEY);
  if (seen === LS_UNAVAILABLE) return false; // нет хранилища — не показываем баннер
  return seen !== id;
}

/** Зафиксировать просмотр текущего билда (скрыть индикатор обновления). */
export function markBuildSeen(id: string | undefined = currentBuildId()): void {
  if (!id) return;
  lsSet(BUILD_ID_KEY, id);
}
