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

## 5. Module Headers (CRITICAL)

Every code file MUST start with a block comment describing its purpose. This is used by the intelligence pipeline to map the codebase.

```typescript
/**
 * [MODULE_NAME]
 * 
 * Purpose: Detailed explanation of what this file does (>= 8 words).
 * Connections: What other modules does this interact with?
 * Risk: High/Medium/Low and why.
 */
```

## 6. Testing Strategy

- **Unit/Integration**: Use **Jest**. Aim for 80%+ coverage on business logic.
- **E2E**: Use **Playwright**. Mandatory for happy-path flows and critical UI.
- **Fixtures**: Always use stable fixtures; avoid mocking network calls in E2E.

## 7. State Management

- **Redux/Zustand**: Use slices and strictly typed actions.
- **Selectors**: Always use memoized selectors to prevent re-renders.
- **Side Effects**: Use middleware (Sagas/Thunks) for complex async logic; keep components pure.

## 8. Security & Performance

- **Sanitize**: Use DOMPurify for any HTML rendering.
- **Logs**: Never log PII (email, phone) or sensitive tokens.
- **Memoization**: Use `React.memo`, `useCallback`, and `useMemo` ONLY when profiling shows performance gains.
