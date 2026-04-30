---
name: sop_skillcreator
description: Guide for building modular skill packages that extend Claude's capabilities through specialized knowledge, workflows, and tool integrations. Use when creating new custom skills.
---

# Skill Creator Guide

Build modular packages that extend Claude's capabilities through specialized knowledge, workflows, and tool integrations.

## Key Principles

**Concise Design**: The context window is a public good. Only include information Claude doesn't already possess, challenging each piece's necessity.

**Appropriate Freedom Levels**: Match specificity to task fragility:
- High freedom for flexible approaches
- Low freedom for fragile operations requiring exact sequences

**Progressive Disclosure**: Load content in three levels:
1. Metadata (always loaded)
2. SKILL.md body (on trigger)
3. Bundled resources (as needed)

## Skill Structure

Every skill requires:

### SKILL.md
```markdown
---
name: my-skill
description: "Description that triggers skill selection - detail functionality AND usage contexts"
---

# Skill Instructions

Your instructions here...
```

### Optional Bundled Resources

```
my-skill/
├── SKILL.md           # Required - main instructions
├── scripts/           # Executable code for deterministic tasks
├── references/        # Documentation loaded as needed
└── assets/            # Output files like templates or icons
```

## Creation Process

1. **Understand** - Gather concrete usage examples
2. **Plan** - Identify reusable contents (scripts, references, assets)
3. **Initialize** - Use `init_skill.py` to scaffold
4. **Edit** - Write SKILL.md and create resources
5. **Package** - Use `package_skill.py` (validates before creating .skill file)
6. **Iterate** - Refine based on real usage feedback

## Best Practices

### Description Field
The description is critical - it triggers skill selection. Include:
- What the skill does
- When to use it (specific contexts)
- Example use cases

### SKILL.md Content
- Keep under 500 lines
- Split complex content into reference files
- Organize references one level deep from SKILL.md
- Use clear section headers

### Scripts
- Make deterministic tasks executable
- Include error handling
- Document inputs/outputs

### References
- Load only when needed
- Keep focused on single topics
- Cross-reference sparingly

## Example Skill Structure

```
code-review/
├── SKILL.md
│   ---
│   name: code-review
│   description: Review code for bugs, security issues, and best practices.
│                Use when asked to review PRs, audit code, or check for issues.
│   ---
│   # Code Review Skill
│   ...instructions...
│
├── scripts/
│   └── analyze.py      # Static analysis helper
│
├── references/
│   ├── security.md     # Security checklist
│   └── patterns.md     # Common anti-patterns
│
└── assets/
    └── report-template.md
```
