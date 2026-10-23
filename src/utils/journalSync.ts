// Синхронизация журнала сигналов с серверным хранилищем (kairi.pro/api/journal).
//
// Модель: localStorage остаётся рабочим кэшем (журнал доступен офлайн),
// сервер — источник истины между устройствами/сессиями. Слияние при sync:
//   - по id: выигрывает «более финальная» запись (закрытая сделка сильнее
//     pending; при равных статусах — большие exitTimestamp/timestamp);
//   - кросс-девайс дедупликация: одна и та же формация, залогированная с двух
//     устройств (разные id, одинаковые symbol+tf+pattern+direction+barTime),
//     схлопывается в одну запись.
// При недоступности сервера журнал продолжает работать локально.
//
// Авторизация: сервер требует заголовок X-Kairi-Key. Браузер получает его из
// meta-тега <meta name="kairi-journal-token">, который деплой-скрипт
// (deploy/vps_setup.sh) подставляет в index.html — HMAC-токен с TTL 12 часов
// (server/journal_token.py). Нет токена / токен просрочен -> 401 -> graceful
// деградация в локальный режим.

import { sanitizeSignalEntry, type SignalEntry } from './signalJournal';

const DEVICE_KEY = 'kairi_journal_device_id';
const API_BASE = '/api/journal';
const SYNC_INTERVAL_MS = 60_000; // фоновая синхронизация раз в минуту

/** Токен доступа к серверному журналу из index.html (пустая строка, если не задан). */
export function getJournalToken(): string {
  try {
    const meta = document.querySelector('meta[name="kairi-journal-token"]');
    return (meta?.getAttribute('content') || '').trim();
  } catch {
    return ''; // нет DOM (тесты/SSR) — работаем локально
  }
}

// --- идентификатор устройства (для диагностики) ---
export function getDeviceId(): string {
  try {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id) {
      id = typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `dev_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
      localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  } catch {
    return 'unknown-device';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const token = getJournalToken();
    const res = await fetch(`${API_BASE}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'X-Kairi-Key': token } : {}),
        ...(init?.headers || {}),
      },
    });
    if (res.status === 401) {
      // Токен не встроен в index.html (деплой без journal_token.py) или
      // просрочен — ожидаемая деградация в локальный режим.
      throw new JournalAuthError('Журнал: нет действующего токена доступа — включён локальный режим');
    }
    if (res.status === 403) {
      // Браузерный токен не имеет права на эту операцию (например DELETE) —
      // запись останется только в локальном журнале до синхронизации статуса.
      throw new JournalAuthError('Журнал: операция требует мастер-ключа — применяется локально');
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json() as T;
  } finally {
    clearTimeout(timer);
  }
}

/** Ошибка авторизации журнала — не считается сбоем сети, логируется один раз. */
export class JournalAuthError extends Error {}

interface ServerResponse {
  signals: unknown[];
  updatedAt?: number;
  added?: number;
  updated?: number;
  deduped?: number;
}

// --- слияние локального и серверного журналов ---
const STATUS_RANK: Record<SignalEntry['status'], number> = {
  pending: 0, expired: 1, hit_stop: 2, hit_target: 2,
};

/** Насколько «финальна» запись: закрытые сделки побеждают pending. */
function recency(s: SignalEntry): number {
  return s.exitTimestamp ?? s.timestamp;
}

/** Выбирает победителя пары записей об одном событии. */
function pickBetter(a: SignalEntry, b: SignalEntry): SignalEntry {
  const rankA = STATUS_RANK[a.status], rankB = STATUS_RANK[b.status];
  if (rankA !== rankB) return rankA > rankB ? a : b;
  return recency(a) >= recency(b) ? a : b;
}

function eventKeyOf(s: SignalEntry): string | null {
  if (s.barTime === undefined) return null;
  return `${s.symbol}|${s.timeframe}|${s.pattern}|${s.direction}|${s.barTime}`;
}

/**
 * Чистая функция слияния: локальные + серверные записи -> единый журнал.
 * 1) сопоставление по id (более финальная запись побеждает);
 * 2) схлопывание одного события с разных устройств (по barTime-ключу).
 */
export function mergeJournals(local: SignalEntry[], server: SignalEntry[]): SignalEntry[] {
  const byId = new Map<string, SignalEntry>();
  for (const s of server) byId.set(s.id, s);
  for (const s of local) {
    const existing = byId.get(s.id);
    byId.set(s.id, existing ? pickBetter(existing, s) : s);
  }

  // Дедупликация одного события под разными id (два устройства залогировали
  // одну формацию независимо): оставляем более финальную запись.
  const winnerByEvent = new Map<string, SignalEntry>();
  for (const s of Array.from(byId.values())) {
    const key = eventKeyOf(s);
    if (key === null) continue;
    const prev = winnerByEvent.get(key);
    winnerByEvent.set(key, prev ? pickBetter(prev, s) : s);
  }

  const result: SignalEntry[] = [];
  const seenEvents = new Set<string>();
  for (const s of Array.from(byId.values()).sort((a, b) => b.timestamp - a.timestamp)) {
    const key = eventKeyOf(s);
    if (key !== null) {
      if (seenEvents.has(key)) continue; // проигравший близнец уже отброшен
      seenEvents.add(key);
    }
    result.push(s);
  }
  return result;
}

// --- API синхронизации ---

export async function pullJournal(): Promise<SignalEntry[]> {
  const data = await request<ServerResponse>('/signals');
  return (data.signals || [])
    .map(sanitizeSignalEntry)
    .filter((e): e is SignalEntry => e !== null);
}

export async function pushJournal(local: SignalEntry[]): Promise<ServerResponse> {
  return request<ServerResponse>('/sync', {
    method: 'POST',
    body: JSON.stringify({ deviceId: getDeviceId(), signals: local }),
  });
}

/** Полный цикл: pull -> merge с локальным -> push merged -> вернуть merged. */
export async function syncJournal(local: SignalEntry[]): Promise<{ merged: SignalEntry[]; stats: ServerResponse }> {
  const remote = await pullJournal();
  const merged = mergeJournals(local, remote);
  const stats = await pushJournal(merged);
  const finalMerged = (stats.signals || [])
    .map(sanitizeSignalEntry)
    .filter((e): e is SignalEntry => e !== null);
  return { merged: finalMerged.length > 0 ? finalMerged : merged, stats };
}

export async function replaceJournal(signals: SignalEntry[]): Promise<SignalEntry[]> {
  const data = await request<ServerResponse>('/replace', {
    method: 'POST',
    body: JSON.stringify({ signals }),
  });
  return (data.signals || [])
    .map(sanitizeSignalEntry)
    .filter((e): e is SignalEntry => e !== null);
}

export async function deleteRemoteSignal(id: string): Promise<void> {
  await request(`/signals/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export const JOURNAL_SYNC_INTERVAL_MS = SYNC_INTERVAL_MS;
