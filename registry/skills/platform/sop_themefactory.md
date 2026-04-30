---
name: sop_themefactory
description: Toolkit for styling artifacts with professional themes. Apply curated color palettes and font pairings to slides, docs, reports, HTML pages, and more. 10 pre-set themes or generate custom themes.
---

# Theme Factory

Apply consistent, professional styling to presentation slide decks and other artifacts with curated themes.

## Usage Instructions

1. **Show theme showcase**: Display `theme-showcase.pdf` for visual reference
2. **Ask for choice**: Let user select a theme
3. **Wait for selection**: Get explicit confirmation
4. **Apply theme**: Apply selected colors and fonts

## Available Themes

### 1. Ocean Depths
Professional, calming maritime theme
- Deep blues and teals
- Clean, corporate feel

### 2. Sunset Boulevard
Warm and vibrant sunset colors
- Oranges, pinks, purples
- Energetic, creative mood

### 3. Forest Canopy
Natural and grounded earth tones
- Greens and browns
- Organic, sustainable feel

### 4. Modern Minimalist
Clean and contemporary grayscale
- Black, white, grays
- Professional, sleek

### 5. Golden Hour
Rich and warm autumnal palette
- Golds, ambers, deep reds
- Luxurious, sophisticated

### 6. Arctic Frost
Cool and crisp winter-inspired
- Icy blues and whites
- Fresh, clean aesthetic

### 7. Desert Rose
Soft and sophisticated dusty tones
- Muted pinks, tans, terracotta
- Elegant, refined

### 8. Tech Innovation
Bold and modern tech aesthetic
- Electric blues, neon accents
- Cutting-edge, dynamic

### 9. Botanical Garden
Fresh and organic garden colors
- Leafy greens, floral accents
- Natural, lively

### 10. Midnight Galaxy
Dramatic and cosmic deep tones
- Deep purples, blues, starlight accents
- Bold, mysterious

## Theme Structure

Each theme includes:
- **Color palette**: Cohesive hex codes
- **Font pairings**: Header and body fonts
- **Visual identity**: Specific character/mood

## Application Process

After theme selection:
1. Read theme file from `themes/` directory
2. Apply colors consistently throughout
3. Apply font pairings to headers and body
4. Ensure proper contrast and readability
5. Maintain visual identity across all elements

## Custom Themes

When no existing theme fits:

1. Gather requirements (brand colors, mood, industry)
2. Generate custom palette with 4-6 colors
3. Select complementary font pairing
4. Name theme descriptively
5. Show for review before applying

### Custom Theme Template

```yaml
name: "Theme Name"
description: "What the theme represents"

colors:
  primary: "#XXXXXX"
  secondary: "#XXXXXX"
  accent: "#XXXXXX"
  background: "#XXXXXX"
  text: "#XXXXXX"

fonts:
  heading: "Font Name"
  body: "Font Name"

mood: "Professional | Creative | Playful | Elegant | Bold"
```

## Quick Reference

| Theme | Mood | Best For |
|-------|------|----------|
| Ocean Depths | Professional | Corporate, finance |
| Sunset Boulevard | Energetic | Creative, marketing |
| Forest Canopy | Natural | Sustainability, wellness |
| Modern Minimalist | Sleek | Tech, startups |
| Golden Hour | Luxurious | Premium brands |
| Arctic Frost | Fresh | Healthcare, clean tech |
| Desert Rose | Elegant | Fashion, lifestyle |
| Tech Innovation | Dynamic | Technology, innovation |
| Botanical Garden | Lively | Food, nature, organic |
| Midnight Galaxy | Bold | Entertainment, gaming |
