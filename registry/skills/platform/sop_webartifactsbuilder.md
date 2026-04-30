---
name: sop_webartifactsbuilder
description: Suite of tools for creating elaborate, multi-component HTML artifacts using React, Tailwind CSS, and shadcn/ui. Use for complex artifacts requiring state management, routing, or shadcn/ui components.
---

# Web Artifacts Builder

Build powerful frontend artifacts with React 18 + TypeScript + Vite + Tailwind CSS + shadcn/ui.

## Quick Start

### Step 1: Initialize Project

```bash
bash scripts/init-artifact.sh <project-name>
cd <project-name>
```

This creates a fully configured project with:
- React + TypeScript (via Vite)
- Tailwind CSS 3.4.1 with shadcn/ui theming
- Path aliases (`@/`) configured
- 40+ shadcn/ui components pre-installed
- All Radix UI dependencies included
- Parcel configured for bundling

### Step 2: Develop Your Artifact

Edit the generated files to build your artifact.

### Step 3: Bundle to Single HTML File

```bash
bash scripts/bundle-artifact.sh
```

Creates `bundle.html` - a self-contained artifact with all JavaScript, CSS, and dependencies inlined.

### Step 4: Share Artifact

Share the bundled HTML file in conversation.

## Design Guidelines

**CRITICAL**: Avoid "AI slop" aesthetics:
- NO excessive centered layouts
- NO purple gradients
- NO uniform rounded corners
- NO Inter font everywhere

### Typography
Choose distinctive, characterful fonts. Pair a display font with a refined body font.

### Color & Theme
Commit to a cohesive palette using CSS variables. Dominant colors with sharp accents work better than timid, evenly-distributed palettes.

### Motion
Focus on high-impact moments:
- Staggered page-load reveals (animation-delay)
- Scroll-triggered interactions
- Surprising hover states

### Composition
- Asymmetry and overlap
- Diagonal flow
- Grid-breaking elements
- Generous negative space OR controlled density

### Backgrounds & Details
Create atmosphere:
- Gradient meshes
- Noise textures
- Geometric patterns
- Layered transparencies
- Dramatic shadows
- Decorative borders
- Grain overlays

## shadcn/ui Components

Reference: https://ui.shadcn.com/docs/components

All components are pre-installed. Import like:
```tsx
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
```

## Bundle Script Details

What `bundle-artifact.sh` does:
1. Installs bundling dependencies (parcel, html-inline)
2. Creates `.parcelrc` config with path alias support
3. Builds with Parcel (no source maps)
4. Inlines all assets into single HTML

**Requirements**: Your project must have an `index.html` in the root directory.
