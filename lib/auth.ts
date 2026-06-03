import { PrismaAdapter } from '@auth/prisma-adapter';
import type { AuthConfig } from '@auth/core';
import MicrosoftEntraId from '@auth/core/providers/microsoft-entra-id';
import { prisma } from './db';

/**
 * Auth.js (@auth/core) config — used ONLY for the Microsoft OAuth handshake
 * (see app/api/auth/[...auth]/route.ts).
 *
 * Email + password and OTP sign-in are handled by custom routes under
 * app/api/auth/* (password/route.ts, otp/*), which issue the app's own JWT
 * session cookie via lib/session.ts. They do NOT go through Auth.js providers.
 */
export const authOptions: AuthConfig = {
  adapter: PrismaAdapter(prisma),
  providers: [
    MicrosoftEntraId({
      clientId: process.env.MICROSOFT_CLIENT_ID,
      clientSecret: process.env.MICROSOFT_CLIENT_SECRET,
      // Optional: lock to a single tenant. Defaults to "common" if unset.
      tenantId: process.env.MICROSOFT_TENANT_ID,
      authorization: {
        params: { scope: 'openid profile email offline_access User.Read' },
      },
    }),
  ],
  pages: {
    signIn: '/auth/signin',
    verifyRequest: '/auth/verify-request',
  },
  session: { strategy: 'database' },
  callbacks: {
    async session({ session, user }) {
      return {
        ...session,
        user: {
          ...session.user,
          id: user.id,
          role: (user as { role?: unknown }).role,
        },
      };
    },
  },
};

export default authOptions;
