import { useEffect } from 'react';
import { Sparkles, X } from 'lucide-react';
import { useI18n } from '../i18n';

interface Props {
  /** Показывать баннер */
  visible: boolean;
  /** Скрыть (фиксирует просмотр текущего билда) */
  onDismiss: () => void;
}

/**
 * Баннер «Обновление сайта» на главной странице.
 * Появляется один раз после нового деплоя (BUILD_ID изменился — см. utils/buildUpdate).
 * Авто-исчезает через 10 секунд; закрытие крестиком — по клику.
 */
export default function UpdateBanner({ visible, onDismiss }: Props) {
  const { t } = useI18n();

  useEffect(() => {
    if (!visible) return;
    const id = setTimeout(onDismiss, 10_000);
    return () => clearTimeout(id);
  }, [visible, onDismiss]);

  if (!visible) return null;

  return (
    <div
      role="status"
      data-testid="update-banner"
      className="flex items-center justify-between gap-3 px-4 py-2.5 rounded-xl border border-amber-500/40 bg-amber-500/10 text-amber-300"
    >
      <span className="flex items-center gap-2 text-sm font-medium min-w-0">
        <Sparkles className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
        <span className="truncate">{t('Сайт обновлён — вышел новый релиз')}</span>
      </span>
      <button
        onClick={onDismiss}
        aria-label={t('Закрыть')}
        className="p-1 rounded-md hover:bg-amber-500/20 transition-colors flex-shrink-0"
      >
        <X className="w-4 h-4" aria-hidden="true" />
      </button>
    </div>
  );
}
