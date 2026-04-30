---
name: sop_xlsx
description: Comprehensive spreadsheet creation, editing, and analysis for .xlsx, .xlsm, .csv, and .tsv formats. Use for Excel operations, formula construction, data formatting, and financial modeling.
---

# XLSX Processing Guide

## Key Requirements

**Zero Formula Errors**: All Excel deliverables must contain no errors (#REF!, #DIV/0!, #VALUE!, #N/A, #NAME?).

**Template Preservation**: When modifying existing files, match established formatting and conventions.

## Financial Model Standards

### Color Conventions
| Color | Usage |
|-------|-------|
| Blue text | Hardcoded inputs and scenario variables |
| Black text | All formulas and calculations |
| Green text | Cross-sheet worksheet links |
| Red text | External file references |
| Yellow background | Key assumptions requiring attention |

### Number Formatting
- Years: Text strings ("2024")
- Currency: `$#,##0` with unit headers
- Zeros: Display as "-"
- Percentages: `0.0%` format
- Multiples: `0.0x` format
- Negatives: Parentheses `(123)`

### Formula Rules
- Place assumptions in separate cells and reference them
- Never hardcode values in formulas
- Document hardcoded values with source citations

## Implementation

### Basic Operations with openpyxl

```python
from openpyxl import load_workbook, Workbook

# Load existing file (preserves formulas)
wb = load_workbook('input.xlsx')
ws = wb.active

# Read cell
value = ws['A1'].value

# Write cell
ws['B2'] = 'Hello'
ws['C3'] = 42
ws['D4'] = '=SUM(A1:A10)'

# Save
wb.save('output.xlsx')
```

### Create New Workbook

```python
wb = Workbook()
ws = wb.active
ws.title = "Data"

# Add headers
headers = ['Name', 'Value', 'Date']
for col, header in enumerate(headers, 1):
    ws.cell(row=1, column=col, value=header)

# Add data
ws.append(['Item 1', 100, '2024-01-15'])
ws.append(['Item 2', 200, '2024-01-16'])

wb.save('new_workbook.xlsx')
```

### Formatting

```python
from openpyxl.styles import Font, Fill, PatternFill, Alignment

# Bold header
ws['A1'].font = Font(bold=True, size=12)

# Background color
ws['A1'].fill = PatternFill(start_color='FFFF00', fill_type='solid')

# Alignment
ws['A1'].alignment = Alignment(horizontal='center')

# Number format
ws['B2'].number_format = '$#,##0.00'
ws['C3'].number_format = '0.0%'
```

## Formula Recalculation

**Use Excel formulas, not hardcoded Python calculations.**

After creating or modifying spreadsheets, recalculate formulas:

```bash
python recalc.py output.xlsx 30
```

The script:
1. Configures LibreOffice
2. Recalculates all formulas
3. Returns JSON indicating any errors with locations

## Verification Checklist

Before delivery:
- [ ] Test sample cell references
- [ ] Confirm column mappings (column 64 = BL)
- [ ] Remember Excel uses 1-based indexing
- [ ] Check for division-by-zero scenarios
- [ ] Validate all cell references exist
- [ ] Run recalculation script

## Quick Reference

| Task | Method |
|------|--------|
| Load file | `load_workbook('file.xlsx')` |
| Read cell | `ws['A1'].value` |
| Write cell | `ws['A1'] = value` |
| Add formula | `ws['A1'] = '=SUM(B1:B10)'` |
| Format number | `ws['A1'].number_format = '$#,##0'` |
| Bold text | `ws['A1'].font = Font(bold=True)` |
| Save | `wb.save('output.xlsx')` |
