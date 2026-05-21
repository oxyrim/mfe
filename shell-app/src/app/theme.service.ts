import { Injectable, signal } from '@angular/core';

export type Theme = 'light' | 'dark';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  /**
   * Initialise from localStorage, falling back to the OS preference.
   * Both sources are checked at construction time so the signal starts
   * with the correct value before any effect runs.
   */
  readonly theme = signal<Theme>(this.resolve());

  toggle(): void {
    this.theme.update(t => (t === 'light' ? 'dark' : 'light'));
  }

  private resolve(): Theme {
    const stored = localStorage.getItem('fnm-theme') as Theme | null;
    if (stored === 'light' || stored === 'dark') return stored;
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light';
  }
}
