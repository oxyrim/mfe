import {
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  DestroyRef,
  inject,
  signal,
  computed,
} from '@angular/core';

interface MfeBusType {
  emit(type: string, payload?: unknown): void;
  on(type: string, handler: (payload: unknown) => void): () => void;
}
declare const MfeBus: MfeBusType;

type LoanType = 'All' | 'Conventional' | 'FHA' | 'VA' | 'Jumbo' | 'USDA';

interface RateProduct {
  id: string;
  name: string;
  loanType: Exclude<LoanType, 'All'>;
  term: number;       // years
  rate: number;       // interest rate %
  apr: number;        // APR %
  points: number;     // origination points
  minFico: number;
  maxLtv: number;
}

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

      <div class="rates-grid">
        @for (product of rates; track product.id) {
          <ds-card>
            <span slot="header">{{ product.name }}</span>

            <div class="rate-meta">
              <!-- Prominent rate display -->
              <div class="rate-primary">
                <span class="rate-value">{{ product.rate.toFixed(3) }}%</span>
                <span class="rate-label">Interest Rate</span>
              </div>

              <!-- Detail grid -->
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
    </div>
  `,
})
export class ProductsComponent {
  private readonly destroyRef = inject(DestroyRef);

  readonly filterType  = signal<LoanType>('All');
  readonly lastLocked  = signal<string | null>(null);

  readonly loanTypes: LoanType[] = ['All', 'Conventional', 'FHA', 'VA', 'Jumbo', 'USDA'];

  readonly today = new Date().toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric',
  });

  private readonly allRates: RateProduct[] = [
    { id: 'R-001', name: '30-Year Fixed',         loanType: 'Conventional', term: 30, rate: 6.875, apr: 6.943, points: 0.500, minFico: 620, maxLtv: 97  },
    { id: 'R-002', name: '15-Year Fixed',         loanType: 'Conventional', term: 15, rate: 6.250, apr: 6.318, points: 0.375, minFico: 620, maxLtv: 97  },
    { id: 'R-003', name: '5/1 ARM',               loanType: 'Conventional', term: 30, rate: 6.500, apr: 6.612, points: 0.250, minFico: 640, maxLtv: 90  },
    { id: 'R-004', name: '30-Year Fixed FHA',     loanType: 'FHA',          term: 30, rate: 6.750, apr: 7.523, points: 0.500, minFico: 580, maxLtv: 96  },
    { id: 'R-005', name: '30-Year Fixed VA',      loanType: 'VA',           term: 30, rate: 6.625, apr: 6.693, points: 0.000, minFico: 580, maxLtv: 100 },
    { id: 'R-006', name: '15-Year Fixed VA',      loanType: 'VA',           term: 15, rate: 6.000, apr: 6.068, points: 0.000, minFico: 580, maxLtv: 100 },
    { id: 'R-007', name: '30-Year Fixed Jumbo',   loanType: 'Jumbo',        term: 30, rate: 7.125, apr: 7.198, points: 0.750, minFico: 700, maxLtv: 80  },
    { id: 'R-008', name: '30-Year Fixed USDA',    loanType: 'USDA',         term: 30, rate: 6.700, apr: 7.156, points: 0.000, minFico: 640, maxLtv: 100 },
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
}
