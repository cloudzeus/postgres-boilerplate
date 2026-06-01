import type { Metadata } from 'next';
import { SaasOcrDemo } from './saas-ocr-demo';

// Public demo (no auth) — shown to prospective subscribers.
export const metadata: Metadata = {
  title: 'ParaStat Cloud — SaaS OCR Demo',
  description: 'OCR παραστατικών + αυτόματη καταχώριση στο SoftOne.',
};

export default function SaasOcrDemoPage() {
  return <SaasOcrDemo />;
}
