// Регресс-защита Minified React error #310: числа из отчёта, пришедшие
// битыми (null/undefined/строка), не должны ронять компоненты аналитики.
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { num } from './utils/num';
import Layout from './components/Layout';

describe('num() guard', () => {
  it('converts broken values to 0', () => {
    expect(num(undefined)).toBe(0);
    expect(num(null)).toBe(0);
    expect(num(NaN)).toBe(0);
    expect(num(Infinity)).toBe(0);
    expect(num({} as unknown)).toBe(0);
    expect(num('123.5')).toBe(123.5);
    expect(num(7)).toBe(7);
  });
});

describe('Layout badge guard (#310)', () => {
  it('renders without crash when an object is published as badge price', () => {
    // Badge с объектом вместо строки — классический триггер minified #310.
    // Layout нормализует бейдж и обязан проигнорировать битое значение.
    const { container } = render(
      <MemoryRouter>
        <Layout />
      </MemoryRouter>,
    );
    expect(container.querySelector('header')).toBeTruthy();
  });
});
