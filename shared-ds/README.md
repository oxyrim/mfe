# Shared Design System

Framework-agnostic web components and CSS design tokens shared across all MFEs.

## Contents

| File | Purpose |
|------|---------|
| `tokens.css` | CSS custom properties — colors, spacing, typography, shape |
| `ds-button.js` | `<ds-button>` custom element — `variant` (primary \| secondary), `disabled` |
| `ds-card.js` | `<ds-card>` custom element — `slot="header"` (named) + default body slot |

## How each Angular MFE consumes these files

### 1 — Static-asset serving (configured in angular.json)

Each app's `angular.json` includes an assets entry that copies the entire `shared-ds`
folder into the dev-server root at `/shared-ds/`:

```json
{
  "glob": "**/*",
  "input": "../shared-ds",
  "output": "shared-ds"
}
```

### 2 — Design tokens

Tokens are already inlined into each app's `src/styles.css`.  
You can also import them at runtime:

```css
@import '/shared-ds/tokens.css';
```

### 3 — Load web components

In each app's `src/index.html`:

```html
<script src="shared-ds/ds-button.js" defer></script>
<script src="shared-ds/ds-card.js" defer></script>
```

The `defer` attribute guarantees the custom elements are registered before Angular
renders its first component tree.

### 4 — Use in Angular templates

Add `CUSTOM_ELEMENTS_SCHEMA` to suppress unknown-element compiler errors:

```typescript
import { Component, CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';

@Component({
  standalone: true,
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `
    <ds-button variant="primary" (click)="save()">Save</ds-button>
    <ds-card>
      <span slot="header">Title</span>
      Body content here.
    </ds-card>
  `,
})
export class MyComponent { save() {} }
```

## Customising tokens

Override any token at the application level in `styles.css`:

```css
:root {
  --ds-color-primary: #your-brand-color;
}
```
