---
name: sop_webapptesting
description: Python Playwright-based automation toolkit for testing local web applications. Use when testing web apps, automating browser interactions, or validating UI functionality.
---

# Web Application Testing Toolkit

This toolkit provides Python Playwright-based automation for testing local web applications.

## Key Workflow Principle

**Reconnaissance-Then-Action Pattern**: Take screenshots or inspect the DOM *after* calling `page.wait_for_load_state('networkidle')` on dynamic applications. Don't inspect the DOM before waiting for `networkidle` on dynamic apps.

## Decision Process

1. First determine if the application is static HTML
2. If dynamic, establish whether the server is already running
3. Use `scripts/with_server.py` to manage server lifecycles

## Usage Example

For a frontend running on port 5173:

```bash
python scripts/with_server.py --server "npm run dev" --port 5173 -- python your_automation.py
```

The automation script itself contains only Playwright logic, assuming the server is already running and accessible.

## Best Practices

- Treat bundled scripts as "black boxes"
- Use `--help` with scripts before using them
- Use synchronous Playwright APIs
- Employ descriptive selectors (text-based, role-based, or CSS)
- Implement appropriate waits before DOM inspection or element interaction

## Selector Strategy

Prefer selectors in this order:
1. **Text-based**: `page.get_by_text("Submit")`
2. **Role-based**: `page.get_by_role("button", name="Submit")`
3. **Test IDs**: `page.get_by_test_id("submit-btn")`
4. **CSS selectors**: `page.locator(".submit-button")`

## Common Patterns

### Wait for Page Load
```python
page.goto("http://localhost:5173")
page.wait_for_load_state('networkidle')
```

### Screenshot After Action
```python
page.click("button#submit")
page.wait_for_load_state('networkidle')
page.screenshot(path="after_submit.png")
```

### Element Discovery
```python
# Find all buttons
buttons = page.locator("button").all()
for btn in buttons:
    print(btn.text_content())
```

## Reference Examples

Check the `examples/` directory for:
- Element discovery patterns
- Static HTML automation
- Console logging capture
- Form interaction patterns
