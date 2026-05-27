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
    { name: 'Companies', description: 'Διαχείριση εταιριών (CRUD + λογότυπο + γεωκωδικοποίηση)' },
    { name: 'Company Types', description: 'Τύποι εταιρίας / sotype (Πελάτης, Προμηθευτής, Συνεργάτης…)' },
    { name: 'Company Branches', description: 'Υποκαταστήματα ανά εταιρία' },
    { name: 'Company Contacts', description: 'Επαφές προσώπων ανά εταιρία + avatar' },
    { name: 'Company Channels', description: 'Πολλαπλά κανάλια επικοινωνίας (email/τηλέφωνο/fax) με τίτλο' },
    { name: 'Company Documents', description: 'Δημόσια έγγραφα ΓΕΜΗ ανά εταιρία (Bunny CDN)' },
    { name: 'AADE', description: 'Άντληση στοιχείων από Ανεξάρτητη Αρχή Δημοσίων Εσόδων (afm2info)' },
    { name: 'GEMI', description: 'ΓΕΜΗ Open Data — αναζήτηση + sync εταιρίας + έγγραφα + metadata' },
    { name: 'KAD', description: 'Μητρώο ΚΑΔ (Greek Activity Codes)' },
    { name: 'Reference Data', description: 'Lookup tables (νομικές μορφές, νομοί, δήμοι, ΦΠΑ…)' },
    { name: 'Backups', description: 'Database backups (pg_dump → Bunny CDN)' },
    { name: 'Media', description: 'Media library (folders + files) στο Bunny CDN' },
    { name: 'Geo', description: 'Γεωκωδικοποίηση και χάρτες (MapTiler)' },
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

      // ---- Companies & related entities ----
      CompanyType: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          key: { type: 'string', description: 'UPPER_SNAKE — π.χ. CUSTOMER, SUPPLIER, PARTNER, PROSPECT' },
          name: { type: 'string' },
          pluralName: { type: 'string', nullable: true },
          description: { type: 'string', nullable: true },
          color: { type: 'string', nullable: true, description: 'hex' },
          icon: { type: 'string', nullable: true, description: 'react-icons key (π.χ. FiUser)' },
          isSystem: { type: 'boolean' },
          order: { type: 'integer' },
        },
      },
      CompanyTypeAssignment: {
        type: 'object',
        properties: { typeId: { type: 'string' }, type: { $ref: '#/components/schemas/CompanyType' } },
      },
      Company: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          code: { type: 'string', nullable: true },
          name: { type: 'string' },
          shortName: { type: 'string', nullable: true },
          afm: { type: 'string', nullable: true, description: 'ΑΦΜ (9 ψηφία)' },
          doy: { type: 'string', nullable: true },
          profession: { type: 'string', nullable: true },
          legalForm: { type: 'string', nullable: true, description: 'Free-text (denormalized cache)' },
          legalTypeId: { type: 'integer', nullable: true, description: 'FK → LegalType' },
          gemhNumber: { type: 'string', nullable: true },
          arGemi: { type: 'string', nullable: true, description: 'Αρ. ΓΕΜΗ από Open Data (string)' },
          gemiOffice: { type: 'string', nullable: true },
          gemiOfficeId: { type: 'integer', nullable: true },
          gemiStatus: { type: 'string', nullable: true },
          companyStatusId: { type: 'integer', nullable: true },
          gemiObjective: { type: 'string', nullable: true },
          gemiIsBranch: { type: 'boolean', nullable: true },
          gemiAutoRegistered: { type: 'boolean', nullable: true },
          gemiLastStatusChange: { type: 'string', format: 'date-time', nullable: true },
          gemiSyncedAt: { type: 'string', format: 'date-time', nullable: true },
          aadeStatus: { type: 'string', nullable: true },
          aadeFirmKind: { type: 'string', nullable: true },
          aadeSyncedAt: { type: 'string', format: 'date-time', nullable: true },
          foundingDate: { type: 'string', format: 'date', nullable: true },
          address: { type: 'string', nullable: true },
          city: { type: 'string', nullable: true },
          zip: { type: 'string', nullable: true },
          country: { type: 'string', nullable: true, description: 'ISO 3166 alpha-2 (default GR)' },
          district: { type: 'string', nullable: true },
          prefectureId: { type: 'string', nullable: true },
          municipalityId: { type: 'string', nullable: true },
          phone: { type: 'string', nullable: true },
          phone2: { type: 'string', nullable: true },
          fax: { type: 'string', nullable: true },
          email: { type: 'string', format: 'email', nullable: true },
          website: { type: 'string', nullable: true },
          contactPerson: { type: 'string', nullable: true },
          contactTitle: { type: 'string', nullable: true },
          iban: { type: 'string', nullable: true },
          bankName: { type: 'string', nullable: true },
          currency: { type: 'string', nullable: true, description: 'ISO 4217 (default EUR)' },
          paymentTerms: { type: 'string', nullable: true },
          creditLimit: { type: 'number', nullable: true },
          discount: { type: 'number', nullable: true },
          vatCategory: { type: 'string', nullable: true },
          vatCategoryId: { type: 'integer', nullable: true },
          category: { type: 'string', nullable: true },
          notes: { type: 'string', nullable: true },
          isActive: { type: 'boolean' },
          employeeCount: { type: 'integer', nullable: true },
          logoUrl: { type: 'string', nullable: true, description: 'CDN URL στο Bunny' },
          logoStorageKey: { type: 'string', nullable: true },
          latitude: { type: 'number', nullable: true },
          longitude: { type: 'number', nullable: true },
          geocodedAt: { type: 'string', format: 'date-time', nullable: true },
          geocodedAddress: { type: 'string', nullable: true },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
          types: { type: 'array', items: { $ref: '#/components/schemas/CompanyTypeAssignment' } },
          activities: { type: 'array', items: { $ref: '#/components/schemas/CompanyActivity' } },
        },
      },
      CompanyBranch: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          companyId: { type: 'string' },
          code: { type: 'string', nullable: true },
          name: { type: 'string' },
          isHeadquarters: { type: 'boolean' },
          address: { type: 'string', nullable: true },
          city: { type: 'string', nullable: true },
          zip: { type: 'string', nullable: true },
          country: { type: 'string', nullable: true },
          phone: { type: 'string', nullable: true },
          email: { type: 'string', format: 'email', nullable: true },
          isActive: { type: 'boolean' },
          latitude: { type: 'number', nullable: true },
          longitude: { type: 'number', nullable: true },
        },
      },
      CompanyContact: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          companyId: { type: 'string' },
          firstName: { type: 'string', nullable: true },
          lastName: { type: 'string', nullable: true },
          fullName: { type: 'string' },
          role: { type: 'string', nullable: true, description: 'π.χ. "Λογιστής"' },
          department: { type: 'string', nullable: true },
          mobile: { type: 'string', nullable: true },
          phone: { type: 'string', nullable: true },
          email: { type: 'string', format: 'email', nullable: true },
          fax: { type: 'string', nullable: true },
          address: { type: 'string', nullable: true },
          city: { type: 'string', nullable: true },
          isPrimary: { type: 'boolean' },
          isActive: { type: 'boolean' },
          notes: { type: 'string', nullable: true },
          avatarUrl: { type: 'string', nullable: true },
        },
      },
      CompanyChannel: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          companyId: { type: 'string' },
          kind: { type: 'string', enum: ['EMAIL', 'PHONE', 'MOBILE', 'FAX', 'OTHER'] },
          label: { type: 'string', nullable: true, description: 'π.χ. "Λογιστήριο"' },
          value: { type: 'string' },
          isPrimary: { type: 'boolean' },
          isActive: { type: 'boolean' },
        },
      },
      CompanyDocument: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          companyId: { type: 'string' },
          source: { type: 'string', enum: ['GEMI', 'MANUAL'] },
          kind: { type: 'string', enum: ['DECISION', 'PUBLICATION', 'OTHER'] },
          title: { type: 'string' },
          kak: { type: 'string', nullable: true, description: 'Κωδικός Αριθμός Καταχώρισης' },
          assembly: { type: 'string', nullable: true },
          summary: { type: 'string', nullable: true },
          decisionSubject: { type: 'string', nullable: true },
          dateAssemblyDecided: { type: 'string', format: 'date-time', nullable: true },
          dateAnnounced: { type: 'string', format: 'date-time', nullable: true },
          dateRegistrated: { type: 'string', format: 'date-time', nullable: true },
          sourceUrl: { type: 'string', nullable: true, description: 'Original ΓΕΜΗ URL' },
          publicUrl: { type: 'string', nullable: true, description: 'Bunny CDN URL' },
          mimeType: { type: 'string', nullable: true },
          sizeBytes: { type: 'integer', nullable: true },
        },
      },
      CompanyActivity: {
        type: 'object',
        properties: {
          code: { type: 'string', description: 'ΚΑΔ' },
          description: { type: 'string' },
          kind: { type: 'string', enum: ['PRIMARY', 'SECONDARY'] },
          order: { type: 'integer' },
        },
      },
      KadCode: {
        type: 'object',
        properties: {
          code: { type: 'string', description: '2-10 ψηφία' },
          description: { type: 'string' },
          parentCode: { type: 'string', nullable: true },
          category: { type: 'string', nullable: true },
          isActive: { type: 'boolean' },
        },
      },
      LegalType: { type: 'object', properties: { id: { type: 'integer' }, descr: { type: 'string' }, descrEn: { type: 'string', nullable: true } } },
      GemiOffice: { type: 'object', properties: { id: { type: 'integer' }, descr: { type: 'string' }, city: { type: 'string', nullable: true }, phone: { type: 'string', nullable: true } } },
      CompanyStatusRef: { type: 'object', properties: { id: { type: 'integer' }, descr: { type: 'string' }, isActive: { type: 'boolean' } } },
      Prefecture: { type: 'object', properties: { id: { type: 'string' }, descr: { type: 'string' } } },
      Municipality: { type: 'object', properties: { id: { type: 'string' }, descr: { type: 'string' }, prefectureId: { type: 'string', nullable: true } } },
      VatCategory: { type: 'object', properties: { id: { type: 'integer' }, code: { type: 'string' }, descr: { type: 'string' }, rate: { type: 'number', nullable: true } } },
      AadeLookupResult: {
        type: 'object',
        properties: {
          mapped: {
            type: 'object',
            properties: {
              afm: { type: 'string' },
              name: { type: 'string' },
              shortName: { type: 'string', nullable: true },
              doy: { type: 'string', nullable: true },
              legalForm: { type: 'string', nullable: true },
              address: { type: 'string', nullable: true },
              zip: { type: 'string', nullable: true },
              city: { type: 'string', nullable: true },
              foundingDate: { type: 'string', format: 'date', nullable: true },
              profession: { type: 'string', nullable: true },
              aadeStatus: { type: 'string', nullable: true },
              aadeFirmKind: { type: 'string', nullable: true },
              isActive: { type: 'boolean' },
            },
          },
          activities: { type: 'array', items: { $ref: '#/components/schemas/CompanyActivity' } },
        },
      },
      GemiLookupResult: {
        type: 'object',
        properties: {
          mapped: { type: 'object' },
          raw: { type: 'object' },
          documentCounts: {
            type: 'object',
            properties: { decision: { type: 'integer' }, publication: { type: 'integer' }, total: { type: 'integer' } },
          },
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

    // ============== COMPANIES ==============
    '/api/admin/companies': {
      get: {
        tags: ['Companies'],
        summary: 'Λίστα εταιριών',
        description: 'Επιστρέφει όλες τις εταιρίες με τα assigned types. Φίλτρα ανά `typeKey`, `typeId`, ή free-text `q` (επωνυμία/ΑΦΜ/email/κωδικός). **Απαιτεί `companies.read`**.',
        parameters: [
          { name: 'typeKey', in: 'query', schema: { type: 'string' } },
          { name: 'typeId', in: 'query', schema: { type: 'string' } },
          { name: 'q', in: 'query', schema: { type: 'string' }, description: 'Free-text search' },
        ],
        responses: { 200: { description: 'OK', content: { 'application/json': { schema: { type: 'object', properties: { companies: { type: 'array', items: { $ref: '#/components/schemas/Company' } } } } } } } },
      },
      post: {
        tags: ['Companies'],
        summary: 'Δημιουργία νέας εταιρίας',
        description:
          'Δημιουργεί εταιρία + assigned types + (optional) activities. Κάνει αυτόματη γεωκωδικοποίηση αν υπάρχει διεύθυνση. **Απαιτεί `companies.create`**.',
        requestBody: { required: true, content: { 'application/json': { schema: { allOf: [{ $ref: '#/components/schemas/Company' }, { type: 'object', required: ['name', 'typeIds'], properties: { typeIds: { type: 'array', items: { type: 'string' }, minItems: 1 } } }] } } } },
        responses: { 201: { description: 'Created', content: { 'application/json': { schema: { type: 'object', properties: { company: { $ref: '#/components/schemas/Company' } } } } } }, 400: { description: 'Invalid' } },
      },
    },
    '/api/admin/companies/{id}': {
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      get: {
        tags: ['Companies'],
        summary: 'Στοιχεία εταιρίας',
        description: 'Πλήρης εγγραφή με types + activities. **Απαιτεί `companies.read`**.',
        responses: { 200: { description: 'OK' }, 404: { description: 'Not found' } },
      },
      patch: {
        tags: ['Companies'],
        summary: 'Ενημέρωση εταιρίας',
        description:
          'Partial update. Αν αλλάξει η διεύθυνση, re-geocodes αυτόματα. Αν περάσεις `activities`, αντικαθιστά πλήρως τη λίστα ΚΑΔ. **Απαιτεί `companies.update`**.',
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/Company' } } } },
        responses: { 200: { description: 'OK' } },
      },
      delete: {
        tags: ['Companies'],
        summary: 'Διαγραφή εταιρίας',
        description: 'Cascade διαγραφή branches/contacts/channels/activities/documents. **Απαιτεί `companies.delete`**.',
        responses: { 200: { description: 'Deleted' } },
      },
    },
    '/api/admin/companies/{id}/logo': {
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      post: {
        tags: ['Companies'],
        summary: 'Ανέβασμα λογότυπου εταιρίας',
        description: 'Multipart upload (PNG/JPG/WEBP/SVG, max 4MB) → Bunny CDN. Αντικαθιστά παλιό λογότυπο. **Απαιτεί `companies.update`**.',
        requestBody: { required: true, content: { 'multipart/form-data': { schema: { type: 'object', required: ['file'], properties: { file: { type: 'string', format: 'binary' } } } } } },
        responses: { 200: { description: 'OK' }, 400: { description: 'unsupported_type | too_large' } },
      },
      delete: {
        tags: ['Companies'],
        summary: 'Διαγραφή λογότυπου',
        responses: { 200: { description: 'Deleted' } },
      },
    },
    '/api/admin/companies/{id}/geocode': {
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      post: {
        tags: ['Geo'],
        summary: 'Χειροκίνητη (re-)γεωκωδικοποίηση εταιρίας',
        description: 'Καλεί MapTiler forward geocoding με τα address fields. Σώζει `latitude`, `longitude`, `geocodedAddress`. **Απαιτεί `companies.update`**.',
        responses: { 200: { description: 'OK' }, 422: { description: 'geocode_failed (δεν βρέθηκε)' } },
      },
    },

    // ============== COMPANY TYPES ==============
    '/api/admin/company-types': {
      get: { tags: ['Company Types'], summary: 'Λίστα τύπων εταιρίας', responses: { 200: { description: 'OK', content: { 'application/json': { schema: { type: 'object', properties: { types: { type: 'array', items: { $ref: '#/components/schemas/CompanyType' } } } } } } } } },
      post: {
        tags: ['Company Types'], summary: 'Δημιουργία custom τύπου',
        description: '**Απαιτεί `companies.manage_types`**.',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['key', 'name'], properties: { key: { type: 'string' }, name: { type: 'string' }, pluralName: { type: 'string' }, color: { type: 'string' }, icon: { type: 'string' } } } } } },
        responses: { 201: { description: 'Created' }, 409: { description: 'key exists' } },
      },
    },
    '/api/admin/company-types/{id}': {
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      patch: { tags: ['Company Types'], summary: 'Ενημέρωση τύπου', responses: { 200: { description: 'OK' } } },
      delete: { tags: ['Company Types'], summary: 'Διαγραφή τύπου (όχι system types)', responses: { 200: { description: 'OK' }, 400: { description: 'system_type_protected' } } },
    },

    // ============== COMPANY BRANCHES ==============
    '/api/admin/companies/{id}/branches': {
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      get: { tags: ['Company Branches'], summary: 'Λίστα υποκαταστημάτων', responses: { 200: { description: 'OK', content: { 'application/json': { schema: { type: 'object', properties: { branches: { type: 'array', items: { $ref: '#/components/schemas/CompanyBranch' } } } } } } } } },
      post: {
        tags: ['Company Branches'], summary: 'Νέο υποκατάστημα',
        description: 'Auto-geocodes. Αν `isHeadquarters=true`, ξεμαρκάρει τα άλλα. **Απαιτεί `companies.update`**.',
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/CompanyBranch' } } } },
        responses: { 201: { description: 'Created' } },
      },
    },
    '/api/admin/companies/{id}/branches/{branchId}': {
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        { name: 'branchId', in: 'path', required: true, schema: { type: 'string' } },
      ],
      patch: { tags: ['Company Branches'], summary: 'Ενημέρωση υποκαταστήματος (re-geocodes αν αλλάξει διεύθυνση)', responses: { 200: { description: 'OK' } } },
      delete: { tags: ['Company Branches'], summary: 'Διαγραφή υποκαταστήματος', responses: { 200: { description: 'OK' } } },
    },

    // ============== COMPANY CONTACTS ==============
    '/api/admin/companies/{id}/contacts': {
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      get: { tags: ['Company Contacts'], summary: 'Λίστα επαφών εταιρίας', responses: { 200: { description: 'OK', content: { 'application/json': { schema: { type: 'object', properties: { contacts: { type: 'array', items: { $ref: '#/components/schemas/CompanyContact' } } } } } } } } },
      post: {
        tags: ['Company Contacts'], summary: 'Νέα επαφή',
        description: 'Αυτο-υπολογίζει `fullName` από `firstName + lastName` αν δεν δοθεί. Αν `isPrimary=true`, ξεμαρκάρει τα άλλα. **Απαιτεί `companies.update`**.',
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/CompanyContact' } } } },
        responses: { 201: { description: 'Created' }, 400: { description: 'missing_name' } },
      },
    },
    '/api/admin/companies/{id}/contacts/{contactId}': {
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        { name: 'contactId', in: 'path', required: true, schema: { type: 'string' } },
      ],
      patch: { tags: ['Company Contacts'], summary: 'Ενημέρωση επαφής', responses: { 200: { description: 'OK' } } },
      delete: { tags: ['Company Contacts'], summary: 'Διαγραφή επαφής', responses: { 200: { description: 'OK' } } },
    },
    '/api/admin/companies/{id}/contacts/{contactId}/avatar': {
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        { name: 'contactId', in: 'path', required: true, schema: { type: 'string' } },
      ],
      post: {
        tags: ['Company Contacts'], summary: 'Ανέβασμα avatar επαφής',
        description: 'Multipart (PNG/JPG/WEBP/SVG, max 3MB) → Bunny CDN.',
        requestBody: { required: true, content: { 'multipart/form-data': { schema: { type: 'object', required: ['file'], properties: { file: { type: 'string', format: 'binary' } } } } } },
        responses: { 200: { description: 'OK' } },
      },
      delete: { tags: ['Company Contacts'], summary: 'Διαγραφή avatar επαφής', responses: { 200: { description: 'OK' } } },
    },

    // ============== COMPANY CHANNELS (multi-email/phone) ==============
    '/api/admin/companies/{id}/channels': {
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      get: { tags: ['Company Channels'], summary: 'Λίστα καναλιών επικοινωνίας', responses: { 200: { description: 'OK', content: { 'application/json': { schema: { type: 'object', properties: { channels: { type: 'array', items: { $ref: '#/components/schemas/CompanyChannel' } } } } } } } } },
      post: {
        tags: ['Company Channels'], summary: 'Νέο κανάλι (email/τηλέφωνο/fax) με τίτλο',
        description: 'Το `isPrimary` εφαρμόζεται ανά `kind` (ένα κύριο email, ένα κύριο σταθερό κ.λπ.). **Απαιτεί `companies.update`**.',
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/CompanyChannel' } } } },
        responses: { 201: { description: 'Created' } },
      },
    },
    '/api/admin/companies/{id}/channels/{channelId}': {
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        { name: 'channelId', in: 'path', required: true, schema: { type: 'string' } },
      ],
      patch: { tags: ['Company Channels'], summary: 'Ενημέρωση καναλιού', responses: { 200: { description: 'OK' } } },
      delete: { tags: ['Company Channels'], summary: 'Διαγραφή καναλιού', responses: { 200: { description: 'OK' } } },
    },

    // ============== COMPANY DOCUMENTS ==============
    '/api/admin/companies/{id}/documents': {
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      get: { tags: ['Company Documents'], summary: 'Λίστα εγγράφων ΓΕΜΗ της εταιρίας (από Bunny CDN)', responses: { 200: { description: 'OK', content: { 'application/json': { schema: { type: 'object', properties: { documents: { type: 'array', items: { $ref: '#/components/schemas/CompanyDocument' } } } } } } } } },
    },
    '/api/admin/companies/{id}/documents/{docId}': {
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        { name: 'docId', in: 'path', required: true, schema: { type: 'string' } },
      ],
      delete: { tags: ['Company Documents'], summary: 'Διαγραφή εγγράφου (+ Bunny cleanup)', responses: { 200: { description: 'OK' } } },
    },
    '/api/admin/companies/{id}/gemi-sync': {
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      post: {
        tags: ['GEMI'],
        summary: 'Συγχρονισμός εταιρίας από ΓΕΜΗ Open Data',
        description:
          'Καλεί ΓΕΜΗ (search by ΑΦΜ αν λείπει `arGemi`, μετά get company + documents). Ενημερώνει όλα τα πεδία, αντικαθιστά activities, upserts στο master ΚΑΔ, κατεβάζει όλα τα έγγραφα και τα ανεβάζει στο Bunny CDN σε `companies/{id}/gemi/`. **Απαιτεί `companies.update`**.',
        requestBody: { required: false, content: { 'application/json': { schema: { type: 'object', properties: { arGemi: { type: 'string' }, syncDocuments: { type: 'boolean', default: true } } } } } },
        responses: {
          200: { description: 'OK', content: { 'application/json': { schema: { type: 'object', properties: { ok: { type: 'boolean' }, arGemi: { type: 'string' }, documentsImported: { type: 'integer' }, documentsFailed: { type: 'integer' } } } } } },
          400: { description: 'missing_identifier' },
          404: { description: 'gemi_not_found' },
          502: { description: 'gemi_error' },
        },
      },
    },

    // ============== AADE / GEMI lookups ==============
    '/api/admin/aade-lookup': {
      post: {
        tags: ['AADE'],
        summary: 'Άντληση στοιχείων από ΑΕΔΕΕ (afm2info)',
        description: 'Επιστρέφει mapped fields + λίστα ΚΑΔ. Δεν γράφει στο DB εκτός από αυτόματο upsert στο master ΚΑΔ. **Απαιτεί `companies.read`**.',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['afm'], properties: { afm: { type: 'string', pattern: '^\\d{9}$' } } } } } },
        responses: {
          200: { description: 'OK', content: { 'application/json': { schema: { $ref: '#/components/schemas/AadeLookupResult' } } } },
          404: { description: 'not_found' },
          502: { description: 'aade_unreachable' },
        },
      },
    },
    '/api/admin/gemi-lookup': {
      post: {
        tags: ['GEMI'],
        summary: 'Προεπισκόπηση στοιχείων από ΓΕΜΗ Open Data',
        description: 'Δέξου είτε `afm` είτε `arGemi`. Δεν γράφει στο DB. **Απαιτεί `companies.read`**.',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { afm: { type: 'string' }, arGemi: { type: 'string' } } } } } },
        responses: {
          200: { description: 'OK', content: { 'application/json': { schema: { $ref: '#/components/schemas/GemiLookupResult' } } } },
          404: { description: 'not_found' },
          502: { description: 'gemi_error' },
        },
      },
    },

    // ============== KAD master ==============
    '/api/admin/kad-codes': {
      get: {
        tags: ['KAD'],
        summary: 'Αναζήτηση στο μητρώο ΚΑΔ',
        description: 'Free-text `q` ψάχνει και σε code και σε description. **Απαιτεί `kad.read`**.',
        parameters: [
          { name: 'q', in: 'query', schema: { type: 'string' } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 100, maximum: 500 } },
        ],
        responses: { 200: { description: 'OK', content: { 'application/json': { schema: { type: 'object', properties: { codes: { type: 'array', items: { $ref: '#/components/schemas/KadCode' } }, total: { type: 'integer' } } } } } } },
      },
      post: {
        tags: ['KAD'],
        summary: 'Manual upsert ΚΑΔ',
        description: '**Απαιτεί `kad.manage`**.',
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/KadCode' } } } },
        responses: { 200: { description: 'OK' } },
      },
    },

    // ============== REFERENCE DATA (lookup tables) ==============
    '/api/admin/lookups': {
      get: {
        tags: ['Reference Data'],
        summary: 'Όλα τα lookup tables σε μία κλήση (για form selects)',
        description: '**Απαιτεί `companies.read`**.',
        responses: {
          200: { description: 'OK', content: { 'application/json': { schema: { type: 'object', properties: {
            legalTypes: { type: 'array', items: { $ref: '#/components/schemas/LegalType' } },
            gemiOffices: { type: 'array', items: { $ref: '#/components/schemas/GemiOffice' } },
            companyStatuses: { type: 'array', items: { $ref: '#/components/schemas/CompanyStatusRef' } },
            prefectures: { type: 'array', items: { $ref: '#/components/schemas/Prefecture' } },
            municipalities: { type: 'array', items: { $ref: '#/components/schemas/Municipality' } },
            vatCategories: { type: 'array', items: { $ref: '#/components/schemas/VatCategory' } },
          } } } } },
        },
      },
    },
    '/api/admin/metadata': {
      get: {
        tags: ['Reference Data'],
        summary: 'Counts + last update ανά lookup table',
        description: '**Απαιτεί `metadata.read`**.',
        responses: { 200: { description: 'OK' } },
      },
    },
    '/api/admin/metadata/refresh-gemi': {
      post: {
        tags: ['Reference Data'],
        summary: 'Ανανέωση όλων των ΓΕΜΗ metadata',
        description: 'Κατεβάζει LegalType / GemiOffice / CompanyStatus / Prefecture / Municipality από ΓΕΜΗ Open Data και κάνει upsert. **Απαιτεί `metadata.manage`**.',
        responses: {
          200: { description: 'OK', content: { 'application/json': { schema: { type: 'object', properties: { ok: { type: 'boolean' }, refreshedAt: { type: 'string', format: 'date-time' }, summary: { type: 'object' } } } } } },
          502: { description: 'gemi_error' },
        },
      },
    },

    // ============== BACKUPS ==============
    '/api/admin/backups': {
      get: { tags: ['Backups'], summary: 'Λίστα backups', description: '**Απαιτεί `system.backups`**.', responses: { 200: { description: 'OK' } } },
      post: { tags: ['Backups'], summary: 'Χειροκίνητο backup τώρα', description: 'Καλεί pg_dump (custom format) και ανεβάζει στο Bunny CDN private storage. **Απαιτεί `system.backups`**.', responses: { 200: { description: 'OK' } } },
    },
    '/api/admin/backups/{id}': {
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      delete: { tags: ['Backups'], summary: 'Διαγραφή backup (+ Bunny cleanup)', responses: { 200: { description: 'OK' } } },
    },
    '/api/admin/backups/{id}/download': {
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      get: { tags: ['Backups'], summary: 'Λήψη .dump αρχείου από Bunny', responses: { 200: { description: 'Binary stream' } } },
    },
    '/api/cron/backups': {
      get: { tags: ['Backups'], summary: 'Cron trigger backup', description: 'Καλείται από scheduler. Bearer token authentication.', security: [], responses: { 200: { description: 'OK' } } },
    },

    // ============== GEO / MAP ==============
    '/api/admin/map/static': {
      get: {
        tags: ['Geo'],
        summary: 'Proxy για στατικό χάρτη MapTiler (κρύβει το API key)',
        description: 'Επιστρέφει PNG. Παράμετροι: `lat`, `lng`, `zoom`, `w`, `h`. Cached 24h. **Απαιτεί `companies.read`**.',
        parameters: [
          { name: 'lat', in: 'query', required: true, schema: { type: 'number' } },
          { name: 'lng', in: 'query', required: true, schema: { type: 'number' } },
          { name: 'zoom', in: 'query', schema: { type: 'integer', default: 15 } },
          { name: 'w', in: 'query', schema: { type: 'integer', default: 600 } },
          { name: 'h', in: 'query', schema: { type: 'integer', default: 320 } },
        ],
        responses: { 200: { description: 'image/png' }, 502: { description: 'maptiler_failed' } },
      },
    },

    // ============== MEDIA ==============
    '/api/admin/media': {
      get: { tags: ['Media'], summary: 'Λίστα media files', description: '**Απαιτεί `media.read`**.', responses: { 200: { description: 'OK' } } },
      post: { tags: ['Media'], summary: 'Upload media file → Bunny CDN', description: '**Απαιτεί `media.upload`**.', responses: { 201: { description: 'Created' } } },
    },
    '/api/admin/media/{id}': {
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      patch: { tags: ['Media'], summary: 'Rename / move file', responses: { 200: { description: 'OK' } } },
      delete: { tags: ['Media'], summary: 'Διαγραφή file (+ Bunny cleanup)', responses: { 200: { description: 'OK' } } },
    },
    '/api/admin/media/folders': {
      get: { tags: ['Media'], summary: 'Λίστα φακέλων', responses: { 200: { description: 'OK' } } },
      post: { tags: ['Media'], summary: 'Νέος φάκελος', description: '**Απαιτεί `media.manage_folders`**.', responses: { 201: { description: 'Created' } } },
    },
    '/api/admin/media/folders/{id}': {
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      patch: { tags: ['Media'], summary: 'Rename / move folder', responses: { 200: { description: 'OK' } } },
      delete: { tags: ['Media'], summary: 'Διαγραφή φακέλου (cascade)', responses: { 200: { description: 'OK' } } },
    },
  },
};
