// Регресс на Minified React error #310: шапка не должна падать, если страница
// опубликовала битый mini-заголовок (не-строки), а formatPrice должен
// возвращать безопасную строку для NaN/undefined/Infinity.
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Layout, { useHeaderBadge } from './components/Layout';
import { formatPrice } from './utils/format';

function BrokenBadgePublisher() {
  const { setBadge } = useHeaderBadge();
  // Симулируем «битый» бейдж как any — ровно то, что раньше роняло весь app
  (setBadge as unknown as (b: unknown) => void)({ title: 12345, price: { usd: 100 } });
  return <div data-testid="page">page</div>;
}

describe('guard against React #310 in header badge', () => {
  it('formatPrice returns placeholder for non-finite values', () => {
    expect(formatPrice(NaN)).toBe('—');
    expect(formatPrice(undefined as unknown as number)).toBe('—');
    expect(formatPrice(Infinity)).toBe('—');
    expect(formatPrice(112340)).toBe('112\u00A0340'); // обычное значение не тронуто
  });

  it('Layout survives a malformed badge payload without throwing', () => {
    render(
      <MemoryRouter initialEntries={['/analysis/BTCUSDT']}>
        <Layout />
        <BrokenBadgePublisher />
      </MemoryRouter>,
    );
    // Если бы badge прошёл с не-строками — React кинул бы #310 и тест упал бы.
    expect(screen.getByTestId('page')).toBeTruthy();
    expect(screen.queryByText('[object Object]')).toBeNull();
  });
});
