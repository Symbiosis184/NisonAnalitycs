import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Copy, CreditCard, Loader2, Sparkles } from 'lucide-react';
import { useI18n } from '../i18n';
import {
  fetchPlans, fetchSubscription, getUserId, registerAccount, requestSubscription,
  hasBackend, type PlanInfo, type SubState,
} from '../utils/account';

function fmtDate(ts?: number, locale = 'ru-RU'): string {
  if (!ts) return '';
  return new Date(ts * 1000).toLocaleDateString(locale);
}

export default function PricingPage() {
  const { t, locale } = useI18n();
  const [plans, setPlans] = useState<PlanInfo[]>([]);
  const [payTo, setPayTo] = useState('');
  const [trialDays, setTrialDays] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [userId, setUserIdState] = useState<string | null>(getUserId());
  const [email, setEmail] = useState('');
  const [sub, setSub] = useState<SubState | null>(null);
  const [busyPlan, setBusyPlan] = useState('');
  const [orderMsg, setOrderMsg] = useState('');
  const [copied, setCopied] = useState(false);

  const refreshStatus = useCallback(async (uid: string | null) => {
    if (!uid) { setSub(null); return; }
    try { setSub(await fetchSubscription()); } catch { /* не блокируем UI */ }
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const p = await fetchPlans();
        if (!alive) return;
        setPlans(p.plans); setPayTo(p.payTo); setTrialDays(p.trialDays);
        await refreshStatus(getUserId());
      } catch (e: any) {
        if (alive) setError(e?.message || 'Не удалось загрузить тарифы');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [refreshStatus]);

  const onRegister = async () => {
    setError('');
    try {
      const r = await registerAccount(email.trim() || undefined);
      setUserIdState(r.user_id);
      setSub(r);
      setOrderMsg(`Аккаунт создан. ID: ${r.user_id}`);
    } catch (e: any) {
      setError(e?.message || 'Ошибка регистрации');
    }
  };

  const onBuy = async (planId: string) => {
    setBusyPlan(planId); setOrderMsg(''); setError('');
    try {
      if (!getUserId()) {
        const r = await registerAccount(email.trim() || undefined);
        setUserIdState(r.user_id);
      }
      const res = await requestSubscription(planId);
      setSub(await fetchSubscription());
      const pay = (res as any).payTo || payTo;
      setOrderMsg(
        `Заявка создана (${(res as any).planTitle || planId}). ` +
        `Переведите ${(res as any).amountUsdt || ''} USDT на адрес оплаты` +
        (pay ? `: ${pay}` : '') +
        ' — подписка активируется после подтверждения платежа (обычно до 1 часа).'
      );
    } catch (e: any) {
      setError(e?.message || 'Не удалось оформить заявку');
    } finally {
      setBusyPlan('');
    }
  };

  const copyPay = async () => {
    if (!payTo) return;
    try { await navigator.clipboard.writeText(payTo); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* clipboard */ }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-gray-400 gap-3">
        <Loader2 className="w-5 h-5 animate-spin text-amber-400" /> {t('Загрузка тарифов…')}
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto">
      <h2 className="text-2xl font-bold text-white mb-1 flex items-center gap-2">
        <CreditCard className="w-6 h-6 text-amber-400" /> {t('Тарифы')}
      </h2>
      <p className="text-sm text-gray-400 mb-6">
        {t('Доступ к аналитике и журналу сигналов по подписке. Оплата в USDT (on-chain),\n        активация после подтверждения платежа.')}
        {trialDays > 0 && !userId && ` ${t('Первый доступ')} — ${trialDays} ${t('дней бесплатно')}.`}
      </p>

      {!hasBackend() && (
        <div className="mb-6 rounded-xl border border-gray-700 bg-surface-raised/60 p-4 text-sm text-gray-400">
          {t('Backend недоступен (локальная разработка) — покупка отключена.')}
        </div>
      )}

      {/* Статус аккаунта */}
      <div className="rounded-xl border border-gray-800 bg-surface-raised/60 p-4 sm:p-5 mb-6">
        {userId ? (
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-xs uppercase tracking-wider text-gray-500 mb-1">{t('Ваш аккаунт')}</p>
              <p className="text-sm text-gray-300 font-mono truncate">{userId}</p>
              <p className="text-sm mt-2">
                {sub?.active ? (
                  <span className="inline-flex items-center gap-1.5 text-emerald-400">
                    <CheckCircle2 className="w-4 h-4" />
                    {t(sub.planTitle ?? '')} — {t('действует до')} {fmtDate(sub.expiresAt, locale)}
                  </span>
                ) : sub?.pending ? (
                  <span className="text-amber-400">
                    {t('Заявка')} «{t(sub.pendingTitle ?? '')}» {t('ожидает подтверждения платежа…')}
                  </span>
                ) : trialDays > 0 ? (
                  <span className="text-gray-400">{t('Подписка не активна')}</span>
                ) : (
                  <span className="text-gray-400">{t('Подписка не активна')}</span>
                )}
              </p>
            </div>
            <button
              onClick={() => refreshStatus(userId)}
              className="text-xs px-3 py-1.5 rounded-lg border border-gray-700 text-gray-400 hover:text-white hover:border-gray-500 transition-colors self-start"
            >
              {t('Обновить статус')}
            </button>
          </div>
        ) : (
          <div className="flex flex-col sm:flex-row gap-3 sm:items-end">
            <div className="flex-1">
              <label className="block text-xs uppercase tracking-wider text-gray-500 mb-2">
                {t('Регистрация')}{trialDays > 0 ? ` — ${trialDays} ${t('дней бесплатно')}` : ''}
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t('Email (необязательно, для восстановления доступа)')}
                className="w-full rounded-lg bg-surface-deep border border-gray-700 px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-amber-500/60"
              />
            </div>
            <button
              onClick={onRegister}
              className="px-4 py-2 rounded-lg bg-gradient-to-br from-amber-400 to-orange-600 text-black text-sm font-semibold hover:shadow-lg hover:shadow-amber-500/20 transition-shadow whitespace-nowrap"
            >
              {t('Создать аккаунт')}
            </button>
          </div>
        )}
      </div>

      {error && (
        <div className="mb-6 rounded-xl border border-red-900/60 bg-red-950/40 p-3 text-sm text-red-300">
          {t(error)}
        </div>
      )}
      {orderMsg && (
        <div className="mb-6 rounded-xl border border-amber-800/60 bg-amber-950/30 p-3 sm:p-4 text-sm text-amber-200">
          <div className="flex items-start gap-3">
            <Sparkles className="w-4 h-4 mt-0.5 flex-shrink-0 text-amber-400" />
            <div className="min-w-0 flex-1">
              <p>{t(orderMsg)}</p>
              {(payTo || orderMsg.includes(':')) && payTo && (
                <button
                  onClick={copyPay}
                  className="mt-2 inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-lg border border-amber-700/60 text-amber-300 hover:bg-amber-500/10 transition-colors"
                >
                  <Copy className="w-3 h-3" /> {copied ? t('Скопировано') : t('Скопировать адрес')}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Карточки тарифов */}
      <div className="grid gap-4 sm:grid-cols-3">
        {plans.map((p) => {
          const current = sub?.active && sub.plan === p.id;
          return (
            <div
              key={p.id}
              className={`rounded-2xl border p-5 flex flex-col ${
                current
                  ? 'border-emerald-600/60 bg-emerald-950/20'
                  : 'border-gray-800 bg-surface-raised/60'
              }`}
            >
              <h3 className="text-sm font-semibold text-white mb-1">{t(p.title)}</h3>
              <p className="text-3xl font-bold text-amber-400 mb-4">
                {p.price_usdt}<span className="text-sm font-medium text-gray-400 ml-1">USDT</span>
              </p>
              <ul className="text-xs text-gray-400 space-y-2 mb-6 flex-1">
                <li className="flex gap-2"><CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" /> {t('Все паттерны Нисона и рыночный контекст')}</li>
                <li className="flex gap-2"><CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" /> {t('Журнал сигналов и бэктест')}</li>
                <li className="flex gap-2"><CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" /> {t('Синхронизация между устройствами')}</li>
              </ul>
              <button
                onClick={() => onBuy(p.id)}
                disabled={!hasBackend() || busyPlan === p.id || current}
                className="w-full py-2 rounded-lg text-sm font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed bg-amber-500/10 text-amber-400 border border-amber-500/30 hover:bg-amber-500/20"
              >
                {current ? t('Текущий план') : busyPlan === p.id ? t('Создание заявки…') : t('Выбрать')}
              </button>
            </div>
          );
        })}
      </div>

      <p className="mt-8 text-[11px] text-gray-600 leading-relaxed">
        {t('Оплачивая подписку, вы соглашаетесь с')}{' '}
        <a href="/legal/terms.html" className="underline hover:text-gray-400">{t('публичной офертой')}</a>
        {' '}{t('и')}{' '}
        <a href="/legal/privacy.html" className="underline hover:text-gray-400">{t('политикой конфиденциальности')}</a>.
        {t('Сервис носит информационный характер и не является индивидуальной инвестиционной рекомендацией.')}
      </p>
    </div>
  );
}
