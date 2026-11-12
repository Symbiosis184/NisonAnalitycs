import { useState } from 'react';
import { currentBuildId, isNewBuild, markBuildSeen } from '../utils/buildUpdate';

/**
 * Индикатор обновления сайта на главной странице.
 * hasUpdate — новый билд ещё не просматривался (отличается от localStorage).
 * dismiss — скрыть индикатор (фиксирует текущий BUILD_ID как просмотренный).
 */
export function useBuildUpdate() {
  const [hasUpdate, setHasUpdate] = useState<boolean>(() => {
    const fresh = isNewBuild();
    // Баннер «одноразовый»: сразу фиксируем билд как просмотренный, иначе он
    // появлялся бы при каждой перезагрузке. Гаснет индикатор по кнопке (dismiss)
    // либо через 10 с авто-скрытия в UpdateBanner.
    if (fresh) markBuildSeen();
    return fresh;
  });
  const dismiss = () => {
    markBuildSeen();
    setHasUpdate(false);
  };
  return { hasUpdate, dismiss, buildId: currentBuildId() };
}
