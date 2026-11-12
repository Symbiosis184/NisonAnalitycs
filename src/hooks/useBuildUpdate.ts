import { useState } from 'react';
import { currentBuildId, isNewBuild, markBuildSeen } from '../utils/buildUpdate';

/**
 * Индикатор обновления сайта на главной странице.
 * hasUpdate — новый билд ещё не просматривался (отличается от localStorage).
 * dismiss — скрыть индикатор (фиксирует текущий BUILD_ID как просмотренный).
 */
export function useBuildUpdate() {
  const [hasUpdate, setHasUpdate] = useState<boolean>(() => isNewBuild());
  const dismiss = () => {
    markBuildSeen();
    setHasUpdate(false);
  };
  return { hasUpdate, dismiss, buildId: currentBuildId() };
}
