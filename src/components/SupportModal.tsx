import { useEffect, useRef, useState } from 'react';
import { X, Copy, Check, Heart } from 'lucide-react';
import QRCode from 'qrcode';

/** Кошелёк GRAM (TON-адрес для приёма GRAMUSDT в сети The Open Network). */
const TON_ADDRESS = 'UQC1vSZHIqeUse_Zsql534hbGKRQEBFgdlk6nEtkKbLo5HX6';
/** Deep-link кошелька TON: открывается Tonkeeper/TON Wallet по QR. */
const TON_LINK = `ton://transfer/${TON_ADDRESS}`;

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function SupportModal({ open, onClose }: Props) {
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [copied, setCopied] = useState(false);
  const imgRef = useRef<HTMLImageElement | null>(null);

  // Генерируем QR один раз при первом открытии.
  // Тёмные модули на прозрачном фоне + белый «подложка»-контейнер в разметке ниже,
  // чтобы сканер читал QR независимо от темы приложения.
  useEffect(() => {
    if (!open || qrDataUrl) return;
    let cancelled = false;
    QRCode.toDataURL(TON_LINK, {
      errorCorrectionLevel: 'M',
      width: 480,
      margin: 2,
      color: { dark: '#0a0e17ff', light: '#ffffffff' },
    })
      .then((url) => {
        if (!cancelled) setQrDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setQrDataUrl('');
      });
    return () => {
      cancelled = true;
    };
  }, [open, qrDataUrl]);

  // Esc для закрытия
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const copyAddress = async () => {
    try {
      await navigator.clipboard.writeText(TON_ADDRESS);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard недоступен — пользователь скопирует вручную */
    }
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Поддержать развитие проекта"
    >
      <div
        className="relative w-full max-w-md rounded-2xl border border-amber-500/30 bg-[#0d1321] shadow-2xl shadow-amber-500/10 p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          aria-label="Закрыть"
          className="absolute right-3 top-3 p-1.5 rounded-lg text-gray-500 hover:text-white hover:bg-white/5 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="flex items-center gap-2 mb-1">
          <Heart className="w-5 h-5 text-amber-400 fill-amber-400/20" />
          <h3 className="text-lg font-bold text-white">Поддержать проект</h3>
        </div>
        <p className="text-sm text-gray-400 mb-5">
          Nison Analytics развивается бесплатно. Если анализ полезен — вы можете поддержать
          развитие проекта переводом GRAM в сети The Open Network.
        </p>

        {/* QR с deep-link ton://transfer/<адрес> — сканируется Tonkeeper и другими кошельками TON */}
        <div className="flex justify-center mb-5">
          {qrDataUrl ? (
            <img
              ref={imgRef}
              src={qrDataUrl}
              alt="QR-код для отправки GRAM"
              className="w-48 h-48 rounded-xl border-4 border-white bg-white p-1"
            />
          ) : (
            <div className="w-48 h-48 rounded-xl bg-white/5 animate-pulse flex items-center justify-center text-xs text-gray-500">
              Генерация QR…
            </div>
          )}
        </div>

        <p className="text-[11px] text-gray-500 text-center mb-4 -mt-2">
          Откройте кошелёк TON (Tonkeeper / MyTonWallet) → «Отправить» → отсканируйте QR.
          Сеть: <span className="text-gray-300 font-medium">The Open Network (TON)</span>.
        </p>

        {/* Адрес + копирование */}
        <div className="rounded-lg border border-gray-800 bg-[#0a0e17] p-3">
          <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">
            Адрес кошелька GRAM
          </div>
          <div className="flex items-center gap-2">
            <code className="flex-1 break-all text-xs text-amber-300 font-mono leading-relaxed">
              {TON_ADDRESS}
            </code>
            <button
              onClick={copyAddress}
              className={`flex-shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors ${
                copied
                  ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                  : 'bg-amber-500/10 text-amber-400 border border-amber-500/30 hover:bg-amber-500/20'
              }`}
              title="Скопировать адрес"
            >
              {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? 'Скопировано' : 'Копировать'}
            </button>
          </div>
        </div>

        <p className="text-[10px] text-gray-600 mt-4 text-center">
          Переводите только GRAMUSDT в сети TON. Отправка в другой сети приведёт к потере средств.
        </p>
      </div>
    </div>
  );
}
