import { clearSessionResponse } from '@/lib/session';

export async function POST() {
  return clearSessionResponse('/auth/signin');
}
