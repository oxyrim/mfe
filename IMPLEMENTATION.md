# MortgageCo Loan Platform — Microfrontend Implementation Guide

This document explains the **reasoning, theory, and trade-offs** behind every architectural decision in this project, with the actual code that implements each idea. Code alone tells you *what* was written; this guide tells you *why*.

---

## What is a Microfrontend and Why Use One?

A traditional single-page application puts every feature into one codebase, one build pipeline, and one deployment. When the codebase grows — and especially when multiple teams work on it — this creates bottlenecks: a change to one feature can break another, deployments are coupled, and teams step on each other's work.

A **microfrontend** applies the same principle as microservices but to the frontend layer. Each major feature area (Loan Pipeline, Rate Sheet) is an independently developed, independently deployed application. Teams own their slice end to end.

**The key trade-off:**
- **Module Federation** (Webpack 5 / Angular Native Federation): MFEs share the same JS runtime. Easier communication, smaller bundles, but version conflicts between shared libraries are a real problem and a single runtime error can cascade everywhere.
- **iframe isolation** (this project): Each MFE is a completely separate browser context. No shared runtime, no CSS bleed, no JS conflicts. Communication is more deliberate (postMessage), but each MFE is completely autonomous.

We chose iframes because the goal is a **true PoC of the isolation model** — the same model used by large platforms like Salesforce, SAP, and enterprise portals. It also means each team could use a different framework entirely if they wanted to.

---

## Project Structure

```
mfe/
├── shell-app/          # Angular host app  — :4200
├── mfe-orders/         # Loan Pipeline MFE — :4201
├── mfe-products/       # Rate Sheet MFE    — :4202
├── shared-ds/          # Shared design system (CSS tokens, web components, MfeBus)
└── ws-server/          # Mock WebSocket server (Node.js) — :3001
```

Each Angular app has its own `package.json`, its own dev server, and its own build. They share nothing at the module level. The only shared artefacts are in `shared-ds/` — and these are deliberately framework-agnostic so they work in any iframe regardless of what technology the team uses.

---

## Step 1 — Angular App Bootstrap (Zoneless)

### The problem with zone.js

For most of Angular's history, change detection relied on **zone.js** — a library that monkey-patches every async browser API (`setTimeout`, `Promise`, `fetch`, DOM events, etc.) to intercept calls and tell Angular "something might have changed, please check everything."

This works, but it has real costs:
- It patches browser globals, which is invisible and hard to debug.
- On every async operation Angular has to walk the entire component tree to check for changes (unless you opt into `OnPush` everywhere).
- In an iframe-heavy architecture, multiple iframes each running zone.js creates extra overhead.

### What signals do differently

Angular 21 **signals** are reactive primitives. When you write:

```typescript
readonly activeApp = signal('orders');
```

You create a value that Angular tracks at the point of use. When `activeApp.set('products')` is called, Angular knows *exactly* which templates read `activeApp()` and re-renders only those — no tree walk, no zone needed.

### Bootstrap without zones

```typescript
// shell-app/src/app/app.config.ts
import { ApplicationConfig, provideZonelessChangeDetection } from '@angular/core';

export const appConfig: ApplicationConfig = {
  providers: [
    provideZonelessChangeDetection(),   // remove zone.js entirely
    provideRouter(routes),
  ],
};
```

`provideZonelessChangeDetection()` tells Angular to rely entirely on signals and explicit `markForCheck()` calls. The result is a leaner, more predictable app where you always know *what* caused a re-render.

### Standalone components — no NgModule

Every component in this project is `standalone: true`. This means:

```typescript
@Component({
  selector: 'app-orders',
  standalone: true,
  imports: [CurrencyPipe],   // explicit dependencies — no shared module barrel
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `...`,
})
export class OrdersComponent { }
```

There is no `AppModule` declaring components. This makes the dependency graph explicit and enables better tree-shaking. It also removes a class of bugs where a component works only because something else in the module imported a dependency for it.

---

## Step 2 — Persistent iFrame Integration

### Why iframes at all?

An iframe gives each MFE a **completely separate browser context**:
- Its own `window` object — no global variable conflicts.
- Its own CSS cascade — no style leakage between apps.
- Its own JavaScript heap — a memory leak in one MFE doesn't affect others.
- Its own Content Security Policy — security can be tightened per-MFE.

The isolation comes for free from the browser. You don't need Webpack boundaries, version alignment, or custom module loaders.

### Persistent vs. dynamic iframes — a critical design choice

The naive approach is to create an iframe when the user navigates to a feature and destroy it when they leave. This is simple, but it means:
- Every navigation reloads the MFE from scratch (network requests, Angular bootstrap, re-fetching data).
- Any local state (open modals, form values, scroll position, in-progress WS connections) is lost.

**This project creates all iframes at application startup and never destroys them.** Visibility is controlled with `display: none` rather than removing elements from the DOM.

```html
<!-- shell-app/src/app/app.component.html -->
<main class="shell-main">
  @for (app of apps; track app.path) {
    <iframe
      #mfeFrame
      [src]="app.url"
      [title]="app.label"
      class="mfe-frame"
      [style.display]="activeApp() === app.path ? 'block' : 'none'">
    </iframe>
  }
</main>
```

`display: none` hides the iframe visually but keeps it fully alive in memory. When the user switches back, the MFE is exactly where they left it — WebSocket connections still open, signals still holding their last values. This is the same technique used by browser tab management.

### Template reference variable `#mfeFrame`

```typescript
// shell-app/src/app/app.component.ts
private readonly iframes =
  viewChildren<ElementRef<HTMLIFrameElement>>('mfeFrame');
```

`viewChildren('mfeFrame')` uses Angular 21's signal-based query API. The `'mfeFrame'` string matches the `#mfeFrame` template reference variable on each `<iframe>` element. The result is a `Signal<readonly ElementRef[]>` that always reflects the current DOM state. Reading `this.iframes()` inside an `effect()` means the effect automatically re-runs if the list of iframes ever changes — which is how the theme broadcast reaches newly rendered iframes.

### URL sanitisation — why it's required

Angular's security model treats dynamic URLs as potentially dangerous (open redirect, XSS via `javascript:` scheme, etc.). When you bind `[src]` on an iframe to a runtime value, Angular will block it unless you explicitly mark the URL as safe:

```typescript
readonly apps: MfeApp[] = [
  { label: 'Loan Pipeline', path: 'orders',   port: 4201 },
  { label: 'Rate Sheet',    path: 'products', port: 4202 },
].map(a => ({
  ...a,
  url: this.sanitizer.bypassSecurityTrustResourceUrl(`http://localhost:${a.port}`),
}));
```

`bypassSecurityTrustResourceUrl` is the correct API for iframe `src` values. In production, these would be real domains (e.g. `https://loans.mortgageco.com`) validated server-side — not user-controlled input. The method name is deliberately verbose to make it visible in code reviews.

### Navigation — one signal, zero routing

```typescript
readonly activeApp = signal('orders');
navigate(path: string): void { this.activeApp.set(path); }
```

There is no Angular Router involvement in the shell's MFE switching. The active MFE is just a string signal. When it changes, Angular re-evaluates every binding that reads `activeApp()` — specifically the `[style.display]` bindings on each iframe. This is cheaper than routing and keeps the iframes in the DOM as explained above.

---

## Step 3 — Shell Layout: Header + Sidebar + Main

### The shell's responsibility

The **shell** (sometimes called the app shell or container application) is responsible for:
1. The chrome that wraps all MFEs — header, navigation, global notifications.
2. Ownership of cross-cutting state — active theme, authenticated user identity, platform-wide alerts.
3. Message brokering — relaying events between MFEs that cannot communicate directly.

The shell deliberately contains *no business logic*. It knows that MFEs exist and how to frame them, but it does not know what a loan is or what a rate lock means.

### Three-region CSS layout

The layout uses three fixed regions. `position: fixed` with `inset` (shorthand for `top/right/bottom/left`) is the most reliable way to build a full-viewport shell because it takes elements out of the document flow entirely, eliminating scrollbar and height calculation issues.

```css
/* shell-app/src/styles.css */

/* Header — spans the full width at the top */
.shell-header {
  position: sticky;
  top: 0;
  height: 56px;
  z-index: 100;     /* must be above sidebar (90) and iframes */
}

/* Sidebar — fixed panel below the header, left edge */
.shell-sidebar {
  position: fixed;
  inset: 56px auto 0 0;   /* top=56px (header height), left=0, fills to bottom */
  width: 220px;
  z-index: 90;
}

/* Main — occupies all remaining space */
.shell-main {
  position: fixed;
  inset: 56px 0 0 220px;  /* pushed right by sidebar width */
}

/* Each iframe fills the main region completely */
.mfe-frame {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  border: none;
}
```

The `z-index` hierarchy (`header: 100 > sidebar: 90 > iframes: auto`) ensures dropdowns or sticky elements inside an MFE don't bleed over the shell chrome.

### Why the nav lives in the sidebar (not the header)

Moving navigation from the header to a sidebar increases the vertical content area for each MFE — important for data-heavy screens like loan tables. It also follows established enterprise application conventions (think Salesforce, Workday, Azure Portal) where primary navigation is a persistent left rail and the header holds global controls.

The nav buttons use a left-border indicator instead of background highlights:

```css
.nav-btn {
  border-left: 3px solid transparent;  /* invisible by default */
  background: transparent;
  text-align: left;
}

.nav-btn.active {
  border-left-color: var(--ds-color-primary);   /* filled when active */
  background: rgba(0,73,119,.08);               /* subtle tint */
}
```

This is a deliberately subtle treatment. A full background colour on the active item would compete with the MFE content. The 3 px left border communicates selection without visual noise.

---

## Step 4 — Shared Design System

### Why web components, not Angular components?

The design system (`ds-card`, `ds-button`) needs to work inside every MFE iframe. Each iframe is a separate Angular application — or could be a React or Vue app. Sharing Angular components would require all MFEs to use the same Angular version and the same module system. That defeats the independence goal.

**Web components** are a browser-native standard. Once defined with `customElements.define()`, they work in any HTML context — vanilla JS, Angular, React, inside iframes — with no framework dependency.

```javascript
// shared-ds/ds-card.js
class DsCard extends HTMLElement {
  connectedCallback() {
    // Shadow DOM prevents internal styles from leaking out,
    // and prevents external styles from leaking in.
    this.attachShadow({ mode: 'open' });
    this.shadowRoot.innerHTML = `
      <style>
        .card {
          background: var(--ds-color-surface, #fff);
          border-radius: var(--ds-radius, 6px);
          box-shadow: var(--ds-shadow-sm);
        }
      </style>
      <div class="card">
        <div class="header"><slot name="header"></slot></div>
        <div class="body"><slot></slot></div>
      </div>`;
  }
}
customElements.define('ds-card', DsCard);
```

### Shadow DOM and CSS custom properties — how theming still works

Shadow DOM creates a style boundary — external CSS selectors cannot reach inside the component's shadow root, and the component's internal styles don't leak outward. This is powerful for encapsulation, but it seems to conflict with theming: if the shell changes the theme, how does `ds-card` know to update its colours?

The answer is **CSS custom properties (variables) cross the shadow DOM boundary**. Custom properties are inherited by default, including into shadow roots. So when the shell writes:

```javascript
document.documentElement.setAttribute('data-theme', 'dark');
```

And the global stylesheet changes the token values:

```css
[data-theme="dark"] {
  --ds-color-surface:  #152231;
  --ds-color-border:   #1e3347;
}
```

The web component's shadow DOM reads `var(--ds-color-surface)` and automatically sees `#152231` — no JavaScript in the web component needs to change. The entire theme propagates through a single attribute on the `<html>` element.

### Why CSS tokens instead of utility classes?

Utility class systems (like Tailwind) work by applying many small classes to elements. This is fine within a single app, but across an iframe boundary you cannot apply classes from one app's stylesheet to another app's elements.

CSS custom properties solve this differently: they define a shared *vocabulary of values* that any stylesheet in any iframe can read. As long as every MFE includes the tokens, they all speak the same visual language without sharing a stylesheet.

```css
/* shared-ds/tokens.css — included by every app */
:root {
  --ds-color-primary:  #004977;
  --ds-space-4:        1rem;
  --ds-radius:         6px;
  /* … */
}
```

Any component, anywhere, that uses `var(--ds-color-primary)` will automatically match the brand colour and respond to theme changes.

---

## Step 5 — MFE Bus (Cross-MFE Communication via postMessage)

### The isolation problem

Because each MFE runs in its own iframe, they cannot share JavaScript module instances. If the Rate Sheet MFE imports an `EventEmitter`, and the Loan Pipeline MFE imports the same `EventEmitter`, they get *different objects* — in different memory spaces, in different `window` contexts. A `dispatchEvent` in one will never be heard in the other.

The browser's built-in mechanism for cross-origin, cross-window communication is `postMessage`. It works across iframe boundaries, uses structured cloning to serialise data, and is part of the browser spec — no library required.

### The broker pattern

MFEs could communicate directly with `window.parent.frames[x].postMessage(...)`, but this requires each MFE to know about every other MFE. Add a third MFE and every existing MFE needs updating.

Instead, this project uses a **broker pattern**: every MFE sends messages *up* to the shell (`window.parent`), and the shell *relays* them to all other iframes. MFEs don't know each other exist — they only know about the shell.

```
MFE-A (Rate Sheet)
  └── postMessage ──► Shell (broker)
                         ├── postMessage ──► MFE-B (Loan Pipeline)
                         └── postMessage ──► [any future MFE]
```

This is the same pattern as a message bus or event hub in backend architecture. Adding a new MFE requires zero changes to existing MFEs.

### The MfeBus abstraction — `shared-ds/mfe-bus.js`

The raw `postMessage` API is verbose and error-prone. `MfeBus` wraps it with a typed pub/sub interface that any MFE can call without knowing it's sending a `postMessage`:

```javascript
(() => {
  const handlers = new Map(); // eventType → Set<Function>

  // Listen for events relayed back from the shell
  window.addEventListener('message', (e) => {
    if (!e.data || e.data.__mfeBus !== true) return;  // ignore unrelated messages
    const { type, payload } = e.data;
    handlers.get(type)?.forEach(h => h(payload));
  });

  window.MfeBus = {
    emit(type, payload) {
      const envelope = { __mfeBus: true, type, payload };
      // Send upward to the shell for relay to other MFEs
      if (window !== window.parent) {
        window.parent.postMessage(envelope, '*');
      }
      // Also fire locally — the emitting MFE can listen to its own events
      handlers.get(type)?.forEach(h => h(payload));
    },

    on(type, handler) {
      if (!handlers.has(type)) handlers.set(type, new Set());
      handlers.get(type).add(handler);
      return () => handlers.get(type).delete(handler);   // returns unsubscribe fn
    },
  };
})();
```

**The `__mfeBus: true` flag** is important. The shell's `window` receives *all* `postMessage` events from all sources — analytics scripts, browser extensions, third-party SDKs, the browser itself. The flag is a namespace that lets the shell ignore irrelevant messages without false positives.

**The IIFE pattern** (`(() => { … })()`) creates a private scope. `handlers` is not accessible from outside — only the `window.MfeBus` interface is exposed. This prevents any MFE from accidentally modifying the handler registry.

### Shell broker implementation

```typescript
// shell-app/src/app/app.component.ts
private relay(e: MessageEvent): void {
  const env = e.data as Partial<BusEnvelope>;
  if (env?.__mfeBus !== true) return;   // not an MFE bus message — ignore

  // Special case: MFE is asking for current theme — respond directly
  if (env.type === 'theme:request-state') {
    (e.source as Window).postMessage({
      __mfeBus: true,
      type:    'theme:changed',
      payload: { theme: this.themeService.theme() },
    }, '*');
    return;   // do NOT relay — only the requesting MFE needs this
  }

  // General relay: forward to every iframe except the one that sent this
  for (const ref of this.iframes()) {
    const win = ref.nativeElement.contentWindow;
    if (win && win !== e.source) win.postMessage(e.data, '*');
  }

  // Shell-level side effect: show a toast when a rate is locked
  if (env.type === 'mfe:rate-locked') {
    const { productName, rate } = env.payload as { productName: string; rate: number };
    this.showToast(`Rate Locked: ${rate.toFixed(3)}% — ${productName}`);
  }
}
```

Notice the `e.source !== win` guard. Without it, the emitting MFE would receive its own event back, triggering duplicate handler calls. The shell skips the sender when relaying.

### End-to-end: Rate Lock event flow

This is the complete journey of a `mfe:rate-locked` event:

```
1. User clicks "Lock Rate" on a product in Rate Sheet (mfe-products :4202)

2. products.component.ts calls:
   MfeBus.emit('mfe:rate-locked', { productName, rate, loanType, term, apr })

3. mfe-bus.js sends:
   window.parent.postMessage({ __mfeBus: true, type: 'mfe:rate-locked', payload: {...} }, '*')

4. Shell's window.addEventListener('message') fires in relay()
   → Forwards the message to every iframe except mfe-products (the sender)
   → Shows a toast: "Rate Locked: 6.875% — 30-Year Fixed"

5. mfe-bus.js in mfe-orders :4201 receives the relayed message
   → Fires all handlers registered for 'mfe:rate-locked'

6. orders.component.ts handler runs:
   this.rateSuggestions.update(prev => [{ key: Date.now(), ...p }, ...prev].slice(0, 5))
   → Signal update triggers re-render → suggestion panel appears in Loan Pipeline
```

Two completely independent Angular apps, running in separate browser contexts, exchanged a strongly-typed message in under a millisecond.

---

## Step 6 — Light / Dark Theming

### Why the shell owns the theme

Theme state must be a **single source of truth**. If each MFE managed its own theme independently, they could get out of sync — the user toggles dark mode and the shell updates, but an MFE that missed the event stays light. The user sees a mix of themes.

The shell owns the theme signal. MFEs are theme *consumers*, not owners. They receive the current theme and apply it; they never decide it.

### Shell ThemeService — `shell-app/src/app/theme.service.ts`

```typescript
@Injectable({ providedIn: 'root' })
export class ThemeService {
  // Signal initialised with the persisted or system preference at construction time.
  // This means the correct theme is set before any component renders —
  // no flash of the wrong theme on refresh.
  readonly theme = signal<Theme>(this.resolve());

  toggle(): void {
    this.theme.update(t => (t === 'light' ? 'dark' : 'light'));
  }

  private resolve(): Theme {
    // localStorage takes priority — respects the user's explicit choice
    const stored = localStorage.getItem('fnm-theme') as Theme | null;
    if (stored === 'light' || stored === 'dark') return stored;
    // Fall back to the OS/browser preference
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches
      ? 'dark' : 'light';
  }
}
```

Reading `localStorage` synchronously at signal creation time (before any rendering) is intentional. If we waited until an `effect()` or `ngOnInit`, there would be one render cycle with the wrong theme — visible as a flash.

### Applying theme and broadcasting with `effect()`

```typescript
// shell-app/src/app/app.component.ts
effect(() => {
  const t = this.themeService.theme();                          // read signal
  document.documentElement.setAttribute('data-theme', t);      // apply to shell HTML
  localStorage.setItem('fnm-theme', t);                        // persist
  this.broadcastToAll('theme:changed', { theme: t });          // tell all MFEs
});
```

Angular's `effect()` re-runs whenever any signal it *reads* changes. This effect reads `this.themeService.theme()` and `this.iframes()` (via `broadcastToAll`). So it re-runs when:
- The user clicks the theme toggle → `theme()` changes → shell and all MFEs update.
- A new iframe is rendered → `iframes()` changes → the new MFE immediately receives the current theme.

That second case solves a subtle race condition. When the app first loads, iframes are created by Angular's rendering. The theme `effect()` may run *before* the iframes finish initialising. Because the effect depends on `iframes()` and will re-run when it changes, the theme broadcast happens reliably even if the iframes aren't ready on the first run.

### MFE ThemeService — listening for broadcasts

Each MFE has its own `ThemeService`. It cannot share the shell's service instance because they run in different JS runtimes. Instead it listens for the `theme:changed` postMessage:

```typescript
// mfe-orders/src/app/theme.service.ts
constructor() {
  window.addEventListener('message', (e: MessageEvent) => {
    if (e.data?.__mfeBus !== true) return;
    if (e.data.type !== 'theme:changed') return;
    const t = (e.data.payload as { theme: Theme }).theme;
    this.theme.set(t);
    document.documentElement.setAttribute('data-theme', t);
  });

  // Defensive: on boot, ask the shell for the current theme immediately.
  // If the shell already broadcast before this MFE loaded, we'd never know.
  if (window !== window.parent) {
    window.parent.postMessage(
      { __mfeBus: true, type: 'theme:request-state', payload: null }, '*'
    );
  }
}
```

The `theme:request-state` message is the MFE saying "I just loaded, please tell me the current theme." The shell responds directly to the requesting iframe (not a broadcast), and the MFE applies the theme immediately. Combined with the `effect()` that re-broadcasts on new iframes, this gives two independent paths to the correct theme — belt and suspenders.

---

## Step 7 — Per-MFE WebSocket (Loan Pipeline & Rate Sheet)

### Why each MFE owns its own WebSocket

One of the core promises of microfrontends is **team autonomy** — each team controls their MFE end to end, including what backend services it consumes and how. If the shell owned all WebSocket connections, every new real-time event type would require a change to the shell codebase, creating a bottleneck.

By giving each MFE its own WebSocket:
- The Loan Pipeline team decides which events it cares about (`/ws/loans`) independently of the Rate Sheet team.
- Adding a new MFE with new real-time needs doesn't require touching the shell.
- Each MFE's WebSocket lifecycle is tied to that MFE's lifecycle — not the shell's.

### The reconnect problem

WebSockets are long-lived connections. In production they break regularly — network hiccups, server restarts, load balancer timeouts. A WebSocket that silently dies without reconnecting means the user stops receiving updates with no visible feedback.

The service uses an `intentionalClose` flag to distinguish a deliberate disconnect (user navigated away → `ngOnDestroy`) from an unexpected one (network drop → should reconnect):

```typescript
// mfe-orders/src/app/orders-ws.service.ts
@Injectable({ providedIn: 'root' })
export class OrdersWsService {
  private ws: WebSocket | null = null;
  private intentionalClose = false;

  connect(): void {
    this.intentionalClose = false;
    this.ws = new WebSocket('ws://localhost:3001/ws/loans');

    this.ws.onclose = () => {
      // Only reconnect if the close was NOT triggered by our own disconnect() call
      if (!this.intentionalClose) this.scheduleReconnect();
    };

    // onerror always fires immediately before onclose.
    // We handle reconnect in onclose to avoid scheduling two reconnects.
    this.ws.onerror = () => {};
  }

  disconnect(): void {
    this.intentionalClose = true;    // set BEFORE calling close()
    this.ws?.close();
  }

  private scheduleReconnect(): void {
    setTimeout(() => this.connect(), 3000);   // retry after 3 seconds
  }
}
```

`onerror` and `onclose` always fire together on a failed connection — `onerror` first, then `onclose`. If we tried to reconnect in both, we'd schedule two reconnect attempts. By only reconnecting in `onclose`, we handle both error and non-error closes in one place.

### Streaming events into Angular signals via RxJS

The WebSocket API is callback-based, but Angular 21 works best with signals and reactive primitives. The bridge between them is RxJS `Subject`:

```typescript
private readonly subject = new Subject<LoanNotification>();
readonly events$: Observable<LoanNotification> = this.subject.asObservable();
```

`Subject` is both an `Observer` (you can call `.next()` on it to push values) and an `Observable` (you can subscribe to it). The `asObservable()` call returns a read-only view — consumers can subscribe but cannot push values.

In the component, the Observable is subscribed and its values are written into a signal:

```typescript
// mfe-orders/src/app/orders.component.ts
ngOnInit(): void {
  this.ordersWsService.connect();
  this.wsSubscription = this.ordersWsService.events$.subscribe(n => {
    // Prepend newest event; keep at most 5 in the list
    this.notifications.update(prev => [n, ...prev].slice(0, 5));
  });
}
```

Writing to a signal inside an RxJS subscription works in zoneless Angular because signals directly schedule change detection — no zone tick needed.

### Colour-coded notification types

The notification type string (e.g. `'loan_submitted'`) is used directly as a CSS class suffix in the template:

```html
<div class="notif-item notif-item--{{ n.type }}">
```

This generates class names like `notif-item--loan_submitted`, `notif-item--status_changed`, `notif-item--document_required`. Each gets a distinct left-border colour in the stylesheet:

```css
/* mfe-orders/src/styles.css */
.notif-item--loan_submitted    { border-left-color: var(--ds-color-success); } /* green  — new business */
.notif-item--status_changed    { border-left-color: var(--ds-color-primary); } /* blue   — informational */
.notif-item--document_required { border-left-color: var(--ds-color-warning); } /* amber  — action required */
```

The pattern is the same for Rate Sheet:

```css
/* mfe-products/src/styles.css */
.notif-item--rate_updated  { border-left-color: var(--ds-color-primary); } /* blue   — info */
.notif-item--rate_expired  { border-left-color: var(--ds-color-danger);  } /* red    — urgent */
.notif-item--market_alert  { border-left-color: var(--ds-color-warning); } /* amber  — watch */
```

The colour semantics follow standard information design: green = good/new, blue = informational, amber = attention needed, red = urgent action required. Users learn the visual language implicitly.

---

## Step 8 — Shell WebSocket & Platform Relay

### Why some events belong to the shell, not an MFE

The per-MFE WebSockets handle events that are scoped to a specific feature. But some events are **platform-wide** — they should appear in every MFE regardless of which one is active:

- A new rate sheet is published → relevant to both the Rate Sheet MFE and the Loan Pipeline MFE (which shows rates on loans).
- A compliance notice → relevant to every user in every context.
- A market update → could affect decisions in any MFE.

If these were handled per-MFE, every MFE would need its own connection to `/ws/platform`, and you'd have duplicate connection management code and duplicate UI. The shell handles this once and fans out.

### PlatformWsService — `shell-app/src/app/platform-ws.service.ts`

```typescript
@Injectable({ providedIn: 'root' })
export class PlatformWsService {
  // Direct references to iframe DOM elements, populated after view init
  private iframes: HTMLIFrameElement[] = [];

  // BehaviorSubject holds the unread count; exposed as Observable to consumers
  private readonly countSubject = new BehaviorSubject<number>(0);
  readonly notificationCount$: Observable<number> = this.countSubject.asObservable();

  registerIframe(iframe: HTMLIFrameElement): void {
    if (!this.iframes.includes(iframe)) this.iframes.push(iframe);
  }

  private relay(msg: PlatformNotification): void {
    // Increment the unread badge counter
    this.countSubject.next(this.countSubject.getValue() + 1);

    for (const iframe of this.iframes) {
      // IMPORTANT: In production, replace '*' with the specific MFE origin
      // (e.g. 'https://loans.mortgageco.com') to prevent the message being
      // received by a malicious page loaded in the iframe.
      iframe.contentWindow?.postMessage(
        { type: 'PLATFORM_NOTIFICATION', payload: msg },
        '*'
      );
    }
  }
}
```

`BehaviorSubject` is used instead of a plain `Subject` because it holds the *current value* and emits it immediately to any new subscriber. This means if the component subscribes after some notifications arrive, it still gets the current count right away.

### Why `registerIframe()` instead of reusing the `viewChildren` signal

The shell component holds the `viewChildren` signal. The `PlatformWsService` is a separate service that doesn't have access to view queries. Rather than making the service depend on the component (which would invert the normal dependency direction), the component explicitly registers its iframes with the service after the view initialises:

```typescript
// shell-app/src/app/app.component.ts
ngAfterViewInit(): void {
  // Push all iframe elements into the service so it can relay to them
  for (const ref of this.iframes()) {
    this.platformWsService.registerIframe(ref.nativeElement);
  }
  this.platformWsService.connect();   // connect AFTER registering, so first message has targets
}
```

`ngAfterViewInit` is the correct lifecycle hook here because `viewChildren` queries are not available until after the view is fully rendered. Calling `this.iframes()` in the constructor would return an empty array.

### Converting an Observable to a signal with `toSignal`

The `PlatformWsService` exposes `notificationCount$` as an `Observable<number>`. Angular templates can't call `.subscribe()` directly — they need either the `async` pipe or a signal. `toSignal` from `@angular/core/rxjs-interop` is the idiomatic Angular 21 bridge:

```typescript
// shell-app/src/app/app.component.ts
readonly notificationCount = toSignal(
  this.platformWsService.notificationCount$,
  { initialValue: 0 }   // value before the Observable emits
);
```

`toSignal` subscribes to the Observable and writes each emitted value into a signal. It automatically unsubscribes when the component is destroyed, so there is no manual teardown needed.

```html
<!-- shell-app/src/app/app.component.html -->
<button class="bell-btn" (click)="platformWsService.resetCount()">
  🔔
  @if (notificationCount() > 0) {
    <span class="bell-badge">{{ notificationCount() }}</span>
  }
</button>
```

Clicking the bell calls `resetCount()` which sets the `BehaviorSubject` to `0` — the signal updates immediately and the badge disappears.

### MFEs validate the origin before trusting messages

When an MFE receives a `window.message` event, it cannot blindly trust it — any page could be sending postMessages. The first check is always the **origin** of the sender:

```typescript
// mfe-orders/src/app/orders.component.ts
private onPlatformMessage(e: MessageEvent): void {
  // Reject any message not originating from the shell.
  // In production this would be 'https://loans.mortgageco.com' — the shell's domain.
  if (e.origin !== 'http://localhost:4200') return;

  // Reject messages that aren't platform notifications
  if (e.data?.type !== 'PLATFORM_NOTIFICATION') return;

  const n = e.data.payload as PlatformNotification;
  this.platformNotifications.update(prev => [n, ...prev].slice(0, 3));
}
```

`e.origin` is set by the browser from the sender's URL — it cannot be spoofed by JavaScript. Checking it ensures that even if a malicious script somehow got access to the iframe's `postMessage` target, the MFE would reject its messages.

---

## Step 9 — Mock WebSocket Server

### Why a dedicated server, not a mock library

The goal of this PoC is to test the full integration: Angular service → WebSocket connection → server → message → UI update. Using a mock library (like `jest-websocket-mock`) would only test the Angular layer. A real server proves that:
- The WebSocket URL is correct.
- JSON serialisation/deserialisation matches the TypeScript interfaces.
- The reconnect logic works when the server restarts.
- The browser Network tab shows actual WebSocket frames (verifiable by any developer).

### Three paths on one port

Rather than running three servers, one Node.js process handles all three paths. The `ws` package exposes the request URL at connection time:

```javascript
wss.on('connection', (ws, req) => {
  const path = req.url;  // '/ws/loans', '/ws/rates', or '/ws/platform'

  if (!clients[path]) {
    ws.close(4000, 'Unknown path');  // reject unknown paths
    return;
  }

  clients[path].add(ws);
  ws.send(JSON.stringify(buildWelcome(path)));  // immediate initial message

  ws.on('close', () => clients[path].delete(ws));
});
```

Each path has its own `Set` of connected clients. Broadcasting to one path doesn't affect the others.

### Domain-specific messages

Every message is grounded in real mortgage operations vocabulary. This matters even in a PoC — it demonstrates to stakeholders exactly what the system will communicate in production, and it tests that the UI handles the real message shapes correctly:

```javascript
const loanTemplates = [
  { type: 'loan_submitted',    loanId: 'LN-2024-009',
    message: 'New application LN-2024-009 received — David Warner, $425,000 Conventional 30-yr' },
  { type: 'status_changed',    loanId: 'LN-2024-002',
    message: 'LN-2024-002 advanced to Underwriting — James Rodriguez, FHA $320,000' },
  { type: 'document_required', loanId: 'LN-2024-004',
    message: 'LN-2024-004 stalled: updated appraisal required — Michael Torres, VA $275,000' },
];

const platformTemplates = [
  { type: 'rate_sheet_published', title: 'Rate Sheet Updated',
    message: 'New rate sheet published for today — all new locks must reference this sheet' },
  { type: 'market_update', title: 'Market Update',
    message: 'FOMC minutes: committee signals two cuts by year-end; MBS spreads tightening' },
  { type: 'compliance_notice', title: 'Compliance Notice',
    message: 'CFPB: updated TRID CD timing requirements take effect next quarter' },
];
```

### Starting the server

```bash
cd ws-server
npm install    # installs the 'ws' package — single dependency
npm start      # node server.js — no build step required
```

```
ws-server listening on :3001
  /ws/loans    — loan pipeline events      (4 s interval)
  /ws/rates    — rate sheet events          (4 s interval)
  /ws/platform — platform-wide alerts       (6 s interval)
```

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│  Browser                                                            │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  Shell :4200                                                │   │
│  │  ┌───────────────────────────────────────────────────────┐  │   │
│  │  │  Header:  [MortgageCo logo]  [🔔 badge]  [Dark/Light] │  │   │
│  │  └───────────────────────────────────────────────────────┘  │   │
│  │  ┌─────────────┐  ┌────────────────────────────────────┐    │   │
│  │  │  Sidebar    │  │  iframe :4201  Loan Pipeline       │    │   │
│  │  │  Loan       │  │  ┌──────────────────────────────┐  │    │   │
│  │  │  Pipeline   │  │  │  OrdersComponent             │  │    │   │
│  │  │  ──────     │  │  │  OrdersWsService ──/ws/loans │  │    │   │
│  │  │  Rate Sheet │  └──│──────────────────────────────┘  │    │   │
│  │  └─────────────┘  ┌──┤  iframe :4202  Rate Sheet       │    │   │
│  │                   │  │  ┌──────────────────────────┐   │    │   │
│  │                   │  │  │  ProductsComponent       │   │    │   │
│  │                   │  │  │  ProductsWsService ─/ws/ │   │    │   │
│  │                   └──│──│  rates                   │   │    │   │
│  │                      │  └──────────────────────────┘   │    │   │
│  │  Services:           └────────────────────────────────┘    │   │
│  │  ThemeService (signal)                                      │   │
│  │  PlatformWsService ──────────────────────── /ws/platform    │   │
│  └─────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
         │ WebSocket connections
         ▼
  ws-server :3001
  /ws/loans    → LoanNotification    (every 4 s)
  /ws/rates    → RateNotification    (every 4 s)
  /ws/platform → PlatformNotification (every 6 s)
```

### Communication patterns at a glance

| Pattern | Who sends | Who receives | Mechanism | Example |
|---|---|---|---|---|
| MFE → MFE | Rate Sheet | Loan Pipeline | MfeBus / postMessage via shell broker | Rate lock suggestion |
| Shell → all MFEs | Shell | Both MFEs | postMessage broadcast | Theme change |
| MFE → Shell (request) | Any MFE | Shell | postMessage direct | `theme:request-state` on boot |
| Server → MFE (direct) | ws-server | Individual MFE | WebSocket | Loan status update |
| Server → Shell → all MFEs | ws-server | Shell, then both MFEs | WebSocket + postMessage relay | Platform compliance notice |

### Key design principles applied

| Principle | How it appears in the code |
|---|---|
| **Single source of truth** | Theme signal lives only in the shell; MFEs receive it, never own it |
| **Explicit contracts** | TypeScript interfaces (`LoanNotification`, `PlatformNotification`) define every message shape |
| **Defensive receiving** | Every `postMessage` listener checks `e.origin` before trusting the payload |
| **Lifecycle discipline** | Every `addEventListener` has a matching `removeEventListener`; every WS `connect()` has a `disconnect()` |
| **Team autonomy** | Each MFE's WebSocket, service, and notification UI are entirely self-contained |
| **Browser standards first** | `postMessage`, CSS custom properties, Web Components — no proprietary transport layer |
