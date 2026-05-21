import { Injectable, signal } from '@angular/core';

export type Theme = 'light' | 'dark';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  readonly theme = signal<Theme>('light');

  constructor() {
    window.addEventListener('message', (e: MessageEvent) => {
      if (e.data?.__mfeBus !== true) return;
      if (e.data.type !== 'theme:changed') return;
      const t = (e.data.payload as { theme: Theme }).theme;
      this.theme.set(t);
      document.documentElement.setAttribute('data-theme', t);
    });

    if (window !== window.parent) {
      window.parent.postMessage(
        { __mfeBus: true, type: 'theme:request-state', payload: null }, '*'
      );
    }
  }
}
