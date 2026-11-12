/**
 * Регресс-тест: баннер «Сайт обновлён» на главной (вариант 1 — BUILD_ID).
 * Механизм: vite при сборке инжектирует import.meta.env.VITE_BUILD_ID;
 * клиент сравнивает его с последним виденным значением в localStorage.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import UpdateBanner from './components/UpdateBanner';
import Layout from './components/Layout';
// импортируем реальный модуль (без mock) — isNewBuild/markBuildSeen принимают id аргументом
import { BUILD_ID_KEY, isNewBuild, markBuildSeen } from './utils/buildUpdate';

afterEach(cleanup);

describe('buildUpdate: контракт детекта обновления', () => {
  beforeEach(() => localStorage.clear());

  it('первый визит на новый билд → hasUpdate === true', () => {
    expect(isNewBuild('build-A')).toBe(true);
  });

  it('тот же билд повторно → false (после markBuildSeen)', () => {
    markBuildSeen('build-A');
    expect(localStorage.getItem(BUILD_ID_KEY)).toBe('build-A');
    expect(isNewBuild('build-A')).toBe(false);
  });

  it('деплоя был (ID изменился) → снова true', () => {
    markBuildSeen('build-A');
    expect(isNewBuild('build-B')).toBe(true);
  });

  it('пустой ID (тестовая среда без define) → false, banner не показывается', () => {
    expect(isNewBuild(undefined)).toBe(false);
  });

  it('localStorage недоступен (приватный режим) → false, без исключения', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    try {
      expect(isNewBuild('build-A')).toBe(false);
      expect(() => markBuildSeen('build-A')).not.toThrow();
    } finally {
      spy.mockRestore();
    }
  });
});

describe('UpdateBanner: отображение на главной', () => {
  it('visible=true → рендерится строка RU', () => {
    render(<UpdateBanner visible onDismiss={() => {}} />);
    expect(screen.getByTestId('update-banner')).toBeTruthy();
    expect(screen.getByText('Сайт обновлён — вышел новый релиз')).toBeTruthy();
  });

  it('visible=false → ничего не рендерится', () => {
    const { container } = render(<UpdateBanner visible={false} onDismiss={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  it('клик по крестику вызывает onDismiss', () => {
    const onDismiss = vi.fn();
    render(<UpdateBanner visible onDismiss={onDismiss} />);
    fireEvent.click(screen.getByLabelText('Закрыть'));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('авто-скрытие через 10 секунд вызывает onDismiss', () => {
    vi.useFakeTimers();
    try {
      const onDismiss = vi.fn();
      render(<UpdateBanner visible onDismiss={onDismiss} />);
      act(() => {
        vi.advanceTimersByTime(10_000);
      });
      expect(onDismiss).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('Бейдж сборки в подвале (постоянный индикатор версии)', () => {
  beforeEach(() => localStorage.clear());

  it('Layout рендерит build-badge с BUILD_ID (в vitest define не инжектируется, fallback dev)', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <Layout />
      </MemoryRouter>,
    );
    const badge = screen.getByTestId('build-badge');
    // Формат: «build <id>». В тестовой среде VITE_BUILD_ID отсутствует — fallback.
    expect(badge.textContent).toContain('build ');
    expect(badge.textContent).toMatch(/build (\S+)$/);
    expect(badge.getAttribute('title')).toBe('Идентификатор сборки: меняется при каждом деплое');
  });

  it('isNewBuild + markBuildSeen: бейдж виден всегда, баннер — только на новом билде', () => {
    // Контракт: build-badge статичен (не зависит от localStorage),
    // а «одноразовость» баннера обеспечивает пара isNewBuild/markBuildSeen.
    expect(isNewBuild('build-X')).toBe(true);
    markBuildSeen('build-X');
    expect(isNewBuild('build-X')).toBe(false);
  });
});
