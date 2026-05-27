import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';

export interface PlatformNotification {
  id: string;
  type: 'rate_sheet_published' | 'market_update' | 'compliance_notice';
  title: string;
  message: string;
  timestamp: string;
}

@Injectable({ providedIn: 'root' })
export class PlatformWsService {
  private ws: WebSocket | null = null;
  private iframes: HTMLIFrameElement[] = [];
  private intentionalClose = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  private readonly countSubject = new BehaviorSubject<number>(0);
  readonly notificationCount$: Observable<number> = this.countSubject.asObservable();

  registerIframe(iframe: HTMLIFrameElement): void {
    if (!this.iframes.includes(iframe)) {
      this.iframes.push(iframe);
    }
  }

  connect(): void {
    this.intentionalClose = false;
    try {
      this.ws = new WebSocket('ws://localhost:3001/ws/platform');
    } catch {
      this.scheduleReconnect();
      return;
    }

    this.ws.onmessage = (event: MessageEvent) => {
      try {
        const msg = JSON.parse(event.data as string) as PlatformNotification;
        this.relay(msg);
      } catch { /* ignore parse errors */ }
    };

    this.ws.onclose = () => {
      if (!this.intentionalClose) this.scheduleReconnect();
    };

    this.ws.onerror = () => {};
  }

  disconnect(): void {
    this.intentionalClose = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
    this.ws = null;
  }

  resetCount(): void {
    this.countSubject.next(0);
  }

  private relay(msg: PlatformNotification): void {
    this.countSubject.next(this.countSubject.getValue() + 1);
    for (const iframe of this.iframes) {
      // In local dev '*' is acceptable; production must use the exact MFE origin.
      iframe.contentWindow?.postMessage(
        { type: 'PLATFORM_NOTIFICATION', payload: msg },
        '*'
      );
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => this.connect(), 3000);
  }
}
