---
name: sop_brandguidelines
description: Apply consistent Anthropic brand identity styling to artifacts including colors, typography, and visual elements. Use when creating branded materials or applying company styling.
---

# Brand Styling Guide

Apply consistent brand identity guidelines for visual styling of artifacts.

## Brand Elements

### Color Palette

| Name | Hex | Usage |
|------|-----|-------|
| Dark | #141413 | Primary text |
| Light | #faf9f5 | Backgrounds |
| Orange | #d97757 | Accent |
| Blue | #6a9bcc | Accent |
| Green | #788c5d | Accent |

### Typography

**Headings**: Poppins (with Arial fallback)
- Apply to headings 24pt and larger
- Clean, modern sans-serif

**Body Text**: Lora (with Georgia fallback)
- Apply to body copy
- Elegant serif for readability

### Implementation

The system automatically:
- Applies Poppins to headings (24pt+)
- Applies Lora to body text
- Selects colors based on background context
- Rotates accent colors for visual variety

### Font Fallbacks

If preferred fonts aren't available:
- Headings: Arial
- Body: Georgia

Pre-installation optimizes results, but fallbacks maintain consistency.

## Application Guidelines

### Text Hierarchy

```
H1: Poppins, 32pt, Dark (#141413)
H2: Poppins, 24pt, Dark (#141413)
Body: Lora, 14pt, Dark (#141413)
```

### Accent Usage

Rotate through accent colors for:
- Buttons and CTAs
- Highlights
- Decorative elements
- Data visualization

### Background Patterns

- Primary background: Light (#faf9f5)
- Cards/panels: White (#ffffff) on Light background
- Dark sections: Dark (#141413) with Light text

### Contrast Requirements

- Ensure sufficient contrast for accessibility
- Test text on colored backgrounds
- Use Dark text on Light backgrounds
- Use Light text on Dark backgrounds

## CSS Variables

```css
:root {
  --color-dark: #141413;
  --color-light: #faf9f5;
  --color-accent-orange: #d97757;
  --color-accent-blue: #6a9bcc;
  --color-accent-green: #788c5d;

  --font-heading: 'Poppins', Arial, sans-serif;
  --font-body: 'Lora', Georgia, serif;
}
```

## Quick Reference

| Element | Font | Size | Color |
|---------|------|------|-------|
| H1 | Poppins | 32pt | Dark |
| H2 | Poppins | 24pt | Dark |
| H3 | Poppins | 20pt | Dark |
| Body | Lora | 14pt | Dark |
| Caption | Lora | 12pt | Dark |
| Button | Poppins | 14pt | Light on accent |
