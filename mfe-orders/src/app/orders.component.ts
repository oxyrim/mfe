import {
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  DestroyRef,
  OnInit,
  OnDestroy,
  inject,
  signal,
  computed,
} from '@angular/core';
import { CurrencyPipe } from '@angular/common';
import { Subscription } from 'rxjs';
import { OrdersWsService, OrderNotification } from './orders-ws.service';

interface MfeBusType {
  emit(type: string, payload?: unknown): void;
  on(type: string, handler: (payload: unknown) => void): () => void;
}
declare const MfeBus: MfeBusType;

// ── Domain types ──────────────────────────────────────────────────────────────

type LoanStatus = 'All' | 'Application' | 'Processing' | 'Underwriting' | 'Approved' | 'Closed' | 'Funded';

interface Loan {
  id: string;
  borrower: string;
  property: string;
  amount: number;
  loanType: string;
  ltv: number;
  status: Exclude<LoanStatus, 'All'>;
}

interface RateSuggestion {
  key: number;
  productName: string;
  loanType: string;
  term: number;
  rate: number;
  apr: number;
}

interface PlatformNotification {
  id: string;
  type: 'system_alert' | 'maintenance' | 'broadcast';
  title: string;
  message: string;
  timestamp: string;
}

// ── Component ─────────────────────────────────────────────────────────────────

@Component({
  selector: 'app-orders',
  standalone: true,
  imports: [CurrencyPipe],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `
    <div class="page">
      <div class="page-header">
        <h1 class="page-title">Loan Pipeline</h1>
        <ds-button variant="secondary">Export Report</ds-button>
      </div>

      <!--
        Rate lock suggestions — arrive via mfe:rate-locked events relayed
        from the Rate Sheet MFE through the shell broker.
      -->
      @if (rateSuggestions().length > 0) {
        <div class="suggestions-panel" role="region" aria-label="Rate lock suggestions">
          <h4 class="suggestions-title">Rate Lock Suggestions — from Rate Sheet MFE</h4>
          @for (s of rateSuggestions(); track s.key) {
            <div class="suggestion-item">
              <div class="suggestion-info">
                <span class="suggestion-name">{{ s.productName }}</span>
                <span class="suggestion-meta">{{ s.loanType }} · {{ s.term }}-yr</span>
              </div>
              <div class="suggestion-rates">
                <span class="suggestion-rate">{{ s.rate.toFixed(3) }}%</span>
                <span class="suggestion-apr">APR {{ s.apr.toFixed(3) }}%</span>
              </div>
              <button
                class="suggestion-dismiss"
                [attr.aria-label]="'Dismiss ' + s.productName"
                (click)="dismissSuggestion(s.key)">
                ✕
              </button>
            </div>
          }
        </div>
      }

      <!-- Signal-driven status filter -->
      <div class="filter-bar">
        @for (s of statuses; track s) {
          <button
            class="filter-btn"
            [class.active]="selectedStatus() === s"
            (click)="selectedStatus.set(s)">
            {{ s }}
          </button>
        }
      </div>

      <!-- Loan pipeline table -->
      <ds-card>
        @let loans = filteredLoans();
        <span slot="header">
          {{ loans.length }} {{ loans.length === 1 ? 'loan' : 'loans' }}
        </span>

        <table class="loans-table">
          <thead>
            <tr>
              <th>Loan ID</th>
              <th>Borrower</th>
              <th>Property</th>
              <th>Amount</th>
              <th>Type</th>
              <th>LTV</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            @for (loan of loans; track loan.id) {
              <tr>
                <td class="mono">{{ loan.id }}</td>
                <td>{{ loan.borrower }}</td>
                <td class="property">{{ loan.property }}</td>
                <td>{{ loan.amount | currency:'USD':'symbol':'1.0-0' }}</td>
                <td>
                  <span class="loan-type-badge badge--{{ loan.loanType.toLowerCase() }}">
                    {{ loan.loanType }}
                  </span>
                </td>
                <td
                  [class.ltv-low]="loan.ltv <= 80"
                  [class.ltv-mid]="loan.ltv > 80 && loan.ltv <= 90"
                  [class.ltv-high]="loan.ltv > 90">
                  {{ loan.ltv }}%
                </td>
                <td>
                  <span class="badge badge--{{ loan.status.toLowerCase() }}">
                    {{ loan.status }}
                  </span>
                </td>
              </tr>
            } @empty {
              <tr>
                <td colspan="7" class="empty-state">
                  No {{ selectedStatus() === 'All' ? '' : selectedStatus() + ' ' }}loans in pipeline.
                </td>
              </tr>
            }
          </tbody>
        </table>
      </ds-card>

      <!-- Platform alerts — relayed from shell via postMessage -->
      @if (platformNotifications().length > 0) {
        <ds-card class="platform-alerts-card">
          <span slot="header">🔔 Platform Alerts</span>
          @for (n of platformNotifications(); track n.id) {
            <div class="platform-notif-item">
              <div class="platform-notif-header">
                <span class="platform-notif-title">{{ n.title }}</span>
                <span class="notif-time">{{ formatTime(n.timestamp) }}</span>
              </div>
              <span class="platform-notif-msg">{{ n.message }}</span>
            </div>
          }
        </ds-card>
      }

      <!-- Order WebSocket notifications -->
      @if (notifications().length > 0) {
        <ds-card class="notif-panel">
          <span slot="header">Order Notifications</span>
          @for (n of notifications(); track n.id) {
            <div class="notif-item notif-item--{{ n.type }}">
              <span class="notif-msg">{{ n.message }}</span>
              <span class="notif-time">{{ formatTime(n.timestamp) }}</span>
            </div>
          }
        </ds-card>
      }
    </div>
  `,
})
export class OrdersComponent implements OnInit, OnDestroy {
  private readonly destroyRef      = inject(DestroyRef);
  private readonly ordersWsService = inject(OrdersWsService);

  private wsSubscription: Subscription | null = null;
  // Bound reference so we can remove the exact same listener in ngOnDestroy
  private readonly platformMessageHandler = (e: MessageEvent) => this.onPlatformMessage(e);

  // ── State signals ───────────────────────────────────────────────────────────
  readonly selectedStatus       = signal<LoanStatus>('All');
  readonly rateSuggestions      = signal<RateSuggestion[]>([]);
  readonly notifications        = signal<OrderNotification[]>([]);
  readonly platformNotifications = signal<PlatformNotification[]>([]);

  readonly statuses: LoanStatus[] = [
    'All', 'Application', 'Processing', 'Underwriting', 'Approved', 'Closed', 'Funded',
  ];

  private readonly allLoans: Loan[] = [
    { id: 'LN-2024-001', borrower: 'Sarah Mitchell',  property: '123 Oak Lane, Dallas TX',       amount: 485000, loanType: 'Conventional', ltv: 80,  status: 'Underwriting' },
    { id: 'LN-2024-002', borrower: 'James Rodriguez', property: '456 Pine Ave, Austin TX',        amount: 320000, loanType: 'FHA',          ltv: 96,  status: 'Processing'   },
    { id: 'LN-2024-003', borrower: 'Emily Chen',      property: '789 Maple Dr, Houston TX',       amount: 650000, loanType: 'Jumbo',        ltv: 75,  status: 'Approved'     },
    { id: 'LN-2024-004', borrower: 'Michael Torres',  property: '321 Elm St, San Antonio TX',     amount: 275000, loanType: 'VA',           ltv: 100, status: 'Application'  },
    { id: 'LN-2024-005', borrower: 'Lisa Park',       property: '654 Birch Blvd, Fort Worth TX',  amount: 410000, loanType: 'Conventional', ltv: 85,  status: 'Closed'       },
    { id: 'LN-2024-006', borrower: 'Robert Kim',      property: '987 Cedar Way, Plano TX',        amount: 225000, loanType: 'USDA',         ltv: 100, status: 'Funded'       },
    { id: 'LN-2024-007', borrower: 'Angela Davis',    property: '147 Walnut Ct, Frisco TX',       amount: 520000, loanType: 'Conventional', ltv: 78,  status: 'Underwriting' },
    { id: 'LN-2024-008', borrower: 'Thomas Wright',   property: '258 Spruce Ln, McKinney TX',     amount: 380000, loanType: 'FHA',          ltv: 94,  status: 'Processing'   },
  ];

  readonly filteredLoans = computed(() => {
    const s = this.selectedStatus();
    return s === 'All' ? this.allLoans : this.allLoans.filter(l => l.status === s);
  });

  constructor() {
    // MfeBus subscription — use DestroyRef so it's cleaned up whenever the
    // component is destroyed (consistent with the rest of the codebase).
    const unsub = MfeBus.on('mfe:rate-locked', (raw) => {
      const p = raw as Omit<RateSuggestion, 'key'>;
      this.rateSuggestions.update(prev =>
        [{ key: Date.now(), ...p }, ...prev].slice(0, 5)
      );
    });
    this.destroyRef.onDestroy(unsub);
  }

  ngOnInit(): void {
    // Connect to the orders WebSocket and stream events into the signal.
    this.ordersWsService.connect();
    this.wsSubscription = this.ordersWsService.events$.subscribe(n => {
      this.notifications.update(prev => [n, ...prev].slice(0, 5));
    });

    // Listen for platform-wide notifications relayed by the shell.
    window.addEventListener('message', this.platformMessageHandler);
  }

  ngOnDestroy(): void {
    this.ordersWsService.disconnect();
    this.wsSubscription?.unsubscribe();
    window.removeEventListener('message', this.platformMessageHandler);
  }

  dismissSuggestion(key: number): void {
    this.rateSuggestions.update(prev => prev.filter(s => s.key !== key));
  }

  formatTime(iso: string): string {
    return new Date(iso).toLocaleTimeString('en-US', {
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    });
  }

  private onPlatformMessage(e: MessageEvent): void {
    // Only trust messages that genuinely came from the shell origin.
    if (e.origin !== 'http://localhost:4200') return;
    if ((e.data as { type?: string })?.type !== 'PLATFORM_NOTIFICATION') return;
    const n = (e.data as { payload: PlatformNotification }).payload;
    this.platformNotifications.update(prev => [n, ...prev].slice(0, 3));
  }
}
