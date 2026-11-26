// Zone Voter — книжные ориентиры S/R плюс явно числовые эвристики проекта.
// Свинги, полярность, длинные тела и окна связаны с книгами; допуски, ATR-ширина,
// круглые числа, лимиты и баллы являются настройками реализации, а не цитатами.
// Ключевые принципы:
// 1. Уровни - это ЗОНЫ, а не точные цены
// 2. Количество касаний определяет силу
// 3. Объём подтверждает значимость
// 4. Полярность: пробитое сопротивление становится поддержкой
// 5. Кластеризация близких уровней
// 6. Уровни Фибоначчи (гл. 12)

import { Candle } from './candle';
import { sma } from './indicators';
import {
  findSwings, addLevelToMap, dedupeZones,
  type BookBandGeom, type BookBandRole, type ZoneClusterData, type ZoneSource,
} from './levels';
import { detectGaps } from './gaps';

export type ZoneMarket = 'stock' | 'crypto';

/**
 * Геометрия книжных зон: [lo … hi] вокруг level=середина, halfWidth=половина ширины.
 * Используется источниками с явной книжной геометрией (long-body, window).
 */
type BookBand = BookBandGeom;

/** Wilder ATR (последнее значение) по закрытым свечам; 0 при нехватке данных. */
function atrWilder(candles: Candle[], period = 14): number {
  if (candles.length <= period) return 0;
  let atr = 0;
  for (let i = 1; i <= period; i++) {
    const c = candles[i], p = candles[i - 1];
    atr += Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close));
  }
  atr /= period;
  for (let i = period + 1; i < candles.length; i++) {
    const c = candles[i], p = candles[i - 1];
    const tr = Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close));
    atr = (atr * (period - 1) + tr) / period;
  }
  return atr;
}

export interface Zone {
  level: number;
  votes: number;
  strong: boolean;
  reasons: string[];
  /** Независимые книжные/проектные источники; один источник даёт один голос. */
  sources: ZoneSource[];
  touches: number;
  lastTouch?: number;
  /**
   * Ширина ЗОНЫ (по Нисону уровень — это зона, а не линия): ±halfWidth вокруг level.
   * Для источников с явной книжной геометрией (long-body, window) halfWidth равна
   * половине высоты книги-полосы и НЕ расширяется ATR-допуском проекта (см. задачу 5).
   * Для остальных источников halfWidth = max(толеранс ТФ × level, 0.25×ATR(14))
   * с потолком 2×ATR — это проектная эвристика, в книгах такого числа нет.
   */
  halfWidth: number;
  /** Время формирования зоны (для учёта "свежести"). */
  formedAt: number;
  /**
   * ЗАДАЧА 9 (ЯС гл. 11): суммарный относительный объём баров-касаний
   * (v/avgVolume lookback, потолок 5×). Принцип книжный («объемы торгов во
   * время попыток пробоя» влияют на значимость), КОНКРЕТНАЯ ФОРМУЛА —
   * настройка проекта, не из книг. Используется в тай-брейке significance.
   */
  touchVolume?: number;
  /**
   * Внутреннее поле: явная книжная полоса [lo … hi] с ролью (long-body/window).
   * Используется для маршрутизации по пробитию/полярности в collect().
   */
  bookBand?: BookBandGeom & { startCheckIndex?: number };
}

/** Ключ временнóго масштаба для кэша результатов collect (см. timeframeKey). */
export type TimeframeKey = 'scalp' | 'intraday' | 'swing' | 'position';

/**
 * Группировка интервалов Bybit по временнóму масштабу.
 * ИСПРАВЛЕНО: правильная иерархия проверки — месячные/недельные проверяются ДО минутных,
 * чтобы '1M' (месяц) не попадал в 'scalp'.
 */
export function timeframeKey(tf: string): TimeframeKey {
  const raw = tf.trim();
  const upper = raw.toUpperCase();

  // 1. POSITION: Месячные и Недельные ТФ (Макро-масштаб)
  // Проверяем ДО скальп-логики, чтобы '1M' (месяц) не попал в 'scalp'
  if (/^([123]?MO?|M|W|1W)$/i.test(upper)) return 'position';

  // 2. SWING: Дневные ТФ (Классический масштаб)
  if (/^(D|1D)$/i.test(upper)) return 'swing';

  // 3. INTRADAY: Часовые и 30-минутные ТФ
  if (/^(30|60|120|240)(M|MIN)?$/i.test(upper)) return 'intraday';
  if (/^[124]H$/i.test(upper)) return 'intraday';
  if (['60', '1H', '2H', '4H'].includes(upper)) return 'intraday';

  // 4. SCALP: Минутные ТФ (1м, 3м, 5м, 15м)
  if (/^(1|3|5|15)(M|MIN)?$/i.test(upper)) return 'scalp';
  if (['1', '3', '5', '15'].includes(raw)) return 'scalp';

  // Fallback: безопасное отнесение к макро-масштабу
  console.warn(`[Nison Engine] Неизвестный таймфрейм "${tf}". Применен fallback: position.`);
  return 'position';
}

interface ZoneParams {
  tolerance: number;
  breakPct: number;
  lookback: number;
  /** Глубина окна свинг-детектора (±span свечей): на грубее ТФ — крупнее экстремумы */
  swingSpan: number;
  /**
   * ЗАДАЧА 8 (опционально, по умолчанию ВЫКЛЮЧЕН): дожи как книжный источник зон.
   * Книга (ЯС гл. 8): «Дожи иногда задают зоны поддержки и сопротивления,
   * особенно если образуются в районе значимых вершин и оснований»
   * (рис. 8.17–8.18); ЗГ гл. 2, рис. 2.37: максимум дожи (конец верхней тени)
   * нередко становится сопротивлением. Включается флагом среды
   * NISON_DOJI_ZONES=1 — проектное решение о способе активации, не из книг.
   */
  dojiZones?: boolean;
}

/**
 * Мелочь (аудит, не из книг): включатель дожи-зон. В браузерной сборке
 * process.env недоступен, поэтому читаем и Vite-переменную import.meta.env,
 * и явный программный override (для тестов/библиотечного использования).
 */
let dojiZonesOverride: boolean | undefined;
export function setDojiZonesOverride(enabled: boolean | undefined): void {
  dojiZonesOverride = enabled;
}
function readDojiZonesFlag(): boolean {
  if (dojiZonesOverride !== undefined) return dojiZonesOverride;
  try {
    if (typeof process !== 'undefined' && process.env?.NISON_DOJI_ZONES === '1') return true;
  } catch { /* process недоступен в браузере */ }
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const meta: any = import.meta;
    if (meta?.env?.VITE_NISON_DOJI_ZONES === '1') return true;
  } catch { /* import.meta недоступно (CJS/тест-раннер) */ }
  return false;
}

const ZONE_PARAMS: Record<TimeframeKey, ZoneParams> = {
  scalp:    { tolerance: 0.002, breakPct: 0.002, lookback: 200, swingSpan: 2 },
  intraday: { tolerance: 0.003, breakPct: 0.003, lookback: 180, swingSpan: 3 },
  swing:    { tolerance: 0.005, breakPct: 0.003, lookback: 150, swingSpan: 3 },
  position: { tolerance: 0.008, breakPct: 0.004, lookback: 150, swingSpan: 4 },
};

export class ZoneVoter {
  // Толеранс по умолчанию (дневной ТФ, историческая совместимость)
  private static readonly CLUSTER_TOLERANCE = 0.005;

  // Минимум голосов для сильной зоны
  private static readonly STRONG_ZONE_MIN_VOTES = 3;

  // FIX ТФ-канона: значимых зон не больше MAX_ZONES_PER_SIDE с каждой стороны
  private static readonly MAX_ZONES_PER_SIDE = 8;

  /** Кэш зависит от цены, масштаба и содержимого истории, не только от её длины. */
  private static collectCache = new Map<string, { support: Zone[]; resistance: Zone[] }>();
  private static readonly CACHE_MAX_SIZE = 10;

  private static historyFingerprint(candles: Candle[]): string {
    let hash = 2166136261;
    const mix = (value: number) => {
      hash ^= Math.round((Number.isFinite(value) ? value : 0) * 1e6);
      hash = Math.imul(hash, 16777619);
    };
    for (const candle of candles) {
      mix(candle.time);
      mix(candle.open);
      mix(candle.high);
      mix(candle.low);
      mix(candle.close);
      mix(candle.volume);
    }
    return (hash >>> 0).toString(36);
  }

  /**
   * Сбор всех зон с голосованием.
   * FIX: добавлена мемоизация для производительности.
   */
  static collect(
    price: number,
    candles: Candle[],
    tfKey: TimeframeKey = 'swing',
    market: ZoneMarket = 'crypto',
    overrides?: Partial<ZoneParams>,
  ): { support: Zone[]; resistance: Zone[] } {
    const lastCandle = candles[candles.length - 1];
    const cacheKey = [
      price,
      tfKey,
      market,
      candles.length,
      JSON.stringify(overrides ?? {}),
      this.historyFingerprint(candles),
    ].join('_');
    const cached = this.collectCache.get(cacheKey);
    if (cached) return cached;

    const params = { ...ZONE_PARAMS[tfKey], ...(overrides ?? {}) };
    // Аудит (мелочи): классификация источников (swing-корзины, MA) ведётся по
    // ПОСЛЕДНЕЙ ЗАКРЫТОЙ цене, а не по live-price аргумента `price` — единая
    // конвенция с финальной маршрутизацией collect (задача 3) и F2. Это
    // исключает ситуацию, когда зона заведётся в корзине «поддержка» по живой
    // цене, а последний закрытый бар уже ниже неё. Настройка проекта, не из книг.
    const lastClose = lastCandle?.close ?? price;
    // ЗАДАЧА 8: дожи как источник зон — по умолчанию ВЫКЛЮЧЕН; включается
    // только явным флагом (проектный способ активации, не из книг).
    // Мелочь (аудит): вместо голого process.env (не работает в браузере) —
    // readDojiZonesFlag(): import.meta.env / программный override / process.env.
    if (readDojiZonesFlag()) {
      params.dojiZones = true;
    }
    const supMap = new Map<number, ZoneClusterData>();
    const resMap = new Map<number, ZoneClusterData>();

    // Ширина зоны привязана к волатильности ТФ (ATR). Вычисляется ДО источников,
    // чтобы свинг-зоны (addTouchBasedLevels) использовали ту же проекную ATR-полосу,
    // что и финальная карта halfWidth в mapToZones (задача 5).
    const atrWindow = candles.length > 74 ? candles.slice(-60) : candles;
    const atrVal = atrWilder(atrWindow, 14);
    const zoneHalfWidth = (level: number) => {
      const base = Math.max(params.tolerance * level, atrVal * 0.25);
      return atrVal > 0 ? Math.min(base, atrVal * 2) : base;
    };

    // ПОРЯДОК ИСТОЧНИКОВ (аудит F6): сначала ТОЧЕЧНЫЕ источники (свинги, MA,
    // климакс, круглые числа, fib), затем КНИЖНЫЕ полосы с keepSeparate
    // (long-body, окно, дожи), и в конце — точечные polarity-уровни (они могут
    // совпадать с центром книжной полосы и не должны её искажать). Смысл
    // порядка: входящий книжный уровень не сливается в уже существующий
    // свинг-кластер (findClusterZone для keepSeparate-уровней отключён — F6 в
    // levels.ts; там же книжные полосы никогда не сливаются между собой —
    // каждая хранит точную геометрию), а polarity-точка после long-body не
    // поглощает книжную полосу (кластеры keepSeparate не притягивают точек).
    // Нумерация комментариев
    // ниже — исходная (1–9); фактический порядок вызовов отличается для
    // шага 2 (по пояснению в комментарии у addPolarityLevels).

    // 1. Касательная классификация: уровень + число касаний ценой после его образования
    this.addTouchBasedLevels(lastClose, candles, supMap, resMap, params, zoneHalfWidth);

    // 3. Скользящие средние как динамические уровни
    this.addMALevels(lastClose, candles, supMap, resMap, params.tolerance);

    // 4. Объёмные климасы (главы 15)
    this.addVolumeClimaxLevels(candles, supMap, resMap, params.tolerance);

    // 5. Длинное тело — одна зона [середина … основание/вершина свечи] (ЗГ гл. 2)
    this.addLongBodyLevels(candles, supMap, resMap, params);

    // 2. Полярность: пробитые УРОВНИ (свинги) меняют роль.
    // F6 (аудит): точечные polarity-уровни добавляются ПОСЛЕ книжных полос
    // (long-body выше), чтобы свинговый flip НЕ сливался с уже существующей
    // книжной полосой: при совпадении/близости центров точка «пробитая
    // поддержка → сопротивление» вливалась в полосу long-body той же свечи и
    // смещала её центр — отображаемая геометрия переставала быть книжной.
    // findClusterZone пропускает keepSeparate-кластеры, поэтому polarity-точка
    // образует ОТДЕЛЬНЫЙ кластер, а маршрутизация routeBookZones отдаёт
    // предпочтение книге: если в корзине есть непробитая книжная полоса,
    // пересекающаяся с зоной flip-точки, точка выбрасывается (это тот же
    // исходный эффект поглощения, но без искажения геометрии книги).
    // Точность книжной полосы приоритетна; confluence-голосование может
    // уменьшиться — это приемлемо (аудит F6). Проектное решение, не из книг.
    this.addPolarityLevels(lastClose, candles, supMap, resMap, params);

    // 6. Психологические круглые числа
    this.addRoundNumbers(price, supMap, resMap, params.tolerance, lastCandle?.time ?? 0);

    // 7. Уровни Фибоначчи (гл. 12)
    this.addFibonacciLevels(candles, supMap, resMap, params);

    // 8. Нисон: окно — будущая зона поддержки/сопротивления. Сохраняем его
    // фактические границы; закрытие за дальней границей отменяет сценарий.
    this.addWindowLevels(candles, supMap, resMap, params.tolerance, market);

    // 9. ЗАДАЧА 8 (по умолчанию выключена): дожи как зоны S/R вблизи значимых
    // вершин/оснований (ЯС гл. 8, рис. 8.17–8.18; ЗГ гл. 2, рис. 2.37).
    if (params.dojiZones) {
      this.addDojiLevels(candles, supMap, resMap, params, atrVal);
    }

    // Финальная транзитивная дедупликация
    dedupeZones(supMap, params.tolerance);
    dedupeZones(resMap, params.tolerance);

    // FIX: значимость определяется в первую очередь votes (независимые источники),
    // затем touches (касания), затем расстояние до цены.
    // По ЯС гл. 11: "Чем больше технических индикаторов сходятся в одной зоне,
    // тем выше вероятность того, что эта зона окажется значимой".
    // ЗАДАЧА 9 (ЯС гл. 11): «значимость … зависит от того, как долго она
    // остается в силе, сколько раз рынок безуспешно пытается ее пробить и
    // каковы объемы торгов во время этих попыток». Принцип книжный; порядок
    // тай-брейков и формулы (touchVolume, возраст зоны) — проектные, не из книг.
    const lastTime = lastCandle?.time ?? 0;
    const significance = (a: Zone, b: Zone) =>
      (b.votes - a.votes) || (b.touches - a.touches) ||
      ((b.touchVolume ?? 0) - (a.touchVolume ?? 0)) ||
      // возраст зоны: старше (меньше formedAt) — значимее (ЯС гл. 11, «как долго
      // она остается в силе»; конкретное место в тай-брейке — проектное решение)
      (a.formedAt - b.formedAt) ||
      Math.abs(a.level - price) - Math.abs(b.level - price);

    // Порог значимости адаптивен к ТФ.
    // F3 (аудит): книжные полосы (bookBand — long-body по ЗГ гл. 2, окно по
    // ЯС гл. 7 / ЗГ гл. 3, дожи по ЯС гл. 8) валидны С МОМЕНТА ФОРМИРОВАНИЯ,
    // как и окно; порог minTouches (2 на intraday/scalp) — проектная настройка
    // для свинговых зон, она не должна глушить одиночную книжную зону
    // (touches=1, votes=1). Числовой порога касаний для этих зон книги не задают.
    const minTouches = tfKey === 'intraday' || tfKey === 'scalp' ? 2 : 1;
    const significant = (z: Zone) =>
      z.bookBand !== undefined || z.sources.includes('window') ||
      z.sources.includes('polarity') ||
      z.touches >= minTouches || z.votes >= this.STRONG_ZONE_MIN_VOTES;

    // ЗАДАЧА 2/3: книжные полосы (long-body/window) маршрутизируются по СВОЕЙ
    // роли и статусу пробоя по закрытию, а не по позиции live-цены относительно
    // средней линии. Не пробитые → в свою корзину; пробитые → НЕ удаляются, а
    // передаются в ПОЛЯРНЫЙ МЕХАНИЗМ (ЯС гл. 11: «прежняя поддержка становится
    // сопротивлением и наоборот») — строго та же хронология «пробой по закрытию
    // → возврат → удержание», что и в addPolarityLevels для свингов (образцовая).
    const bookSupRaw = this.mapToZones(supMap, zoneHalfWidth, candles, true);
    const bookResRaw = this.mapToZones(resMap, zoneHalfWidth, candles, true);
    const nonBookSup = this.mapToZones(supMap, zoneHalfWidth, candles, false);
    const nonBookRes = this.mapToZones(resMap, zoneHalfWidth, candles, false);

    /**
     * Хронология полярности для книжной полосы: после индекса пробоя нужен
     * возврат к полосе и удержание её с той стороны (для пробитой поддержки —
     * цена сверху: high касается зоны, close остаётся выше дальней границы;
     * зеркально для сопротивления).
     * F2 (ЗГ гл. 2, «пока цены закрытия держатся…», ЯС гл. 11): валидность
     * проверяется в настоящем времени — ПОСЛЕДНЕЕ закрытие обязано остаться на
     * стороне новой роли, в той же конвенции дальней границы, что и пробой в
     * routeBookZones (поддержка → lastClose >= band.lo*(1-breakPct);
     * сопротивление → lastClose <= band.hi*(1+breakPct)). Это зеркало проверки
     * `last.close > swing.level` в свинговом addPolarityLevels.
     */
    const polarityReturnHeld = (
      band: BookBand, breakIdx: number, polRole: 'support' | 'resistance',
    ): boolean => {
      if (lastCandle === undefined) return false;
      // F2: последнее закрытие должно держать сторону новой роли (валидность
      // в настоящем времени; конвенция дальней границы полосы).
      const lastCloseHoldsNewRole = polRole === 'support'
        ? lastCandle.close >= band.lo * (1 - params.breakPct)
        : lastCandle.close <= band.hi * (1 + params.breakPct);
      if (!lastCloseHoldsNewRole) return false;
      // Хронология «возврат → удержание» ищется ПОСЛЕДОВАТЕЛЬНО: сначала бар
      // возврата (high коснулся полосы), затем (не раньше) бар удержания с
      // закрытием за дальней границей. Строгая хронология Нисона (ЯС гл. 11,
      // «сначала пробой, затем возврат»; ср. addPolarityLevels: returnIndex >
      // breakIndex). Раньше оба условия требовались от ОДНОГО бара — редкие
      // реальные развороты (касание снизу с закрытием внутри полосы, затем
      // отрыв) не проходили проверку (регрессия приёмки F2).
      let returnSeen = false;
      for (let i = breakIdx + 1; i < candles.length; i++) {
        const c = candles[i];
        const touched = c.high >= band.lo && c.low <= band.hi;
        if (!returnSeen) {
          if (touched) returnSeen = true;
          continue;
        }
        if (polRole === 'support' && c.close > band.hi) return true;
        if (polRole === 'resistance' && c.close < band.lo) return true;
      }
      return false;
    };

    const routeBookZones = (
      raw: Zone[], origRole: 'support' | 'resistance',
      alive: Zone[], flipped: Zone[],
    ) => {
      for (const z of raw) {
        if (!z.bookBand) continue;
        const { startCheckIndex, ...band } = z.bookBand;
        // Индекс ПЕРВОГО закрытия за дальней границей (чтобы требовать
        // возврата именно ПОСЛЕ пробоя):
        let breakIdx = -1;
        for (let i = Math.max(0, startCheckIndex ?? 0); i < candles.length; i++) {
          const c = candles[i];
          if (origRole === 'support' && c.close < band.lo * (1 - params.breakPct)) { breakIdx = i; break; }
          if (origRole === 'resistance' && c.close > band.hi * (1 + params.breakPct)) { breakIdx = i; break; }
        }
        if (breakIdx < 0) { alive.push(z); continue; }
        const polRole: 'support' | 'resistance' = origRole === 'support' ? 'resistance' : 'support';
        if (polarityReturnHeld(band, breakIdx, polRole)) {
          // F2: flip выдан только если ПОСЛЕДНЕЕ закрытие удержало новую роль
          // (проверка внутри polarityReturnHeld); иначе зона не выдаётся ни в
          // одной роли — минимум по аудиту.
          // F2/F6 (аудит): flip-зона получает ПОЛЯРНУЮ полосу — зеркальное
          // отражение пробитой полосы относительно её дальней границы (уровня,
          // зафиксированного пробоем): поддержка [lo…hi] → сопротивление
          // [lo … 2*lo−hi] (зеркально «снизу» от lo), и симметрично наоборот
          // (полярность симметрична, ЯС гл. 11). Точная книга таких границ не
          // задаёт — это проектное решение о представлении flip-зоны полосой,
          // не из книг. Роль в bookBand — новая (polRole), поэтому отображение
          // рисует зону на стороне новой роли, а не старой.
          const mirrorLo = polRole === 'resistance' ? band.lo : 2 * band.hi - band.lo;
          const mirrorHi = polRole === 'resistance' ? 2 * band.lo - band.hi : band.hi;
          const fl: Zone = {
            ...z,
            level: (mirrorLo + mirrorHi) / 2,
            halfWidth: (mirrorHi - mirrorLo) / 2,
            sources: [...z.sources, 'polarity'],
            reasons: [
              ...z.reasons,
              `полярный разворот: ${origRole} пробита закрытием, возврат/удержание`
              + ` подтверждены последним закрытием (ЯС гл. 11; ЗГ гл. 2,`
              + ` «пока цены закрытия держатся выше поддержки, она остается в силе»)`,
            ],
            bookBand: { lo: mirrorLo, hi: mirrorHi, role: polRole },
          };
          flipped.push(fl);
        }
        // Пробита без возврата/удержания ИЛИ последняя закрытая цена не держит
        // новую роль (F2) — зона не выдаётся ни в одной роли (зоны
        // addPolarityLevels её ещё не «поймали»).
      }
    };

    const bookSupportAlive: Zone[] = [];
    const bookResistanceAlive: Zone[] = [];
    // F2 (аудит): flip-зоны собираем в ОТДЕЛЬНЫЕ корзины и добавляем к
    // allSupport/allResistance ПОСЛЕ фильтра significant. Причина: у flipped-
    // зоны reasons расширены меткой полярности, и если прогнать её через
    // dedupeZones вместе с исходной полосой той же цены, текстовый дедуп
    // разрезал бы flip на отдельную (неполную) зону — приёмка F2 («зона НЕ
    // выдаётся как сопротивление» при нарушении удержания последним закрытием)
    // перестала бы выполняться. Проектное решение о представлении, не из книг.
    const bookSupportFlipped: Zone[] = [];
    const bookResistanceFlipped: Zone[] = [];
    routeBookZones(bookSupRaw, 'support', bookSupportAlive, bookResistanceFlipped);
    routeBookZones(bookResRaw, 'resistance', bookSupportFlipped, bookResistanceAlive);

    // ЗАДАЧА 3: для НЕкнижных зон роль остаётся корзиной источника + позиция
    // последней ЗАКРЫТОЙ цены относительно полосы (не live-price из аргумента).
    const inOwnRole = (z: Zone, role: BookBandRole): boolean => {
      if (!z.bookBand) {
        // Без явной книги: если средняя линии внутри ATR-полосы, оставляем зону
        // в своей корзине; иначе она должна быть по ту сторону последней закрытой цены.
        const bandLo = z.level - z.halfWidth;
        const bandHi = z.level + z.halfWidth;
        if (lastClose >= bandLo && lastClose <= bandHi) return true;
        return role === 'support' ? z.level <= lastClose : z.level >= lastClose;
      }
      return true;
    };

    const allSupport = [
      ...bookSupportAlive,
      ...nonBookSup.filter((z) => inOwnRole(z, 'support')),
    ];
    const allResistance = [
      ...bookResistanceAlive,
      ...nonBookRes.filter((z) => inOwnRole(z, 'resistance')),
    ];

    // F6 (аудит): книга приоритетнее flip-ТОЧКИ. Свинговая polarity-точка из
    // addPolarityLevels может попасть в ту же корзину, что и полярный flip
    // книжной полосы (та же бар-хронология «пробой → возврат → удержание» для
    // одного диапазона). Раньше такая точка вливалась в книжную полосу через
    // кластеризацию и смещала её центр; теперь она образует отдельный кластер,
    // поэтому здесь точка без bookBand отбрасывается, если пересекается с
    // flip-полосой той же роли (тот же исходный эффект поглощения — без
    // искажения книжной геометрии). Проектное решение, не из книг.
    const overlapsFlippedBand = (z: Zone, flipped: Zone[]) => {
      const lo = z.level - z.halfWidth;
      const hi = z.level + z.halfWidth;
      return flipped.some((f) => f.bookBand !== undefined &&
        lo <= f.bookBand.hi && f.bookBand.lo <= hi);
    };

    const support = [...allSupport.filter((z) =>
        significant(z) && !(z.bookBand === undefined && overlapsFlippedBand(z, bookSupportFlipped))),
      ...bookSupportFlipped]
      .sort(significance)
      .slice(0, this.MAX_ZONES_PER_SIDE)
      .sort((a, b) => b.level - a.level);

    const resistance = [...allResistance.filter((z) =>
        significant(z) && !(z.bookBand === undefined && overlapsFlippedBand(z, bookResistanceFlipped))),
      ...bookResistanceFlipped]
      .sort(significance)
      .slice(0, this.MAX_ZONES_PER_SIDE)
      .sort((a, b) => a.level - b.level);

    const result = { support, resistance };

    // Сохраняем в кэш
    this.collectCache.set(cacheKey, result);
    // Ограничиваем размер кэша
    if (this.collectCache.size > this.CACHE_MAX_SIZE) {
      const firstKey = this.collectCache.keys().next().value;
      if (firstKey) this.collectCache.delete(firstKey);
    }

    return result;
  }

  /** Очистка кэша (для тестов). */
  static clearCache(): void {
    this.collectCache.clear();
  }

  /**
   * 1. Касательная классификация свинг-уровней
   * FIX: используем halfWidth вместо tolerance для проверки касаний.
   * ЗАДАЧА 4 (ЗГ гл. 2): «прорывы этих зон поддержки могут происходить
   * неоднократно в течение сессии, но пока цены закрытия держатся выше
   * поддержки, она остается в силе» — то есть глубокий внутрисессионный прокол
   * с удержанием закрытием остаётся ТЕСТОМ зоны. Поэтому касание поддержки =
   * нижняя граница диапазона свечи вошла в полосу/проколола её сверху
   * (c.low <= zoneTop) И закрытие осталось не ниже основания полосы
   * (c.close >= zoneBottom); зеркально для сопротивления. Правило «одна
   * закрытая свеча — не более одного касания» сохранено.
   */
  private static addTouchBasedLevels(
    price: number,
    candles: Candle[],
    supMap: Map<number, ZoneClusterData>,
    resMap: Map<number, ZoneClusterData>,
    params: ZoneParams,
    zoneHalfWidth: (level: number) => number,
  ) {
    const lookback = Math.min(params.lookback, candles.length);
    const tol = params.tolerance;
    const windowCandles = candles.slice(candles.length - lookback);

    // Группируем свинги в зоны (кластеризация)
    const zoneDefs: Array<{ level: number; firstIndex: number; members: number[]; formedAt: number }> = [];
    for (const swing of findSwings(candles, lookback, params.swingSpan)) {
      const hit = zoneDefs.find((z) =>
        z.members.some((m) => Math.abs(swing.level - m) / m <= tol));
      if (hit) {
        hit.firstIndex = Math.min(hit.firstIndex, swing.index);
        hit.formedAt = Math.min(hit.formedAt, candles[swing.index]?.time ?? 0);
        if (!hit.members.includes(swing.level)) hit.members.push(swing.level);
      } else {
        zoneDefs.push({ 
          level: swing.level, 
          firstIndex: swing.index, 
          members: [swing.level],
          formedAt: candles[swing.index]?.time ?? 0
        });
      }
    }

    // Ширина зоны для проверки касаний — та же проекная ATR-полоса, что и в
    // mapToZones (задача 5), но с учётом ширины кластера: раньше использовалось
    // `Math.max(tol * price, atrVal * 0.25)` — глобальная ширина по цене без
    // потолка 2×ATR и без зависимости от ТФ, из-за чего на scalp широкие
    // кластеры давали завышенную halfWidth.
    // Проектное решение: полоса касаний = ATR-полоса центра кластера, расширенная
    // до покрытия всех членов (кластер может быть шире одной ATR-полосы; тест
    // любого члена считается тестом зоны).
    // ЗАДАЧА 9 (ЯС гл. 11): «значимость … зависит от … каковы объемы торгов
    // во время этих попыток». Средний объём за lookback — проектная база;
    // вес касания v/avgVolume и потолок 5× — проектные числа, НЕ из книг.
    const avgVol = (() => {
      const lb = windowCandles.length > 0 ? windowCandles : candles;
      return lb.reduce((s, c) => s + c.volume, 0) / Math.max(1, lb.length);
    })();

    for (const zone of zoneDefs) {
      const hwCenter = zoneHalfWidth(zone.level);
      const spread = Math.max(...zone.members.map((m) => Math.abs(m - zone.level)));
      const halfWidth = hwCenter + spread;
      let supTouches = 0;
      let resTouches = 0;
      let lastSupTime = 0;
      let lastResTime = 0;
      let supVolSum = 0;
      let resVolSum = 0;

      for (let j = zone.firstIndex + 1; j < candles.length; j++) {
        const c = candles[j];
        // Одна закрытая свеча — не больше одного касания зоны. При нескольких
        // близких членах кластера старый вложенный цикл считал один тест 2–3 раза.
        // ЗАДАЧА 4: тест поддержки — low вошёл в зону или проколол её снизу вверх
        // при закрытии НЕ НИЖЕ основания полосы (глубокий прокол с восстановлением
        // — это тоже тест, ЗГ гл. 2).
        const hitSupport = zone.members.some((m) =>
          c.low <= m + halfWidth && c.close >= m - halfWidth);
        const hitResistance = zone.members.some((m) =>
          c.high >= m - halfWidth && c.close <= m + halfWidth);
        if (hitSupport) {
          supTouches++;
          lastSupTime = c.time;
          supVolSum += avgVol > 0 ? Math.min(c.volume / avgVol, 5) : 0;
        }
        if (hitResistance) {
          resTouches++;
          lastResTime = c.time;
          resVolSum += avgVol > 0 ? Math.min(c.volume / avgVol, 5) : 0;
        }
      }

      const asSupport = supTouches > 0 && zone.level <= price;
      const asResistance = resTouches > 0 && zone.level >= price;

      if (asSupport) {
        addLevelToMap(
          supMap, zone.level, `свинг-зона: ${supTouches} касание(й) поддержки`,
          lastSupTime, tol, supTouches,
          // ЗАДАЧА 9: touchVolumeSum — проектная формула относительного объёма
          // касаний (принцип ЯС гл. 11 книжный, числа — проекта).
          { source: 'swing', halfWidth, formedAt: zone.formedAt, touchVolumeSum: supVolSum },
        );
      }
      if (asResistance) {
        addLevelToMap(
          resMap, zone.level, `свинг-зона: ${resTouches} касание(й) сопротивления`,
          lastResTime, tol, resTouches,
          { source: 'swing', halfWidth, formedAt: zone.formedAt, touchVolumeSum: resVolSum },
        );
      }
    }
  }

  /**
   * 2. Полярность: пробитые уровни меняют роль
   * FIX: добавлена проверка возврата к пробитому уровню (гл. 11).
   */
  private static addPolarityLevels(
    price: number,
    candles: Candle[],
    supMap: Map<number, ZoneClusterData>,
    resMap: Map<number, ZoneClusterData>,
    params: ZoneParams
  ) {
    if (candles.length < 6) return;
    const lookback = Math.min(params.lookback, candles.length);
    const swings = findSwings(candles, lookback, params.swingSpan);
    const last = candles[candles.length - 1];
    const BREAK_PCT = params.breakPct;

    for (const swing of swings) {
      const fromIdx = Math.max(swing.index + 1, candles.length - 40);
      const formedAt = candles[swing.index]?.time ?? swing.time;
      if (swing.type === 'high') {
        // Строгая хронология Нисона: сначала закрытие выше сопротивления,
        // затем (не раньше) возврат и удержание его как поддержки.
        const breakIndex = candles.findIndex((c, index) =>
          index >= fromIdx && c.close > swing.level * (1 + BREAK_PCT));
        if (breakIndex < 0) continue;
        const returnIndex = candles.findIndex((c, index) =>
          index > breakIndex &&
          c.high >= swing.level * (1 - BREAK_PCT) &&
          c.low <= swing.level * (1 + BREAK_PCT) &&
          c.close > swing.level);
        if (returnIndex >= 0 && last.close > swing.level) {
          addLevelToMap(
            supMap, swing.level, 'полярность: пробитое сопротивление → поддержка',
            candles[returnIndex].time, params.tolerance, 1,
            { source: 'polarity', formedAt },
          );
        }
      } else {
        const breakIndex = candles.findIndex((c, index) =>
          index >= fromIdx && c.close < swing.level * (1 - BREAK_PCT));
        if (breakIndex < 0) continue;
        const returnIndex = candles.findIndex((c, index) =>
          index > breakIndex &&
          c.low <= swing.level * (1 + BREAK_PCT) &&
          c.high >= swing.level * (1 - BREAK_PCT) &&
          c.close < swing.level);
        if (returnIndex >= 0 && last.close < swing.level) {
          addLevelToMap(
            resMap, swing.level, 'полярность: пробитая поддержка → сопротивление',
            candles[returnIndex].time, params.tolerance, 1,
            { source: 'polarity', formedAt },
          );
        }
      }
    }
  }

  /**
   * 3. Скользящие средние как динамические уровни
   */
  private static addMALevels(
    price: number,
    candles: Candle[],
    supMap: Map<number, ZoneClusterData>,
    resMap: Map<number, ZoneClusterData>,
    tolerance: number
  ) {
    const closes = candles.map(c => c.close);
    const periods = [50, 65, 200];
    const lastTime = candles[candles.length - 1]?.time ?? 0;

    for (const period of periods) {
      if (candles.length >= period) {
        const ma = sma(closes, period);
        const maVal = ma[ma.length - 1];
        if (Number.isNaN(maVal)) continue;

        if (maVal <= price) {
          addLevelToMap(supMap, maVal, `MA${period}`, lastTime, tolerance, 1, { source: 'ma' });
        } else {
          addLevelToMap(resMap, maVal, `MA${period}`, lastTime, tolerance, 1, { source: 'ma' });
        }
      }
    }
  }

  /**
   * 4. Объёмные климасы — только ПОСЛЕ предшествующего движения (ЗАДАЧА 7).
   * Книга (ЯС гл. 15, глоссарий): «кульминация продаж — резкое падение цены на
   * фоне большого объема торгов ПОСЛЕ периода длительного снижения»;
   * «выпуск пара — разворот... после сильного и быстрого движения цены».
   * Поэтому бычий климакс (большой объём + белая свеча) считается ТОЛЬКО после
   * предшествующего спада (→ бычий контекст), медвежий — только после ралли.
   * ВАЖНО (проектная операционализация, НЕ из книг):
   *  - правило «экстремум климакса (low/high свечи) = зона S/R» книгами не задаётся;
   *  - порог объёма 2×avg(60) — настройка проекта, в книгах числа нет;
   *  - окно контекста 10 баров и минимальная величина движения — проектные.
   */
  private static addVolumeClimaxLevels(
    candles: Candle[],
    supMap: Map<number, ZoneClusterData>,
    resMap: Map<number, ZoneClusterData>,
    tolerance: number
  ) {
    const lookback = Math.min(60, candles.length);
    const startIdx = candles.length - lookback;
    const recent = candles.slice(startIdx);
    const avgVolume = recent.reduce((sum, c) => sum + c.volume, 0) / recent.length;

    // Проектное окно предшествующего движения (не из книг).
    const CONTEXT = 10;

    for (let i = 0; i < recent.length; i++) {
      const c = recent[i];
      const globalIdx = startIdx + i;
      // Нужен предшествующий отрезок истории (только закрытые бары до теста).
      if (globalIdx < CONTEXT) continue;
      if (!(c.volume > avgVolume * 2)) continue; // проектный порог 2×avg(60)

      const prevClose = candles[globalIdx - CONTEXT].close;
      const movePct = (c.close - prevClose) / prevClose;
      // Проектный минимальный размер предшествующего движения (0.5%).
      const MIN_MOVE = 0.005;

      if (c.isBullish && movePct <= -MIN_MOVE) {
        // F5 (Глоссарий Б ЯС): бычья свеча на всплеске объёма ПОСЛЕ спада — это
        // разворот после «кульминации продаж» (selling climax), бычий контекст →
        // поддержка. Прежняя метка «климакс покупок» была терминологически
        // неверна (гл. 15/Глоссарий Б: selling climax = падение + большой объём,
        // за которым следует разворот вверх).
        addLevelToMap(
          supMap, c.low,
          'кульминация продаж (selling climax) после спада → бычий контекст → поддержка (ЯС гл. 15, Глоссарий Б; экстремум как зона и порог 2×avg — проектная операционализация, не из книг)',
          c.time, tolerance, 1, { source: 'volume', formedAt: c.time },
        );
      } else if (!c.isBullish && movePct >= MIN_MOVE) {
        // F5 (Глоссарий Б ЯС): медвежья свеча на всплеске объёма ПОСЛЕ ралли —
        // «выпуск пара» (blow-off), разворот на вершине, медвежий контекст →
        // сопротивление. Прежняя метка «климакс продаж» была терминологически
        // неверна. ЛОГИКА ДЕТЕКЦИИ НЕ МЕНЯЕТСЯ — исправлены только тексты.
        addLevelToMap(
          resMap, c.high,
          'выпуск пара (blow-off) после ралли → медвежий контекст → сопротивление (ЯС гл. 15, Глоссарий Б; экстремум как зона и порог 2×avg — проектная операционализация, не из книг)',
          c.time, tolerance, 1, { source: 'volume', formedAt: c.time },
        );
      }
    }
  }

  /**
   * 9. Дожи как зоны S/R (ЗАДАЧА 8, по умолчанию выключена флагом dojiZones).
   * Книга (ЯС гл. 8): «Дожи иногда задают зоны поддержки и сопротивления,
   * особенно если образуются в районе значимых вершин и оснований»
   * (рис. 8.17–8.18). ЗГ гл. 2, рис. 2.37: максимум дожи (конец верхней тени)
   * нередко становится сопротивлением.
   * Операционализации (проектные, не из книг):
   *  - «район значимой вершины/основания» = близость к свингу findSwings
   *    (±max(2×ATR, tolerance×level)); конкретная формула — настройка проекта;
   *  - боковик НЕ является «значимой вершиной/основанием»: в flat-рынке
   *    дожи-зоны не формируются (ЗГ гл. 2: в боковике дожи сигнала не даёт);
   *    критерий flat (range < 4×ATR за lookback) — проектная эвристика;
   *  - геометрия: поддержка = [low … close/open] дожи (тело ≈ линия),
   *    сопротивление = [close/open … high] — книжная граница «максимум дожи
   *    (конец верхней тени)» как ДАЛЬНЯЯ граница полосы (ЗГ гл. 2, рис. 2.37).
   */
  private static addDojiLevels(
    candles: Candle[],
    supMap: Map<number, ZoneClusterData>,
    resMap: Map<number, ZoneClusterData>,
    params: ZoneParams,
    atrVal: number,
  ) {
    const lookback = Math.min(params.lookback, candles.length);
    const startIdx = candles.length - lookback;
    const windowCandles = candles.slice(startIdx);

    // Проектный фильтр боковика: без выраженного движения за окно — flat.
    const wHigh = Math.max(...windowCandles.map((c) => c.high));
    const wLow = Math.min(...windowCandles.map((c) => c.low));
    if (atrVal > 0 && wHigh - wLow < 4 * atrVal) return; // боковик: дожи-зон нет (ЗГ гл. 2)

    const swings = findSwings(candles, lookback, params.swingSpan);
    if (swings.length === 0) return;

    for (let i = startIdx; i < candles.length - 1; i++) {
      const c = candles[i];
      if (!c.isDoji) continue;
      const near = swings.find((s) => s.index !== i &&
        Math.abs(s.level - c.bodyMid) <= Math.max(2 * atrVal, params.tolerance * c.bodyMid));
      if (!near) continue; // дожи вне района значимой вершины/основания — не источник (ЯС гл. 8)

      const mid = (c.open + c.close) / 2;
      if (near.type === 'low') {
        // Дожи у значимого основания → зона поддержки [low … mid].
        const lo = c.low, hi = mid;
        addLevelToMap(
          supMap, (lo + hi) / 2,
          `дожи у значимого основания → поддержка (ЯС гл. 8, рис. 8.17–8.18; зона [low…тело] — операционализация)`,
          c.time, params.tolerance, 1,
          {
            source: 'doji', halfWidth: (hi - lo) / 2, formedAt: c.time,
            startCheckIndex: i + 1, bookBand: { lo, hi, role: 'support' },
            // F6 (аудит): дожи — книжный источник с явной геометрией (bookBand);
            // он тоже не должен поглощаться свинг-кластерами (как long-body).
            // Проектное решение, не из книг.
            keepSeparate: true,
          },
        );
      } else {
        // Дожи у значимой вершины → зона сопротивления [mid … high]
        // (ЗГ гл. 2, рис. 2.37: максимум дожи нередко становится сопротивлением).
        const lo = mid, hi = c.high;
        addLevelToMap(
          resMap, (lo + hi) / 2,
          `дожи у значимой вершины → сопротивление (ЯС гл. 8; ЗГ гл. 2, рис. 2.37: максимум дожи = дальняя граница)`,
          c.time, params.tolerance, 1,
          {
            source: 'doji', halfWidth: (hi - lo) / 2, formedAt: c.time,
            startCheckIndex: i + 1, bookBand: { lo, hi, role: 'resistance' },
            // F6 (аудит): см. ветвь поддержки — защита книжной геометрии дожи.
            keepSeparate: true,
          },
        );
      }
    }
  }

  /**
   * 5. Длинное тело — ОДНА зона, а не две точки (ЗГ гл. 2, рис. 2.11).
   * Цитата: «Откат цен должен встретить поддержку либо на уровне середины
   * длинного белого тела, либо в основании всей белой свечи, включая и нижнюю
   * тень». Глоссарий ЗГ: поддержка «от середины до основания белой свечи
   * (включая и минимум нижней тени)»; для чёрной — сопротивление «от середины
   * до вершины свечи (включая верхнюю тень)».
   * Поэтому белая свеча даёт одну зону [c.low … mid], чёрная — [mid … c.high]
   * (по образцу addWindowLevels: level=середина полосы, halfWidth=её полуширина).
   * Книжный критерий «длинного тела» (ЗГ гл. 2): тело >= 3x тела ПРЕДЫДУЩЕЙ свечи.
   */
  private static addLongBodyLevels(
    candles: Candle[],
    supMap: Map<number, ZoneClusterData>,
    resMap: Map<number, ZoneClusterData>,
    params: ZoneParams
  ) {
    const lookback = Math.min(params.lookback, candles.length);
    const startIdx = candles.length - lookback;
    const recent = candles.slice(startIdx);
    // F1 (аудит): прежний расчёт avgBody и фильтры c.isLongCandle / body > 1.5*avgBody
    // УБРАНЫ из гейта. Candle.isLongCandle (body > 0.6×диапазон) отсекал ровно те
    // длинные тела с большой тенью, ради которых ЗГ гл. 2 и написана («зона… включая
    // и нижнюю тень»); avgBody в книгах отсутствует. Гейт = только книжный критерий.

    for (let i = 0; i < recent.length; i++) {
      const c = recent[i];
      const globalIdx = startIdx + i;
      const prev = candles[globalIdx - 1];
      // Инженерная защита (не из книг): без предыдущей свечи или при нулевом её
      // теле отношение к «телу предыдущей» не определено — зону не формируем.
      if (!prev || !(prev.body > 0)) continue;
      // Книжный критерий ЗГ гл. 2 (единственный гейт, F1): «тело полноценной
      // длинной белой свечи должно быть не менее чем втрое длиннее тела свечи за
      // предыдущий день». Зона включает нижнюю/верхнюю тень, поэтому фильтр по
      // доле тела в диапазоне (isLongCandle) противоречил книге и удалён.
      const isLongByBook = c.body >= 3 * prev.body;
      if (isLongByBook) {
        const mid = (c.open + c.close) / 2;

        // Индекс бара, СЛЕДУЮЩЕГО за длинной свечой: с него считается пробой
        // по закрытию (задача 2, ЗГ гл. 2 — «пока цены закрытия держатся выше
        // поддержки, она остается в силе»).
        const startCheckIndex = globalIdx + 1;
        if (c.isBullish) {
          // Книжная полоса [c.low … mid] с ролью «поддержка» — задаётся ИСТОЧНИКОМ,
          // а не позицией цены (задача 3). Метка исправлена: раньше было
          // «основание длинного белого тела», но код (и книга) используют c.low —
          // ВЕСЬ диапазон свечи с нижней тенью.
          const lo = c.low, hi = mid;
          addLevelToMap(
            supMap, (lo + hi) / 2,
            'зона длинного белого тела: от середины до основания свечи, включая нижнюю тень (ЗГ гл. 2, рис. 2.11)',
            c.time, params.tolerance, 1,
            {
              source: 'long-body', halfWidth: (hi - lo) / 2, formedAt: c.time,
              startCheckIndex, bookBand: { lo, hi, role: 'support' },
              // Проектное решение: книжная полоса длинного тела не сливается со
              // свинг-кластерами — иначе её геометрия [low…mid] теряется.
              keepSeparate: true,
            },
          );
        } else {
          // Аналогично: «вершина длинного чёрного тела» → вершина свечи с верхней тенью.
          const lo = mid, hi = c.high;
          addLevelToMap(
            resMap, (lo + hi) / 2,
            'зона длинного чёрного тела: от середины до вершины свечи, включая верхнюю тень (ЗГ гл. 2, рис. 2.11)',
            c.time, params.tolerance, 1,
            {
              source: 'long-body', halfWidth: (hi - lo) / 2, formedAt: c.time,
              startCheckIndex, bookBand: { lo, hi, role: 'resistance' },
              keepSeparate: true,
            },
          );
        }
      }
    }
  }

  /**
   * 6. Психологические круглые числа
   * FIX: исправлен тавтологический фильтр — теперь проверяем реальную близость.
   */
  private static addRoundNumbers(
    price: number,
    supMap: Map<number, ZoneClusterData>,
    resMap: Map<number, ZoneClusterData>,
    tolerance: number,
    formedAt: number,
  ) {
    let step: number;
    if (price >= 10000) step = 1000;
    else if (price >= 1000) step = 100;
    else if (price >= 100) step = 10;
    else if (price >= 10) step = 1;
    else if (price >= 1) step = 0.1;
    else step = 0.01;

    const lower = Math.floor(price / step) * step;
    const upper = Math.ceil(price / step) * step;

    // FIX: добавляем только если цена реально близко (в пределах 20% шага)
    // Это отсекает фантомные уровни, которые были бы слишком далеко
    const proximityThreshold = step * 0.2;

    if (price - lower <= proximityThreshold && lower > 0) {
      addLevelToMap(supMap, lower, 'психологический уровень (круглое число)', formedAt, tolerance, 1, { source: 'round-number', formedAt });
    }
    if (upper - price <= proximityThreshold && upper > 0) {
      addLevelToMap(resMap, upper, 'психологический уровень (круглое число)', formedAt, tolerance, 1, { source: 'round-number', formedAt });
    }
  }

  /**
   * 7. Уровни Фибоначчи — строго ЯС гл. 12 (задача 6 + F4 аудита).
   * Книга: «Наиболее распространенными уровнями таких коррекций являются
   * 50%-ный, а также 38%-ный и 62%-ный»; коррекция измеряется от КОНКРЕТНОГО
   * движения A→B (рис. 12.1–12.7), а не от безымянного min/max окна.
   * F4: ГЛУБИНА КОРРЕКЦИИ ОТСЧИТЫВАЕТСЯ ОТ КОНЕЧНОЙ ТОЧКИ ИМПУЛЬСА B
   * (подписи рис. 12.1–12.2: «38%-ная коррекция после подъёма/спада от A к В»):
   *  - подъём A(low)→B(high): коррекция вниз → поддержка на B − ratio×range;
   *    (пример: 60→100, 38% = 100 − 0.38×40 = 84.8; 62% = 75.28);
   *  - спад A(high)→B(low): отскок вверх → сопротивление на B + ratio×range
   *    = impulseLow + ratio×range (пример: 100→60, 38% = 60 + 0.38×40 = 75.2).
   * Раньше обе ветви использовали одну формулу impulseLow + ratio×range, из-за
   * чего для подъёма метка «38%» стояла на уровне 62%-ной коррекции (F4).
   * Операционализация (пометить): пара A/B выбирается по последним двум
   * свингам findSwings за lookback — в книге способ поиска пары не формализован.
   * 23.6% и 78.6% удалены: в ЯС гл. 12 их нет (раньше ошибочно числились
   * книжными). Прежняя псевдоцитата заменена реальной цитатой выше.
   */
  private static addFibonacciLevels(
    candles: Candle[],
    supMap: Map<number, ZoneClusterData>,
    resMap: Map<number, ZoneClusterData>,
    params: ZoneParams,
  ) {
    if (candles.length < 20) return;

    // Книжные уровни коррекции: только 38/50/62% (округления 38.2/61.8 допустимы).
    const fibRatios = [0.382, 0.5, 0.618];

    // Операционализация (не из книг): последние два экстремума свинг-детектора.
    const swings = findSwings(candles, Math.min(params.lookback, candles.length), params.swingSpan);
    if (swings.length < 2) return;
    const a = swings[swings.length - 2];
    const b = swings[swings.length - 1];
    if (a.type === b.type) return; // нужен направленный импульс low→high или high→low

    const isUpImpulse = a.type === 'low' && b.type === 'high';
    const impulseLow = Math.min(a.level, b.level);
    const impulseHigh = Math.max(a.level, b.level);
    const range = impulseHigh - impulseLow;
    if (!(range > 0)) return;

    const lastTime = candles[candles.length - 1]?.time ?? 0;
    const dirTag = isUpImpulse ? 'подъём' : 'спад';

    for (const ratio of fibRatios) {
      const pctLabel = `${Math.round(ratio * 100)}%`;
      // F4 (ЯС гл. 12, рис. 12.1–12.2): глубина коррекции отсчитывается от
      // КОНЕЧНОЙ точки импульса B, поэтому формулы для подъёма и спада РАЗНЫЕ:
      // подъём → B(high) − ratio×range (коррекция вниз, поддержка);
      // спад  → B(low) + ratio×range = impulseLow + ratio×range (отскок, сопротивление).
      const level = isUpImpulse
        ? impulseHigh - range * ratio
        : impulseLow + range * ratio;
      const reason = `Фибо ${pctLabel} коррекции импульса ${dirTag} ${impulseLow.toFixed(2)}\u2192${impulseHigh.toFixed(2)} (ЯС гл. 12)`;
      if (isUpImpulse) {
        // Подъём A→B: коррекция вниз встречает поддержку на уровнях ретрейса.
        addLevelToMap(supMap, level, reason, lastTime, params.tolerance, 1, { source: 'fibonacci', formedAt: lastTime });
      } else {
        // Спад A→B: отскок вверх встречает сопротивление на уровнях ретрейса.
        addLevelToMap(resMap, level, reason, lastTime, params.tolerance, 1, { source: 'fibonacci', formedAt: lastTime });
      }
    }
  }

  /** Активные окна: вверх — поддержка, вниз — сопротивление (гл. 7 ЯС). */
  private static addWindowLevels(
    candles: Candle[],
    supMap: Map<number, ZoneClusterData>,
    resMap: Map<number, ZoneClusterData>,
    tolerance: number,
    market: ZoneMarket,
  ): void {
    for (const gap of detectGaps(candles, market)) {
      if (gap.broken) continue;
      const level = (gap.bottom + gap.top) / 2;
      const halfWidth = (gap.top - gap.bottom) / 2;
      const isUp = gap.direction === 'up';
      const target = isUp ? supMap : resMap;
      // Задача 2: книжная полоса окна [bottom … top] с ролью по направлению
      // (вверх → поддержка, вниз → сопротивление; ЯС гл. 7). startCheckIndex —
      // бар, следующий за открывшим гэп (candle.time == gap.time), с него
      // считается подтверждённый пробой (закрытие за дальней границей).
      const startCheckIdx = candles.findIndex((c) => c.time === gap.time);
      addLevelToMap(
        target,
        level,
        `окно ${isUp ? 'вверх → поддержка' : 'вниз → сопротивление'}${gap.filled ? ' (заполнено, не пробито)' : ''}`,
        gap.time,
        tolerance,
        1,
        {
          source: 'window', halfWidth, formedAt: gap.time,
          startCheckIndex: startCheckIdx >= 0 ? startCheckIdx + 1 : 0,
          bookBand: { lo: gap.bottom, hi: gap.top, role: isUp ? 'support' : 'resistance' },
          // F6 (аудит): окно — книжный источник с явной геометрией; его полоса
          // [bottom…top] не должна размываться свинг-кластерами. Проектное решение.
          keepSeparate: true,
        },
      );
    }
  }

  /**
   * Преобразование Map в массив Zone
   * FIX: добавлено поле formedAt для учёта времени жизни зоны.
   */
  private static mapToZones(
    map: Map<number, ZoneClusterData>,
    halfWidthOf: (level: number) => number,
    candles: Candle[],
    bookOnly: boolean,
  ): Zone[] {
    const zones: Zone[] = [];
    const lastTime = candles[candles.length - 1]?.time ?? 0;

    for (const [level, data] of map.entries()) {
      const hasBook = data.bookBand !== undefined;
      if (hasBook !== bookOnly) continue;
      const uniqueReasons = Array.from(new Set(data.reasons));
      const sources = Array.from(new Set(data.sources ?? []));
      const votes = sources.length || (uniqueReasons.length > 0 ? 1 : 0);
      // ЗАДАЧА 5: если источник задал книжную геометрию полосы (window/long-body),
      // halfWidth берётся из неё как есть; ATR-пол/потолок применяются только к
      // источникам без явной книги (swing-кластеры, MA, круглые числа, fib).
      const halfWidth = hasBook && data.halfWidth !== undefined
        ? data.halfWidth
        : Math.max(halfWidthOf(level), data.halfWidth ?? 0);
      zones.push({
        level,
        votes,
        strong: votes >= this.STRONG_ZONE_MIN_VOTES,
        reasons: uniqueReasons,
        sources,
        touches: data.touches,
        lastTouch: data.lastTouch,
        halfWidth,
        formedAt: data.formedAt ?? data.lastTouch ?? lastTime,
        // ЗАДАЧА 9: относительный объём касаний (принцип ЯС гл. 11 книжный,
        // накопленная формула — проектная эвристика).
        touchVolume: data.touchVolumeSum,
        bookBand: data.bookBand
          ? { ...data.bookBand, startCheckIndex: data.startCheckIndex }
          : undefined,
      });
    }

    return zones;
  }

  /**
   * Проверка близости к поддержке.
   */
  static isNearSupport(
    price: number,
    candles: Candle[],
    _tolerance: number = 0.015,
    tfKey: TimeframeKey = 'swing',
    wickLow?: number,
    market: ZoneMarket = 'crypto',
  ): boolean {
    const { support } = this.collect(price, candles, tfKey, market);
    return support.some(zone =>
      this.inBand(price, zone) ||
      (wickLow !== undefined &&
        wickLow <= zone.level + zone.halfWidth &&
        price >= zone.level - zone.halfWidth)
    );
  }

  /** Цена внутри ATR-полосы зоны [level ± halfWidth]. */
  private static inBand(price: number, zone: Zone): boolean {
    return price <= zone.level + zone.halfWidth && price >= zone.level - zone.halfWidth;
  }

  /**
   * Проверка близости к сопротивлению.
   */
  static isNearResistance(
    price: number,
    candles: Candle[],
    _tolerance: number = 0.015,
    tfKey: TimeframeKey = 'swing',
    wickHigh?: number,
    market: ZoneMarket = 'crypto',
  ): boolean {
    const { resistance } = this.collect(price, candles, tfKey, market);
    return resistance.some(zone =>
      this.inBand(price, zone) ||
      (wickHigh !== undefined &&
        wickHigh >= zone.level - zone.halfWidth &&
        price <= zone.level + zone.halfWidth)
    );
  }
}
