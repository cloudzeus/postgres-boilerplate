# DGSMART ERP — Changelog

Living documentation. Each significant change appends a new entry.

## 2026-05-25 — Phase 1: Foundation + RBAC

### Design system
- Fluent 2 + DG Red tokens (`tailwind.config.ts`, `app/globals.css`)
- Density 9/10: 13px base font, 8px row height for dense tables, depth-shadow elevation
- Motion: 180/220/250ms, Fluent easing curves
- Light/dark theme via `.dark` class on `<html>`

### Data model (BREAKING)
- `User.role` enum → `User.roleId` FK to new `Role` model
- New tables: `Role`, `Permission`, `RolePermission`
- All ordered models have `order Int` for drag-drop reorder
- Migration: **wipes existing DB** — run `npx prisma migrate reset && npm run seed:db`

### RBAC
- 17 canonical permissions in `lib/permissions.ts`
- 6 system roles seeded with sensible defaults (`scripts/seed.js`)
- `lib/rbac.ts` server helpers: `requireUser()`, `requirePermission()`, `hasPermission()`
- SUPER_ADMIN bypasses all permission checks

### UI primitives (`components/ui/`)
- `button`, `card`, `input`, `label`, `badge`, `checkbox`, `separator`, `tooltip`
- `dropdown-menu` (with submenu + checkbox items)
- `dialog`
- `data-table` — TanStack-powered: search, sort, paginate, **column resize via drag**, column visibility, **row expand**, row selection
- `sortable-list` — `@dnd-kit`-powered drag-drop reorder

### Auth (redesigned)
- New split-screen `app/auth/layout.tsx` (brand panel + form)
- Pages: `signin` (password + OTP modes), `register`, `lost-password`, `verify-otp`
- All use react-icons (Feather + brand glyphs)

### Admin shell
- `app/admin/layout.tsx` — RBAC-gated via `requireUser()`
- `components/admin/sidebar.tsx` — collapsible (52px ↔ 240px), mobile drawer, permission-filtered nav, tooltips when collapsed
- `components/admin/topbar.tsx` — breadcrumb, search, theme toggle, notifications, user menu

### Pages
- `/admin` — dashboard overview with stat cards
- `/admin/users` — DataTable: search, sort, paginate, column resize, expand row, row actions (edit / change role / activate / delete)
- `/admin/roles` — SortableList: drag to reorder, system-role lock badge, "Δικαιώματα" dialog for granular grants
- `/admin/permissions` — SortableList grouped by resource

### API
- `PATCH/DELETE /api/admin/users/:id` (RBAC-gated)
- `PATCH /api/admin/users/:id/role`
- `POST/GET /api/admin/roles` · `PATCH/DELETE /api/admin/roles/:id`
- `POST /api/admin/roles/reorder`
- `PUT /api/admin/roles/:id/permissions`
- `POST /api/admin/permissions/reorder`
- All routes validate input with `zod`

### Mobile app
- `mobile-app/README.md` documents the API contract for the future Expo app

## Coming next (Phase 2)
- BunnyCDN S3 media manager (auto-WebP + SVG passthrough with WebP companion)
- Super admin Settings (API keys, integrations, company details)
- Sync queue / pull-buffer for third-party systems with progress UI
- Audit log of all user actions
- DeepSeek translation helper (everywhere a text field needs i18n)
