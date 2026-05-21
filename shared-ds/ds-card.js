/**
 * ds-card — framework-agnostic card container web component.
 *
 * Slots:
 *   header  (named)  — card title area; hidden when empty
 *   default          — card body content
 *
 * Usage:
 *   <ds-card>
 *     <span slot="header">Card Title</span>
 *     <p>Body content goes here.</p>
 *   </ds-card>
 *
 * Angular: add CUSTOM_ELEMENTS_SCHEMA to the host component's schemas array.
 * Load this file via a <script defer> tag in index.html.
 */
class DsCard extends HTMLElement {
  connectedCallback() {
    if (this.shadowRoot) return; // already initialised
    this.attachShadow({ mode: 'open' });
    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; }
        .card {
          background: var(--ds-color-surface, #fff);
          border-radius: var(--ds-radius, 6px);
          box-shadow: var(--ds-shadow-sm, 0 1px 4px rgba(0,0,0,.1));
          overflow: hidden;
        }
        .header {
          padding: var(--ds-space-4, 1rem) var(--ds-space-4, 1rem) 0;
          font-size: 0.9rem;
          font-weight: 700;
          color: var(--ds-color-primary, #004977);
        }
        .body {
          padding: var(--ds-space-4, 1rem);
        }
        /* Hide header wrapper when the named slot receives no nodes */
        .header:not(:has(slot[name="header"] > *)) {
          display: none;
        }
      </style>
      <div class="card">
        <div class="header"><slot name="header"></slot></div>
        <div class="body"><slot></slot></div>
      </div>`;
  }
}

customElements.define('ds-card', DsCard);
