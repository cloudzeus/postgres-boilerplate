import { Auth } from '@auth/core';
import { authOptions } from '@/lib/auth';

export async function POST(request: Request): Promise<Response> {
  return (await Auth(request, authOptions)) as unknown as Response;
}

export async function GET(request: Request): Promise<Response> {
  return (await Auth(request, authOptions)) as unknown as Response;
}
