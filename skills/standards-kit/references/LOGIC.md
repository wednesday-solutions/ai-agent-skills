# Technical Logic Standards (Reference)

This document contains detailed implementation patterns and remediation strategies for Wednesday Solutions projects.

## 1. Complexity Remediation

When a function exceeds the complexity limit of 8, use these strategies:

| Strategy | Description |
|:---|:---|
| **Extract Helpers** | Break large functions into smaller, single-responsibility units. |
| **Early Returns** | Use guard clauses to handle edge cases first and reduce indentation. |
| **Lookup Tables** | Replace complex `switch` or `if/else` chains with object maps. |
| **Polymorphism** | Use the Strategy pattern to handle different logic branches. |

### Example: Lookup Table vs Conditionals
```typescript
// AVOID: High complexity
function getStatusColor(status: string) {
  if (status === 'active') return 'green'
  if (status === 'pending') return 'yellow'
  if (status === 'error') return 'red'
  return 'gray'
}

// PREFER: Low complexity
const STATUS_COLORS: Record<string, string> = {
  active: 'green',
  pending: 'yellow',
  error: 'red'
}
const getStatusColor = (status: string) => STATUS_COLORS[status] ?? 'gray'
```

## 2. Naming Reference

| Type | Convention | Example |
|:---|:---|:---|
| Component files | PascalCase | `UserProfile.tsx` |
| Hook files | camelCase + `use` | `useAuth.ts` |
| Utility files | camelCase | `formatDate.ts` |
| Type files | camelCase | `user.types.ts` |
| Folders | camelCase | `components/`, `hooks/` |

## 3. React Component Structure

Maintain this order for consistency:
1.  **Interfaces/Types**: Define props and local types.
2.  **Hooks**: `useState`, `useEffect`, custom hooks.
3.  **Derived State**: Memoized values and simple computations.
4.  **Handlers**: Event callbacks and helper functions.
5.  **Render**: JSX return with early returns for loading/error.

## 4. TypeScript Patterns

- **Discriminated Unions**: Use for state to ensure exhaustive checking.
- **Narrowing**: Use type guards (`typeof`, `instanceof`) instead of casting.
- **Strictness**: No `any`. Use `unknown` or generics.

## 5. Commenting & Intelligence

- **Substantive Comments**: Explain **WHY** (>= 8 words).
- **Tech Debt Tags**: 
    - `FIXME:`/`BUG:`: High severity.
    - `HACK:`/`TODO:`: Medium severity.
    - `OPTIMIZE:`: Low severity.
- **Graph Annotations**:
    - `@wednesday-skills:connects-to [label] → [path]`
    - `@wednesday-skills:global [label] → [path]`
