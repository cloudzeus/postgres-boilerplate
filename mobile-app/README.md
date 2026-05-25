# DGSMART ERP — Mobile App

Companion mobile application that consumes the **web app's REST API**.
This folder is reserved for the future React Native / Expo implementation.

## API contract (initial)

All endpoints live under `https://<host>/api/`. Auth via OTP login.

### Auth
| Method | Endpoint                | Purpose                            |
|--------|-------------------------|------------------------------------|
| POST   | `/api/auth/password`    | Email + password login             |
| POST   | `/api/auth/otp/send`    | Send OTP to email                  |
| POST   | `/api/auth/otp/verify`  | Verify OTP, return session         |
| POST   | `/api/auth/register`    | New account                        |
| POST   | `/api/auth/signout`     | Invalidate session                 |

### Admin (RBAC-gated)
| Method | Endpoint                                  | Permission              |
|--------|-------------------------------------------|-------------------------|
| GET    | `/api/admin/users`                        | `users.read`            |
| PATCH  | `/api/admin/users/:id`                    | `users.update`          |
| DELETE | `/api/admin/users/:id`                    | `users.delete`          |
| PATCH  | `/api/admin/users/:id/role`               | `users.assign_role`     |
| GET    | `/api/admin/roles`                        | `roles.read`            |
| POST   | `/api/admin/roles`                        | `roles.create`          |
| PATCH  | `/api/admin/roles/:id`                    | `roles.update`          |
| DELETE | `/api/admin/roles/:id`                    | `roles.delete`          |
| POST   | `/api/admin/roles/reorder`                | `roles.reorder`         |
| PUT    | `/api/admin/roles/:id/permissions`        | `permissions.assign`    |
| POST   | `/api/admin/permissions/reorder`          | `permissions.reorder`   |

## TODO before implementing
- [ ] Stack decision: **Expo (React Native)** recommended (shared TypeScript types)
- [ ] Mobile JWT bearer auth (cookie-less)
- [ ] OpenAPI codegen from web `/api/openapi`
- [ ] OTP-first auth flow on mobile
- [ ] Expo Push notifications

Initialize later with `npx create-expo-app` once web modules stabilize.
