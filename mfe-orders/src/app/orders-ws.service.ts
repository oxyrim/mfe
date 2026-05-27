import { Injectable } from '@angular/core';
import { Subject, Observable } from 'rxjs';

export interface LoanNotification {
  id: string;
  type: 'loan_submitted' | 'status_changed' | 'document_required';
  loanId: string;
  message: string;
  timestamp: string;
}

@Injectable({ providedIn: 'root' })
export class OrdersWsService {
  private ws: WebSocket | null = null;
  private readonly subject = new Subject<LoanNotification>();
  readonly events$: Observable<LoanNotification> = this.subject.asObservable();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private intentionalClose = false;

  connect(): void {
    this.intentionalClose = false;
    try {
      this.ws = new WebSocket('ws://localhost:3001/ws/loans');
    } catch {
      this.scheduleReconnect();
      return;
    }

    this.ws.onmessage = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data as string) as LoanNotification;
        this.subject.next(data);
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

  private scheduleReconnect(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => this.connect(), 3000);
  }
}
