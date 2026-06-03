/**
 * @dgsoft/design-system — Index
 * =========================================================
 * Main export file for all design system components and utilities
 */

// Components
export { Button } from './components/button';
export type { } from './components/button';

export { Badge, Tag, StatusBadge } from './components/badge';
export type { BadgeVariant } from './components/badge';

export { Avatar, AvatarStack } from './components/avatar';

export { Input, Textarea } from './components/input';

// CSS & Config (re-export for reference)
// Import globals.css in your app root layout:
// import '@dgsoft/design-system/css';

// For Tailwind integration:
// Add to tailwind.config.ts:
// import dsConfig from '@dgsoft/design-system/tailwind';
// export default {
//   presets: [dsConfig],
// }

// ========== UTILITY TYPES ==========
export type ComponentSize = 'xs' | 'sm' | 'md' | 'lg';
export type ButtonVariant = 'primary' | 'secondary' | 'subtle' | 'ghost' | 'danger' | 'brand';
// BadgeVariant is re-exported above from ./components/badge (single source of truth).

// ========== SETUP INSTRUCTIONS ==========
/**
 * 
 * QUICK START — DGsoft Design System
 * =========================================================
 * 
 * 1. Install the package:
 *    npm install @dgsoft/design-system
 * 
 * 2. Import global styles in your app root (app/layout.tsx):
 *    import '@dgsoft/design-system/css';
 * 
 * 3. Update tailwind.config.ts:
 *    import dsConfig from '@dgsoft/design-system/tailwind';
 *    
 *    export default {
 *      presets: [dsConfig],
 *      content: [
 *        './app/**\/*.{ts,tsx}',
 *        './components/**\/*.{ts,tsx}',
 *        './node_modules/@dgsoft/design-system/**\/*.{ts,tsx}',
 *      ],
 *    };
 * 
 * 4. Use components:
 *    import { Button, Badge, Avatar } from '@dgsoft/design-system';
 *    
 *    <Button variant="primary">Click me</Button>
 *    <Badge variant="blue">Status</Badge>
 *    <Avatar user={{ name: 'John Doe' }} size="md" />
 * 
 * =========================================================
 * 
 * Design System Principles:
 * - Two-primary palette: DG Red (#E31E2A) + Sisyphus Blue (#0078D4)
 * - Warm neutrals (no cool greys)
 * - Fluent 2 motion & elevation
 * - Segoe UI Variable → Inter (web fallback)
 * - Microsoft 365 integration ready
 * 
 * =========================================================
 */
