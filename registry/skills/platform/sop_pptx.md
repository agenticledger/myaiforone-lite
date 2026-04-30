---
name: sop_pptx
description: PowerPoint creation, editing, and analysis toolkit. Use for creating presentations, modifying existing slides, extracting content, and working with templates.
---

# PPTX Processing Guide

## Reading and Analyzing Content

### Text Extraction
```bash
python -m markitdown presentation.pptx
```

### Raw XML Access
For comments, speaker notes, layouts, animations:

```bash
python ooxml/scripts/unpack.py presentation.pptx output_dir/
```

Key file structures:
- `ppt/presentation.xml` - Main metadata
- `ppt/slides/slide{N}.xml` - Individual slides
- `ppt/notesSlides/notesSlide{N}.xml` - Speaker notes
- `ppt/slideMasters/` - Master templates
- `ppt/theme/` - Theme and styling

## Creating Presentations (html2pptx)

### Design Principles

**CRITICAL**: Before creating, analyze content and choose appropriate design:
1. Consider subject matter - tone, industry, mood
2. Check for branding requirements
3. Match palette to content
4. State your approach before writing code

**Requirements**:
- Use web-safe fonts only: Arial, Helvetica, Times New Roman, Georgia, Courier New, Verdana, Tahoma, Trebuchet MS, Impact
- Create clear visual hierarchy
- Ensure readability with strong contrast
- Be consistent across slides

### Color Palette Examples

1. **Classic Blue**: Navy #1C2833, Slate #2E4053, Silver #AAB7B8
2. **Teal & Coral**: Teal #5EA8A7, Coral #FE4447
3. **Warm Blush**: Mauve #A49393, Blush #EED6D3, Rose #E8B4B8
4. **Black & Gold**: Gold #BF9A4A, Black #000000
5. **Forest Green**: Green #4E9F3D, Dark Green #1E5128

### Workflow

1. Read `html2pptx.md` completely
2. Create HTML file for each slide (720pt x 405pt for 16:9)
3. Run JavaScript with html2pptx.js library
4. Validate with thumbnails:
   ```bash
   python scripts/thumbnail.py output.pptx workspace/thumbnails --cols 4
   ```

## Editing Existing Presentations (OOXML)

### Workflow

1. Read `ooxml.md` completely
2. Unpack: `python ooxml/scripts/unpack.py presentation.pptx output_dir/`
3. Edit XML files
4. Validate: `python ooxml/scripts/validate.py output_dir/ --original presentation.pptx`
5. Pack: `python ooxml/scripts/pack.py output_dir/ edited.pptx`

## Using Templates

### Workflow

1. **Extract and visualize**:
   ```bash
   python -m markitdown template.pptx > template-content.md
   python scripts/thumbnail.py template.pptx
   ```

2. **Create template inventory** - document all slides with indices

3. **Plan outline** - map content to template slides

4. **Rearrange slides**:
   ```bash
   python scripts/rearrange.py template.pptx working.pptx 0,34,34,50,52
   ```

5. **Extract text inventory**:
   ```bash
   python scripts/inventory.py working.pptx text-inventory.json
   ```

6. **Create replacement JSON** with new content

7. **Apply replacements**:
   ```bash
   python scripts/replace.py working.pptx replacement-text.json output.pptx
   ```

## Creating Thumbnails

```bash
python scripts/thumbnail.py presentation.pptx [output_prefix]
```

Options:
- `--cols 4` - Adjust columns (3-6)
- Custom prefix for output naming

## Converting to Images

```bash
# PPTX to PDF
soffice --headless --convert-to pdf presentation.pptx

# PDF to JPEG
pdftoppm -jpeg -r 150 presentation.pdf slide
```

## Quick Reference

| Task | Tool | Command |
|------|------|---------|
| Extract text | markitdown | `python -m markitdown file.pptx` |
| Create new | html2pptx | HTML -> JS -> PPTX |
| Edit existing | OOXML | Unpack, edit XML, repack |
| Use template | rearrange.py | Duplicate/reorder slides |
| Thumbnails | thumbnail.py | Visual grid of all slides |
| To images | LibreOffice | PPTX -> PDF -> JPEG |
