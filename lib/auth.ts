import { PrismaAdapter } from '@auth/prisma-adapter';
import type { AuthConfig } from '@auth/core';
import { prisma } from './db';

export const authOptions: AuthConfig = {
  adapter: PrismaAdapter(prisma),
  providers: [
    {
      id: 'email',
      name: 'Email',
      type: 'email',
      server: process.env.EMAIL_SERVER,
      from: process.env.EMAIL_FROM,
    },
    {
      id: 'google',
      name: 'Google',
      type: 'oauth',
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      authorization: {
        params: {
          prompt: 'consent',
          access_type: 'offline',
          response_type: 'code',
        },
      },
    },
    {
      id: 'microsoft',
      name: 'Microsoft',
      type: 'oauth',
      clientId: process.env.MICROSOFT_CLIENT_ID,
      clientSecret: process.env.MICROSOFT_CLIENT_SECRET,
      authorization: {
        params: {
          scope: 'openid profile email offline_access User.Read',
        },
      },
    },
  ],
  pages: {
    signIn: '/auth/signin',
    verifyRequest: '/auth/verify-request',
  },
  session: {
    strategy: 'database',
  },
  callbacks: {
    async session({ session, user }) {
      return {
        ...session,
        user: {
          ...session.user,
          id: user.id,
          role: user.role,
        },
      };
    },
  },
};

export default authOptions;
