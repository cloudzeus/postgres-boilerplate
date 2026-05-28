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

### Invoice OCR (RBAC-gated)

Core flow for the mobile app: **shoot photo → upload → poll/await result → categorize → post to SoftOne**.

| Method | Endpoint                                          | Permission          | Notes |
|--------|---------------------------------------------------|---------------------|-------|
| GET    | `/api/admin/ocr`                                  | `ocr.read`          | Latest 200 documents (summary). |
| POST   | `/api/admin/ocr`                                  | `ocr.create`        | `multipart/form-data`: `file` (≤25 MB), `docType` (`invoice`/`receipt`/`general_text`), `language` (`el`/`en`/`de`), `pdfSource` (`auto`/`digital`/`scanned`). Returns extracted fields synchronously. |
| GET    | `/api/admin/ocr/:id`                              | `ocr.read`          | Full doc + line items. |
| PATCH  | `/api/admin/ocr/:id`                              | `ocr.categorize`    | Body: `{ category, notes }`. Must set `category` before posting. |
| DELETE | `/api/admin/ocr/:id`                              | `ocr.delete`        | Removes Bunny object + DB row. |
| GET    | `/api/admin/ocr/:id/file`                         | `ocr.read`          | Streams original PDF/image (proxied from private Bunny zone). |
| GET    | `/api/admin/ocr/:id/thumbnail`                    | `ocr.read`          | WebP thumbnail (generated lazily). |
| POST   | `/api/admin/ocr/:id/reextract`                    | `ocr.create`        | Re-run extraction with `gemini-2.5-pro` (for blurry scans). |
| POST   | `/api/admin/ocr/:id/post-softone`                 | `ocr.post`          | Push to SoftOne FINDOC/PURDOC/SODOC by `category`. |
| POST   | `/api/admin/ocr/:id/create-supplier?role=SUPPLIER\|CUSTOMER` | `companies.create` | AADE afm2info → create `Company` from invoice ΑΦΜ. |

**Allowed MIMEs:** `application/pdf`, `image/jpeg`, `image/png`, `image/webp`, `image/gif`, `image/tiff`, `image/bmp`.

**Status lifecycle:** `PENDING → PROCESSING → COMPLETED | FAILED`. Then `postStatus: NONE → PENDING → POSTED | FAILED` once `post-softone` is invoked.

**OCR document shape** (also published as `OcrDocument` schema in `/api/openapi`):
```ts
{
  id: string; fileName: string; mimeType: string; size: number;
  docType: 'INVOICE' | 'RECEIPT' | 'GENERAL_TEXT';
  language: 'el' | 'en' | 'de';
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  extractedData: {
    invoiceNumber?: string; invoiceDate?: string; dueDate?: string; currency?: string;
    supplierName?: string; vatNumber?: string;            // ΑΦΜ εκδότη (9 ψηφία)
    customerName?: string; customerVatNumber?: string;    // ΑΦΜ παραλήπτη
    subtotal?: number; vatAmount?: number; total?: number;
    items?: Array<{
      code?: string; name: string;
      quantity?: number; price?: number; discount?: number;
      vatRate?: number; total?: number;
    }>;
  } | null;
  category: 'EXPENSE' | 'INVOICE_IN' | 'INVOICE_OUT' | 'RECEIPT'
          | 'CREDIT_NOTE' | 'PAYROLL' | 'TAX' | 'OTHER' | null;
  postStatus: 'NONE' | 'PENDING' | 'POSTED' | 'FAILED';
  postedRef?: string;  // SoftOne FINDOC ref
  thumbUrl?: string;
  errorMessage?: string;
  createdAt: string; completedAt?: string;
  items?: OcrInvoiceItem[];
}
```

**Mobile upload example (React Native / Expo):**
```ts
const form = new FormData();
form.append('file', { uri: photoUri, name: 'invoice.jpg', type: 'image/jpeg' } as any);
form.append('docType', 'invoice');
form.append('language', 'el');

const res = await fetch(`${API}/api/admin/ocr`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${session}` },
  body: form,
});
const { id, data, durationMs } = await res.json();
// data.vatNumber, data.total, data.items, …
```

> Note: the current handlers authenticate via the `erp_session` cookie. For mobile we'll add Bearer-token equivalents (tracked in the TODO list below) — the request/response shapes stay identical.

## TODO before implementing
- [ ] Stack decision: **Expo (React Native)** recommended (shared TypeScript types)
- [ ] Mobile JWT bearer auth (cookie-less)
- [ ] OpenAPI codegen from web `/api/openapi`
- [ ] OTP-first auth flow on mobile
- [ ] Expo Push notifications

Initialize later with `npx create-expo-app` once web modules stabilize.
