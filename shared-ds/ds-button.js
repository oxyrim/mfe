/**
 * ds-button — framework-agnostic button web component.
 *
 * Attributes:
 *   variant   "primary" (default) | "secondary"
 *   disabled  boolean presence attribute
 *
 * Usage:
 *   <ds-button variant="primary" (click)="doSomething()">Label</ds-button>
 *
 * Angular: add CUSTOM_ELEMENTS_SCHEMA to the host component's schemas array.
 * Load this file via a <script defer> tag in index.html.
 */
class DsButton extends HTMLElement {
  static get observedAttributes() {
    return ['variant', 'disabled'];
  }

  connectedCallback() {
    this._render();
  }

  attributeChangedCallback() {
    if (this.shadowRoot) this._render();
  }

  _render() {
    if (!this.shadowRoot) this.attachShadow({ mode: 'open' });

    const variant  = this.getAttribute('variant') || 'primary';
    const disabled = this.hasAttribute('disabled');

    this.shadowRoot.innerHTML = `
      <style>
        :host { display: inline-block; }
        button {
          display: inline-flex;
          align-items: center;
          gap: 0.4rem;
          padding: 0.45rem 1.1rem;
          border: 2px solid transparent;
          border-radius: var(--ds-radius, 6px);
          font-family: var(--ds-font-family, 'Segoe UI', sans-serif);
          font-size: 0.875rem;
          font-weight: 600;
          cursor: pointer;
          transition: opacity 0.15s, background 0.15s;
          white-space: nowrap;
          line-height: 1.4;
        }
        button.primary {
          background: var(--ds-color-primary, #004977);
          color: #fff;
          border-color: var(--ds-color-primary, #004977);
        }
        button.primary:hover:not(:disabled) { opacity: 0.85; }
        button.secondary {
          background: transparent;
          color: var(--ds-color-primary, #004977);
          border-color: var(--ds-color-primary, #004977);
        }
        button.secondary:hover:not(:disabled) { background: rgba(0,73,119,.08); }
        button:disabled { opacity: 0.45; cursor: not-allowed; }
      </style>
      <button class="${variant}" ${disabled ? 'disabled' : ''}>
        <slot></slot>
      </button>`;

    // Stop click from escaping shadow boundary when disabled.
    // Composed click events from enabled buttons reach the host naturally.
    this.shadowRoot.querySelector('button').addEventListener('click', e => {
      if (this.hasAttribute('disabled')) e.stopPropagation();
    });
  }
}

customElements.define('ds-button', DsButton);
