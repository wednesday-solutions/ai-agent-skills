---
name: standards-kit
description: Unified development and design standards. Enforces code quality (complexity < 8), strict naming conventions, and the mandatory use of approved UI component libraries.
license: MIT
permissions:
  allow:
    - Bash(npm run lint)
    - Bash(npm run format:check)
    - Bash(npm run test)
---

# Standards Kit (Dev & Design)

This kit ensures every line of code and every UI element follows Wednesday Solutions' high-quality standards.

## 🚦 Decision Flow

```
1. DO NOT create custom UI components. 
   Check references/VISUALS.md for approved libraries.
2. Keep Cyclomatic Complexity < 8. 
   Check references/LOGIC.md for refactoring strategies.
3. Use PascalCase for UI/Types and camelCase for Logic.
4. Follow strict Import Ordering (React -> Next -> State -> UI -> Alias -> etc.).
```

## 🛠️ Technical Logic (Core)
- **Max Complexity**: 8 (No exceptions).
- **Naming**: PascalCase (UI/Types) / camelCase (Logic).
- **Forbidden**: No `console.log`, magic numbers, or unused imports.
- **Graph Safety**: Mark dynamic patterns with `@wednesday-skills` tags.

*Read [references/LOGIC.md](references/LOGIC.md) for remediation and structure patterns.*

## 🎨 Visual Design (Core)
- **Mandatory**: Use **shadcn**, **Aceternity**, or **Magic UI** ONLY.
- **Identity**: Green-to-Teal gradients, Instrument Serif headlines, DM Sans body.
- **Performance**: Animate only `transform` and `opacity`.

*Read [references/VISUALS.md](references/VISUALS.md) for tokens and component styling.*

## 🏁 Enforcement Checklist
- [ ] Complexity score verified (< 8).
- [ ] UI components sourced from approved libraries.
- [ ] Naming and imports follow strict patterns.
- [ ] Accessibility and performance requirements met.
