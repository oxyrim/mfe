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
import { Subscription } from 'rxjs';
import { ProductsWsService, RateNotification } from './products-ws.service';

interface MfeBusType {
  emit(type: string, payload?: unknown): void;
  on(type: string, handler: (payload: unknown) => void): () => void;
}
declare const MfeBus: MfeBusType;

// ── Domain types ──────────────────────────────────────────────────────────────

type LoanType = 'All' | 'Conventional' | 'FHA' | 'VA' | 'Jumbo' | 'USDA';

interface RateProduct {
  id: string;
  name: string;
  loanType: Exclude<LoanType, 'All'>;
  term: number;
  rate: number;
  apr: number;
  points: number;
  minFico: number;
  maxLtv: number;
}

interface PlatformNotification {
  id: string;
  type: 'rate_sheet_published' | 'market_update' | 'compliance_notice';
  title: string;
  message: string;
  timestamp: string;
}

// ── Component ─────────────────────────────────────────────────────────────────

@Component({
  selector: 'app-products',
  standalone: true,
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `
    <div class="page">
      <div class="page-header">
        <h1 class="page-title">Rate Sheet</h1>
        <span class="rate-date">Effective: {{ today }}</span>
      </div>

      <!-- Loan-type filter -->
      <div class="filter-bar">
        @for (t of loanTypes; track t) {
          <button
            class="filter-btn"
            [class.active]="filterType() === t"
            (click)="filterType.set(t)">
            {{ t }}
          </button>
        }
      </div>

      @let rates = filteredRates();
      @let count = rates.length;
      <p class="rate-count">{{ count }} {{ count === 1 ? 'product' : 'products' }}</p>

      <!-- Rate cards grid -->
      <div class="rates-grid">
        @for (product of rates; track product.id) {
          <ds-card>
            <span slot="header">{{ product.name }}</span>

            <div class="rate-meta">
              <div class="rate-primary">
                <span class="rate-value">{{ product.rate.toFixed(3) }}%</span>
                <span class="rate-label">Interest Rate</span>
              </div>

              <div class="rate-details">
                <div class="rate-detail">
                  <span>APR</span>
                  <strong>{{ product.apr.toFixed(3) }}%</strong>
                </div>
                <div class="rate-detail">
                  <span>Points</span>
                  <strong>{{ product.points.toFixed(3) }}</strong>
                </div>
                <div class="rate-detail">
                  <span>Min FICO</span>
                  <strong>{{ product.minFico }}</strong>
                </div>
                <div class="rate-detail">
                  <span>Max LTV</span>
                  <strong>{{ product.maxLtv }}%</strong>
                </div>
                <div class="rate-detail">
                  <span>Term</span>
                  <strong>{{ product.term }} yr</strong>
                </div>
                <div class="rate-detail">
                  <span>Type</span>
                  <strong>
                    <span class="loan-type-badge badge--{{ product.loanType.toLowerCase() }}">
                      {{ product.loanType }}
                    </span>
                  </strong>
                </div>
              </div>

              <!--
                "Lock Rate" emits mfe:rate-locked via MfeBus.
                Shell broker relays it to the Loan Pipeline MFE.
                lastLocked signal drives brief button feedback.
              -->
              <ds-button
                class="lock-btn"
                [attr.variant]="lastLocked() === product.id ? 'secondary' : 'primary'"
                (click)="lockRate(product)">
                {{ lastLocked() === product.id ? 'Rate Locked!' : 'Lock Rate' }}
              </ds-button>
            </div>
          </ds-card>
        } @empty {
          <p class="empty-state">No products available for this loan type.</p>
        }
      </div>

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

      <!-- Rate Sheet live events via WebSocket -->
      @if (notifications().length > 0) {
        <ds-card class="notif-panel">
          <span slot="header">Live Rate Activity</span>
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
export class ProductsComponent implements OnInit, OnDestroy {
  private readonly destroyRef       = inject(DestroyRef);
  private readonly productsWsService = inject(ProductsWsService);

  private wsSubscription: Subscription | null = null;
  private readonly platformMessageHandler = (e: MessageEvent) => this.onPlatformMessage(e);

  // ── State signals ───────────────────────────────────────────────────────────
  readonly filterType            = signal<LoanType>('All');
  readonly lastLocked            = signal<string | null>(null);
  readonly notifications         = signal<RateNotification[]>([]);
  readonly platformNotifications = signal<PlatformNotification[]>([]);

  readonly loanTypes: LoanType[] = ['All', 'Conventional', 'FHA', 'VA', 'Jumbo', 'USDA'];

  readonly today = new Date().toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric',
  });

  private readonly allRates: RateProduct[] = [
    { id: 'R-001', name: '30-Year Fixed',       loanType: 'Conventional', term: 30, rate: 6.875, apr: 6.943, points: 0.500, minFico: 620, maxLtv: 97  },
    { id: 'R-002', name: '15-Year Fixed',       loanType: 'Conventional', term: 15, rate: 6.250, apr: 6.318, points: 0.375, minFico: 620, maxLtv: 97  },
    { id: 'R-003', name: '5/1 ARM',             loanType: 'Conventional', term: 30, rate: 6.500, apr: 6.612, points: 0.250, minFico: 640, maxLtv: 90  },
    { id: 'R-004', name: '30-Year Fixed FHA',   loanType: 'FHA',          term: 30, rate: 6.750, apr: 7.523, points: 0.500, minFico: 580, maxLtv: 96  },
    { id: 'R-005', name: '30-Year Fixed VA',    loanType: 'VA',           term: 30, rate: 6.625, apr: 6.693, points: 0.000, minFico: 580, maxLtv: 100 },
    { id: 'R-006', name: '15-Year Fixed VA',    loanType: 'VA',           term: 15, rate: 6.000, apr: 6.068, points: 0.000, minFico: 580, maxLtv: 100 },
    { id: 'R-007', name: '30-Year Fixed Jumbo', loanType: 'Jumbo',        term: 30, rate: 7.125, apr: 7.198, points: 0.750, minFico: 700, maxLtv: 80  },
    { id: 'R-008', name: '30-Year Fixed USDA',  loanType: 'USDA',         term: 30, rate: 6.700, apr: 7.156, points: 0.000, minFico: 640, maxLtv: 100 },
  ];

  readonly filteredRates = computed(() => {
    const t = this.filterType();
    return t === 'All' ? this.allRates : this.allRates.filter(r => r.loanType === t);
  });

  private lockTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.destroyRef.onDestroy(() => {
      if (this.lockTimer) clearTimeout(this.lockTimer);
    });
  }

  ngOnInit(): void {
    this.productsWsService.connect();
    this.wsSubscription = this.productsWsService.events$.subscribe(n => {
      this.notifications.update(prev => [n, ...prev].slice(0, 5));
    });
    window.addEventListener('message', this.platformMessageHandler);
  }

  ngOnDestroy(): void {
    this.productsWsService.disconnect();
    this.wsSubscription?.unsubscribe();
    window.removeEventListener('message', this.platformMessageHandler);
  }

  lockRate(product: RateProduct): void {
    MfeBus.emit('mfe:rate-locked', {
      id:          product.id,
      productName: product.name,
      loanType:    product.loanType,
      term:        product.term,
      rate:        product.rate,
      apr:         product.apr,
    });

    this.lastLocked.set(product.id);
    if (this.lockTimer) clearTimeout(this.lockTimer);
    this.lockTimer = setTimeout(() => this.lastLocked.set(null), 2000);
  }

  formatTime(iso: string): string {
    return new Date(iso).toLocaleTimeString('en-US', {
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    });
  }

  private onPlatformMessage(e: MessageEvent): void {
    if (e.origin !== 'http://localhost:4200') return;
    if ((e.data as { type?: string })?.type !== 'PLATFORM_NOTIFICATION') return;
    const n = (e.data as { payload: PlatformNotification }).payload;
    this.platformNotifications.update(prev => [n, ...prev].slice(0, 3));
  }
}
