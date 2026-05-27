import {
  AfterViewInit,
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  DestroyRef,
  OnDestroy,
  effect,
  inject,
  signal,
  viewChildren,
  ElementRef,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { ThemeService } from './theme.service';
import { PlatformWsService } from './platform-ws.service';

interface MfeApp {
  label: string;
  path:  string;
  port:  number;
  url:   SafeResourceUrl;
}

interface BusEnvelope {
  __mfeBus: true;
  type:     string;
  payload:  unknown;
}

@Component({
  selector: 'app-root',
  standalone: true,
  templateUrl: './app.component.html',
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
})
export class AppComponent implements AfterViewInit, OnDestroy {
  private readonly sanitizer        = inject(DomSanitizer);
  private readonly destroyRef       = inject(DestroyRef);
  readonly themeService             = inject(ThemeService);
  readonly platformWsService        = inject(PlatformWsService);

  readonly activeApp = signal('orders');
  readonly toast     = signal<string | null>(null);

  /** Unread platform notification count — converts Observable to signal. */
  readonly notificationCount = toSignal(
    this.platformWsService.notificationCount$,
    { initialValue: 0 }
  );

  readonly apps: MfeApp[] = [
    { label: 'Loan Pipeline', path: 'orders',   port: 4201 },
    { label: 'Rate Sheet',    path: 'products', port: 4202 },
  ].map(a => ({
    ...a,
    url: this.sanitizer.bypassSecurityTrustResourceUrl(`http://localhost:${a.port}`),
  }));

  private readonly iframes =
    viewChildren<ElementRef<HTMLIFrameElement>>('mfeFrame');

  private toastTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    // Apply theme to shell document, persist, and broadcast to all MFE iframes.
    // Re-runs when theme() changes (toggle) OR when iframes() changes (new iframe
    // rendered), so freshly created iframes always receive the current theme.
    effect(() => {
      const t = this.themeService.theme();
      document.documentElement.setAttribute('data-theme', t);
      localStorage.setItem('fnm-theme', t);
      this.broadcastToAll('theme:changed', { theme: t });
    });

    const handler = (e: MessageEvent) => this.relay(e);
    window.addEventListener('message', handler);
    this.destroyRef.onDestroy(() => window.removeEventListener('message', handler));
  }

  ngAfterViewInit(): void {
    // Register all persistent iframes with PlatformWsService so it can relay
    // platform notifications into each MFE context.
    for (const ref of this.iframes()) {
      this.platformWsService.registerIframe(ref.nativeElement);
    }
    this.platformWsService.connect();
  }

  ngOnDestroy(): void {
    this.platformWsService.disconnect();
    if (this.toastTimer) clearTimeout(this.toastTimer);
  }

  navigate(path: string): void { this.activeApp.set(path); }

  dismissToast(): void {
    this.toast.set(null);
    if (this.toastTimer) clearTimeout(this.toastTimer);
  }

  private relay(e: MessageEvent): void {
    const env = e.data as Partial<BusEnvelope>;
    if (env?.__mfeBus !== true) return;

    // MFE booted and is requesting the current theme — respond directly, skip relay
    if (env.type === 'theme:request-state') {
      (e.source as Window).postMessage({
        __mfeBus: true,
        type:    'theme:changed',
        payload: { theme: this.themeService.theme() },
      }, '*');
      return;
    }

    // Generic relay: forward to every iframe except the sender
    for (const ref of this.iframes()) {
      const win = ref.nativeElement.contentWindow;
      if (win && win !== e.source) win.postMessage(e.data, '*');
    }

    if (env.type === 'mfe:rate-locked') {
      const { productName, rate } =
        env.payload as { productName: string; rate: number };
      this.showToast(`Rate Locked: ${rate.toFixed(3)}% — ${productName}`);
    }
  }

  private broadcastToAll(type: string, payload: unknown): void {
    const msg: BusEnvelope = { __mfeBus: true, type, payload };
    for (const ref of this.iframes()) {
      ref.nativeElement.contentWindow?.postMessage(msg, '*');
    }
  }

  private showToast(msg: string): void {
    this.toast.set(msg);
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.toast.set(null), 4000);
  }
}
