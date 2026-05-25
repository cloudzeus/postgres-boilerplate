// Centralized OpenAPI 3.0 spec for the DGEspa ERP API.
// Each operation has a Greek description for documentation purposes —
// these are the same docs that the mobile app will use.

export const openapiSpec = {
  openapi: '3.0.3',
  info: {
    title: 'DGEspa ERP API',
    version: '1.0.0',
    description:
      'REST API του DGEspa ERP. Καλύπτει αυθεντικοποίηση (email/password, OTP, social), διαχείριση χρηστών, ' +
      'ρόλων, δικαιωμάτων, ρυθμίσεων, audit log και μέσων (BunnyCDN). Όλες οι μέθοδοι διαχείρισης είναι ' +
      'RBAC-protected — κάθε κλήση απαιτεί ενεργή συνεδρία cookie (`erp_session`) με κατάλληλο δικαίωμα.',
    contact: { name: 'DGEspa Team', email: 'connect@dgsmart.gr' },
  },
  servers: [
    { url: '/', description: 'Local' },
  ],
  tags: [
    { name: 'Auth', description: 'Σύνδεση, εγγραφή, OTP, social providers' },
    { name: 'Users', description: 'Διαχείριση χρηστών (CRUD, ρόλος, κωδικός)' },
    { name: 'Roles', description: 'Διαχείριση ρόλων και αναδιάταξη' },
    { name: 'Permissions', description: 'Δικαιώματα συστήματος και ανάθεση σε ρόλους' },
    { name: 'Settings', description: 'Ρυθμίσεις εφαρμογής (super admin)' },
    { name: 'Audit', description: 'Audit log ενεργειών χρηστών' },
    { name: 'Imports', description: 'Excel imports' },
    { name: 'AI', description: 'Μεταφράσεις και AI helpers (DeepSeek)' },
  ],
  components: {
    securitySchemes: {
      sessionCookie: { type: 'apiKey', in: 'cookie', name: 'erp_session' },
    },
    schemas: {
      Error: {
        type: 'object',
        properties: { error: { type: 'string' }, issues: { type: 'array', items: { type: 'object' } } },
      },
      Role: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          key: { type: 'string', nullable: true },
          name: { type: 'string' },
          description: { type: 'string', nullable: true },
          isSystem: { type: 'boolean' },
          order: { type: 'integer' },
        },
      },
      Permission: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          key: { type: 'string' },
          resource: { type: 'string' },
          action: { type: 'string' },
          description: { type: 'string', nullable: true },
          order: { type: 'integer' },
        },
      },
      User: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          email: { type: 'string', format: 'email' },
          name: { type: 'string', nullable: true },
          isActive: { type: 'boolean' },
          emailVerified: { type: 'string', format: 'date-time', nullable: true },
          createdAt: { type: 'string', format: 'date-time' },
          roleId: { type: 'string' },
          role: { $ref: '#/components/schemas/Role' },
        },
      },
      AuditEntry: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          userId: { type: 'string', nullable: true },
          userEmail: { type: 'string', nullable: true },
          action: { type: 'string' },
          resource: { type: 'string' },
          resourceId: { type: 'string', nullable: true },
          metadata: { type: 'object', nullable: true },
          ip: { type: 'string', nullable: true },
          userAgent: { type: 'string', nullable: true },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
      Setting: {
        type: 'object',
        properties: {
          key: { type: 'string' },
          value: {},
          category: { type: 'string' },
          isSecret: { type: 'boolean' },
        },
      },
    },
  },
  security: [{ sessionCookie: [] }],
  paths: {
    // ============== AUTH ==============
    '/api/auth/password': {
      post: {
        tags: ['Auth'],
        summary: 'Σύνδεση με email + κωδικό',
        description:
          'Πιστοποιεί τον χρήστη με email και κωδικό. Σε επιτυχία ορίζει cookie συνεδρίας ' +
          '`erp_session` (JWT, 30 ημερών) και κάνει 302 redirect στο dashboard του ρόλου. ' +
          'Σε αποτυχία επιστρέφει 302 πίσω στο /auth/signin με παράμετρο error.',
        security: [],
        requestBody: {
          required: true,
          content: {
            'application/x-www-form-urlencoded': {
              schema: {
                type: 'object',
                required: ['email', 'password'],
                properties: { email: { type: 'string', format: 'email' }, password: { type: 'string' } },
              },
            },
          },
        },
        responses: { 302: { description: 'Redirect (επιτυχία ή σφάλμα)' } },
      },
    },
    '/api/auth/register': {
      post: {
        tags: ['Auth'],
        summary: 'Εγγραφή νέου χρήστη',
        description:
          'Δημιουργεί νέο λογαριασμό με προεπιλεγμένο ρόλο CUSTOMER, χωρίς email verification. ' +
          'Στέλνει OTP για ενεργοποίηση και κάνει redirect στο /auth/verify-otp.',
        security: [],
        requestBody: {
          required: true,
          content: {
            'application/x-www-form-urlencoded': {
              schema: {
                type: 'object',
                required: ['name', 'email', 'password'],
                properties: {
                  name: { type: 'string' },
                  email: { type: 'string', format: 'email' },
                  password: { type: 'string', minLength: 8 },
                },
              },
            },
          },
        },
        responses: { 302: { description: 'Redirect (σε /auth/verify-otp ή /auth/register?error=...)' } },
      },
    },
    '/api/auth/otp/send': {
      post: {
        tags: ['Auth'],
        summary: 'Αποστολή κωδικού OTP',
        description:
          'Αποστέλλει 6-ψήφιο OTP στο email σε mode `login`, `register` ή `reset`. ' +
          'Σε mode `reset` ή `login` ο χρήστης πρέπει να υπάρχει ήδη. Λήξη OTP: 10 λεπτά.',
        security: [],
        requestBody: {
          required: true,
          content: {
            'application/x-www-form-urlencoded': {
              schema: {
                type: 'object',
                required: ['email', 'mode'],
                properties: {
                  email: { type: 'string', format: 'email' },
                  mode: { type: 'string', enum: ['login', 'register', 'reset'] },
                },
              },
            },
          },
        },
        responses: { 302: { description: 'Redirect σε /auth/verify-otp' } },
      },
    },
    '/api/auth/otp/verify': {
      post: {
        tags: ['Auth'],
        summary: 'Επαλήθευση κωδικού OTP',
        description:
          'Επαληθεύει τον OTP κωδικό. Σε mode `register` επιβεβαιώνει το email. ' +
          'Σε mode `reset` αλλάζει τον κωδικό. Σε mode `login` ξεκινά συνεδρία.',
        security: [],
        requestBody: {
          required: true,
          content: {
            'application/x-www-form-urlencoded': {
              schema: {
                type: 'object',
                required: ['email', 'code', 'mode'],
                properties: {
                  email: { type: 'string', format: 'email' },
                  code: { type: 'string', minLength: 4, maxLength: 8 },
                  mode: { type: 'string', enum: ['login', 'register', 'reset'] },
                  password: { type: 'string', description: 'Νέος κωδικός (μόνο σε mode=reset)' },
                },
              },
            },
          },
        },
        responses: {
          302: { description: 'Redirect σε επιτυχία / σφάλμα' },
        },
      },
    },
    '/api/auth/signout': {
      get: {
        tags: ['Auth'],
        summary: 'Αποσύνδεση',
        description: 'Διαγράφει το cookie `erp_session` και κάνει redirect στο /auth/signin.',
        responses: { 302: { description: 'Redirect' } },
      },
    },

    // ============== USERS ==============
    '/api/admin/users': {
      get: {
        tags: ['Users'],
        summary: 'Λίστα όλων των χρηστών',
        description: 'Επιστρέφει όλους τους χρήστες με πλήρες αντικείμενο ρόλου. **Απαιτεί `users.read`**.',
        responses: {
          200: {
            description: 'OK',
            content: { 'application/json': { schema: {
              type: 'object', properties: { users: { type: 'array', items: { $ref: '#/components/schemas/User' } } },
            } } },
          },
          401: { description: 'Μη αυθεντικοποιημένος' },
          403: { description: 'Έλλειψη δικαιώματος `users.read`' },
        },
      },
      post: {
        tags: ['Users'],
        summary: 'Δημιουργία νέου χρήστη',
        description:
          'Δημιουργεί νέο χρήστη με κωδικό (hash με bcrypt) και αναθέτει ρόλο. Email θεωρείται ' +
          'επαληθευμένο. **Απαιτεί `users.create`**.',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: {
            type: 'object', required: ['email', 'name', 'password', 'roleId'],
            properties: {
              email: { type: 'string', format: 'email' },
              name: { type: 'string', minLength: 1 },
              password: { type: 'string', minLength: 8 },
              roleId: { type: 'string', description: 'cuid του ρόλου' },
            },
          } } },
        },
        responses: {
          201: { description: 'Created', content: { 'application/json': { schema: { type: 'object', properties: { user: { $ref: '#/components/schemas/User' } } } } } },
          409: { description: 'Υπάρχει ήδη χρήστης με αυτό το email' },
          400: { description: 'Invalid input' },
        },
      },
    },
    '/api/admin/users/{id}': {
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'User cuid' }],
      patch: {
        tags: ['Users'],
        summary: 'Ενημέρωση στοιχείων χρήστη',
        description: 'Ενημερώνει όνομα, email ή/και κατάσταση ενεργοποίησης. **Απαιτεί `users.update`**.',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: {
            type: 'object',
            properties: {
              name: { type: 'string' }, email: { type: 'string', format: 'email' }, isActive: { type: 'boolean' },
            },
          } } },
        },
        responses: {
          200: { description: 'OK', content: { 'application/json': { schema: { type: 'object', properties: { user: { $ref: '#/components/schemas/User' } } } } } },
        },
      },
      delete: {
        tags: ['Users'],
        summary: 'Διαγραφή χρήστη',
        description: 'Οριστική διαγραφή. **Απαιτεί `users.delete`**.',
        responses: { 200: { description: 'Deleted' } },
      },
    },
    '/api/admin/users/{id}/role': {
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      patch: {
        tags: ['Users'],
        summary: 'Αλλαγή ρόλου χρήστη',
        description: 'Αναθέτει νέο ρόλο. **Απαιτεί `users.assign_role`**.',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', required: ['roleId'], properties: { roleId: { type: 'string' } } } } },
        },
        responses: { 200: { description: 'OK' }, 404: { description: 'Ρόλος δεν βρέθηκε' } },
      },
    },
    '/api/admin/users/{id}/password': {
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      patch: {
        tags: ['Users'],
        summary: 'Αλλαγή κωδικού χρήστη (από admin)',
        description:
          'Ο super admin / admin ορίζει νέο κωδικό για άλλο χρήστη. Ο κωδικός αποθηκεύεται hashed (bcrypt cost 12). ' +
          '**Απαιτεί `users.update`**.',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', required: ['password'], properties: { password: { type: 'string', minLength: 8 } } } } },
        },
        responses: { 200: { description: 'OK' } },
      },
    },

    // ============== ROLES ==============
    '/api/admin/roles': {
      get: {
        tags: ['Roles'],
        summary: 'Λίστα ρόλων',
        description: 'Επιστρέφει όλους τους ρόλους ταξινομημένους κατά `order`. **Απαιτεί `roles.read`**.',
        responses: { 200: { description: 'OK', content: { 'application/json': { schema: { type: 'object', properties: { roles: { type: 'array', items: { $ref: '#/components/schemas/Role' } } } } } } } },
      },
      post: {
        tags: ['Roles'],
        summary: 'Δημιουργία custom ρόλου',
        description: 'Δημιουργεί non-system ρόλο με ελάχιστο name + προαιρετική περιγραφή. **Απαιτεί `roles.create`**.',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', required: ['name'], properties: { name: { type: 'string', minLength: 2 }, description: { type: 'string' } } } } },
        },
        responses: { 201: { description: 'Created' } },
      },
    },
    '/api/admin/roles/{id}': {
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      patch: {
        tags: ['Roles'],
        summary: 'Ενημέρωση ρόλου',
        description: 'Άλλαξε name / description. **Απαιτεί `roles.update`**.',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', properties: { name: { type: 'string' }, description: { type: 'string' } } } } },
        },
        responses: { 200: { description: 'OK' } },
      },
      delete: {
        tags: ['Roles'],
        summary: 'Διαγραφή ρόλου',
        description:
          'Διαγραφή επιτρέπεται μόνο σε non-system ρόλους χωρίς συνδεδεμένους χρήστες. ' +
          '**Απαιτεί `roles.delete`**.',
        responses: {
          200: { description: 'Deleted' },
          400: { description: 'System role ή role_in_use' },
        },
      },
    },
    '/api/admin/roles/reorder': {
      post: {
        tags: ['Roles'],
        summary: 'Αναδιάταξη σειράς ρόλων',
        description: 'Σώζει νέο `order` για κάθε ρόλο (drag-and-drop UI). **Απαιτεί `roles.reorder`**.',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: {
            type: 'object', required: ['order'],
            properties: { order: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, order: { type: 'integer' } } } } },
          } } },
        },
        responses: { 200: { description: 'OK' } },
      },
    },
    '/api/admin/roles/{id}/permissions': {
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      put: {
        tags: ['Roles'],
        summary: 'Ανάθεση δικαιωμάτων σε ρόλο',
        description:
          'Αντικαθιστά πλήρως το σύνολο δικαιωμάτων του ρόλου. Δέξου πλήρη λίστα από `permissionIds`. ' +
          '**Απαιτεί `permissions.assign`**.',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', required: ['permissionIds'], properties: { permissionIds: { type: 'array', items: { type: 'string' } } } } } },
        },
        responses: { 200: { description: 'OK' } },
      },
    },

    // ============== PERMISSIONS ==============
    '/api/admin/permissions/reorder': {
      post: {
        tags: ['Permissions'],
        summary: 'Αναδιάταξη σειράς δικαιωμάτων',
        description: 'Σώζει νέο `order` ανά δικαίωμα. **Απαιτεί `permissions.reorder`**.',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: {
            type: 'object', required: ['order'],
            properties: { order: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, order: { type: 'integer' } } } } },
          } } },
        },
        responses: { 200: { description: 'OK' } },
      },
    },

    // ============== SETTINGS ==============
    '/api/admin/settings': {
      get: {
        tags: ['Settings'],
        summary: 'Ανάκτηση όλων των ρυθμίσεων',
        description:
          'Επιστρέφει όλες τις ρυθμίσεις της εφαρμογής (στοιχεία εταιρίας, API keys, integrations). ' +
          'Τα secret πεδία επιστρέφονται μασκαρισμένα. **Απαιτεί `system.settings`**.',
        responses: { 200: { description: 'OK', content: { 'application/json': { schema: { type: 'object', properties: { settings: { type: 'array', items: { $ref: '#/components/schemas/Setting' } } } } } } } },
      },
      put: {
        tags: ['Settings'],
        summary: 'Ενημέρωση ρυθμίσεων (batch)',
        description: 'Ενημερώνει πολλαπλά keys σε μια κλήση. **Απαιτεί `system.settings`**.',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', required: ['updates'], properties: { updates: { type: 'array', items: { type: 'object', properties: { key: { type: 'string' }, value: {} } } } } } } },
        },
        responses: { 200: { description: 'OK' } },
      },
    },

    // ============== AUDIT ==============
    '/api/admin/audit': {
      get: {
        tags: ['Audit'],
        summary: 'Audit log',
        description:
          'Επιστρέφει τα τελευταία 200 audit entries (ή με filter ανά χρήστη / resource / action). ' +
          '**Απαιτεί `system.audit`**.',
        parameters: [
          { name: 'userId',   in: 'query', schema: { type: 'string' }, description: 'Φιλτράρισμα ανά χρήστη' },
          { name: 'resource', in: 'query', schema: { type: 'string' }, description: 'Φιλτράρισμα ανά resource (π.χ. user, role)' },
          { name: 'action',   in: 'query', schema: { type: 'string' }, description: 'Φιλτράρισμα ανά action (π.χ. users.create)' },
          { name: 'limit',    in: 'query', schema: { type: 'integer', default: 200, maximum: 1000 } },
        ],
        responses: { 200: { description: 'OK', content: { 'application/json': { schema: { type: 'object', properties: { entries: { type: 'array', items: { $ref: '#/components/schemas/AuditEntry' } } } } } } } },
      },
    },

    // ============== AI ==============
    '/api/ai/translate': {
      post: {
        tags: ['AI'],
        summary: 'Μετάφραση κειμένου με DeepSeek',
        description:
          'Μεταφράζει ένα ή περισσότερα κείμενα σε γλώσσα-στόχο. Χρησιμοποιεί την ρύθμιση `ai.deepseekApiKey`. ' +
          'Διατηρεί placeholders, HTML, URLs.',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: {
            type: 'object', required: ['to'],
            properties: {
              text: { type: 'string', description: 'Ένα κείμενο' },
              texts: { type: 'array', items: { type: 'string' }, description: 'Batch (εναλλακτικό του text)' },
              from: { type: 'string', default: 'auto', description: 'ISO code πηγής ή "auto"' },
              to: { type: 'string', description: 'ISO code προορισμού (π.χ. en, el, de)' },
            },
          } } },
        },
        responses: {
          200: { description: 'OK', content: { 'application/json': { schema: { type: 'object', properties: { translated: {}, translations: { type: 'array', items: { type: 'string' } } } } } } },
          400: { description: 'Invalid request' },
          500: { description: 'DeepSeek error' },
        },
      },
    },
  },
};
