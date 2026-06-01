/**
 * SendItNow SMS HTTP API (JSON) client.
 * Docs: https://github.com/senditnow/HttpApi/wiki/HTTP-API-(JSON)
 */

const ENDPOINT = 'https://senditnow.gr/apiext/Sendout/SendJSMS';
const SENDER_ID = process.env.SMS_SENDER_ID ?? 'DGSOFT';

export interface SmsMessage {
  destination: string;
  message: string;
}

interface SmsOperationError {
  errorCode: number;
  errorMessage: string;
  SMSErrorType: number;
  valueOfError: string;
}

export interface SmsResponse {
  success: boolean;
  OperationErrors: SmsOperationError[] | null;
  SubmissionID: number;
  data: { destination: string; smsid: number }[] | null;
}

/**
 * Normalises a phone number to the format the API expects:
 * digits only, no leading `+` or zeros, country code prefixed.
 * A bare 10-digit Greek number is assumed to be GR (prefix `30`).
 */
export function normaliseDestination(raw: string): string {
  let n = raw.replace(/[^\d+]/g, '');
  if (n.startsWith('+')) n = n.slice(1);
  else if (n.startsWith('00')) n = n.slice(2);
  else if (/^0\d{9}$/.test(n)) n = n.slice(1); // strip national trunk 0
  if (/^\d{10}$/.test(n)) n = `30${n}`; // bare GR mobile/landline → add country code
  return n;
}

/**
 * Sends one or more SMS messages via SendItNow.
 * @throws if SMS_API_KEY is missing or the request fails at the network layer.
 */
export async function sendSms(
  messages: SmsMessage[],
  opts: { senderId?: string; sendOn?: number; priceCat?: number } = {},
): Promise<SmsResponse> {
  const apitoken = process.env.SMS_API_KEY;
  if (!apitoken) throw new Error('SMS_API_KEY is not set');

  const body: Record<string, unknown> = {
    apitoken,
    senderid: opts.senderId ?? SENDER_ID,
    messages: messages.map((m) => ({
      destination: normaliseDestination(m.destination),
      message: m.message,
    })),
  };
  if (opts.sendOn !== undefined) body.sendon = opts.sendOn;
  if (opts.priceCat !== undefined) body.pricecat = opts.priceCat;

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
  });

  const data = (await res.json()) as SmsResponse;
  if (!res.ok && !data?.success) {
    throw new Error(`SendItNow HTTP ${res.status}: ${JSON.stringify(data)}`);
  }
  return data;
}

/** Convenience wrapper for a single recipient. */
export function sendSingleSms(destination: string, message: string, opts?: { senderId?: string }) {
  return sendSms([{ destination, message }], opts);
}
