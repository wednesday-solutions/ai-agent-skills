# Visual Design Standards (Reference)

This document contains the visual design system and component standards for Wednesday Solutions projects.

## 1. Design Tokens

### Colors
- **Primary**: `#4ADE80` (Green)
- **Secondary**: `#0D9488` (Teal)
- **Gradient**: `linear-gradient(135deg, #4ADE80 0%, #0D9488 100%)`
- **Text**: `#18181B` (Primary), `#71717A` (Secondary), `#A3A3A3` (Muted)

### Typography
- **Display**: Instrument Serif (Hero: 60px, Section: 44px)
- **Body**: DM Sans (Standard: 16px, Small: 14px)

### Spacing
- Base Grid: **4px**
- Gaps: 8px, 12px, 16px, 24px, 32px

## 2. Component Guidelines

### Approved Libraries
1. **shadcn/ui**: Foundation
2. **Aceternity UI**: High-end effects
3. **Magic UI**: Text/Button animations
4. **Motion Primitives**: Advanced transitions

### Standard Styling
- **Cards**: 24px radius, 22px padding, lift (-8px) on hover.
- **Buttons**: 14px radius, 3D gradient, shimmer on hover.
- **Badges**: Pill shape (100px), subtle pulse for live states.

## 3. Animation Timing

| Interaction | Duration | Easing |
|:---|:---|:---|
| **Micro** | 100-150ms | `ease` |
| **Hover** | 200-300ms | `spring` |
| **Transition** | 300ms | `easeOutCubic` |
| **Reveal** | 500-800ms | `easeOutQuart` |

## 4. Responsive Design

### Breakpoints
- **sm**: `640px` (Mobile landscape)
- **md**: `768px` (Tablet)
- **lg**: `1024px` (Desktop)
- **xl**: `1280px` (Large desktop)
- **2xl**: `1536px` (Extra large)

### Best Practices
- Touch targets minimum **44x44px**.
- Stack layouts vertically on **sm** and **md**.
- Hide decorative background elements on smaller screens to improve performance.

## 5. Accessibility (A11y)

- **Contrast**: 4.5:1 for standard text.
- **Motion**: Wrap all animations in `prefers-reduced-motion` media queries.

```css
@media (prefers-reduced-motion: reduce) {
  * {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

- **ARIA**: Mandatory `aria-label` for icons and `alt` text for images.

## 6. Layout Patterns

- **Hero**: Badge -> Headline -> Lead text -> CTA -> Social Proof.
- **Comparison**: Strikethrough "Old Way" vs Circled "New Way".
- **Steps**: Numbered cards (01, 02, 03) with connecting lines.
