// Клиентский аккаунт покупателя: user_id + статус подписки.
// Хранится локально (localStorage); серверная истина — /api/subscriptions/<id>.
import { getJournalToken } from './journalSync';

const LS_USER = 'kairi-user-id';

export interface PlanInfo {
  id: string;
  title: string;
  price_usdt: number;
  duration_days: number;
}

export interface PlansResponse {
  plans: PlanInfo[];
  payTo: string;
  trialDays: number;
}

export interface SubState {
  active: boolean;
  plan?: string;
  planTitle?: string;
  expiresAt?: number;
  pending?: string;
  pendingTitle?: string;
}

export function getUserId(): string | null {
  try {
    return localStorage.getItem(LS_USER);
  } catch {
    return null;
  }
}

export function setUserId(id: string): void {
  try {
    localStorage.setItem(LS_USER, id);
  } catch { /* приватный режим */ }
}

function apiToken(): string {
  try {
    const meta = document.querySelector('meta[name="kairi-api-token"]');
    const t = (meta?.getAttribute('content') || '').trim();
    if (t) return t;
  } catch { /* нет DOM */ }
  return getJournalToken();
}

/** Есть ли за nginx наш backend (боевой домен/стенд). */
export function hasBackend(): boolean {
  try {
    return typeof document !== 'undefined' &&
      (!!document.querySelector('meta[name="kairi-api-token"]') ||
       !!document.querySelector('meta[name="kairi-journal-token"]'));
  } catch {
    return false;
  }
}

async function req(path: string, init?: RequestInit): Promise<any> {
  const token = apiToken();
  const res = await fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { 'X-Kairi-Key': token } : {}),
      ...(init?.headers || {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((body as any)?.detail || `HTTP ${res.status}`);
  }
  return body;
}

/** Публичный список тарифов (без токена). */
export async function fetchPlans(): Promise<PlansResponse> {
  const body = await req('/api/plans');
  return { plans: body.plans ?? [], payTo: body.payTo ?? '', trialDays: body.trialDays ?? 0 };
}

/** Регистрация (email опционален) -> user_id + текущий статус. */
export async function registerAccount(email?: string): Promise<{ user_id: string } & SubState> {
  const body = await req('/api/register', {
    method: 'POST',
    body: JSON.stringify(email ? { email } : {}),
  });
  if (body.user_id) setUserId(body.user_id);
  return body;
}

/** Статус подписки текущего пользователя. */
export async function fetchSubscription(): Promise<SubState> {
  const uid = getUserId();
  if (!uid) return { active: false };
  return req(`/api/subscriptions/${encodeURIComponent(uid)}`);
}

/** Заявка на оплату плана (pending до подтверждения платежа). */
export async function requestSubscription(planId: string, paymentTx?: string): Promise<SubState & { payTo?: string; amountUsdt?: number }> {
  const uid = getUserId();
  if (!uid) throw new Error('not registered');
  return req('/api/subscriptions', {
    method: 'POST',
    body: JSON.stringify({ user_id: uid, plan_id: planId, payment_tx: paymentTx || '' }),
  });
}
