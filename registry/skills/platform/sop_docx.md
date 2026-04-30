---
name: sop_docx
description: Comprehensive Word document operations - content analysis, document creation, and editing. Use when working with .docx files including reading, creating, or modifying Word documents.
---

# DOCX Processing Guide

## Core Capabilities

1. **Content Analysis**: Extract text via pandoc or access raw XML for comments, formatting, and metadata
2. **Document Creation**: Build new .docx files using docx-js library
3. **Document Editing**: Modify existing files using Python-based Document library for OOXML manipulation

## Reading Documents

### Text Extraction (Simple)
```bash
# Convert to markdown - preserves structure and tracked changes
pandoc document.docx -o document.md
```

### Raw XML Access
For comments, formatting, metadata, and complex structures:

```bash
# Unpack document
python ooxml/scripts/unpack.py document.docx output_dir/
```

Key XML files:
- `word/document.xml` - Main content
- `word/comments.xml` - Comments
- `word/styles.xml` - Style definitions
- `word/settings.xml` - Document settings

## Creating Documents (docx-js)

Read the complete docx-js.md documentation before implementing.

```javascript
import { Document, Paragraph, TextRun, Packer } from "docx";

const doc = new Document({
  sections: [{
    properties: {},
    children: [
      new Paragraph({
        children: [
          new TextRun("Hello World"),
          new TextRun({
            text: "Bold text",
            bold: true,
          }),
        ],
      }),
    ],
  }],
});

// Save document
Packer.toBuffer(doc).then((buffer) => {
  fs.writeFileSync("output.docx", buffer);
});
```

## Editing Documents (Python)

### Workflow
1. Unpack: `python ooxml/scripts/unpack.py document.docx unpacked/`
2. Edit XML files via Document library API
3. Repack: `python ooxml/scripts/pack.py unpacked/ edited.docx`

## Tracked Changes (Redlining)

For legal, academic, business, or government documents:

### Principles
- Make minimal, precise edits
- Mark only changed text, not entire passages
- Group changes into batches of 3-10 related modifications
- Validate after each batch

### XML Structure for Changes
```xml
<!-- Insertion -->
<w:ins w:author="Author" w:date="2024-01-15T10:00:00Z">
  <w:r><w:t>New text</w:t></w:r>
</w:ins>

<!-- Deletion -->
<w:del w:author="Author" w:date="2024-01-15T10:00:00Z">
  <w:r><w:delText>Removed text</w:delText></w:r>
</w:del>
```

## Document Visualization

Convert to images for visual analysis:

```bash
# DOCX to PDF (LibreOffice)
soffice --headless --convert-to pdf document.docx

# PDF to JPEG
pdftoppm -jpeg -r 150 document.pdf page
```

## Quick Reference

| Task | Tool | Method |
|------|------|--------|
| Extract text | pandoc | `pandoc doc.docx -o doc.md` |
| Read XML | unpack.py | Access raw OOXML |
| Create new | docx-js | Document + Packer |
| Edit existing | Python OOXML | Unpack, modify, repack |
| Track changes | OOXML | `<w:ins>`, `<w:del>` elements |
| Visualize | LibreOffice + pdftoppm | Convert to images |
