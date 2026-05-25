import { NextResponse } from 'next/server';
import { openapiSpec } from '@/lib/openapi';

export async function GET() {
  return NextResponse.json(openapiSpec, {
    headers: { 'Cache-Control': 'public, max-age=60' },
  });
}
