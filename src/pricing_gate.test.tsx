// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { PRICING_ENABLED } from './App';

describe('Флаг доступа к странице «Тарифы»', () => {
  it('страница закрыта до доработки приёмов платежей', () => {
    expect(PRICING_ENABLED).toBe(false);
  });

  it('в Layout нет ссылки «Тарифы», когда страница закрыта', async () => {
    const { default: Layout } = await import('./components/Layout');
    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<Layout />}>
            <Route index element={<div>dashboard-stub</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.queryByText('Тарифы')).toBeNull();
    // остальные пункты навигации на месте
    expect(screen.getAllByText('Обзор').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Поддержать').length).toBeGreaterThan(0);
  });
});
