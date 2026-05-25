import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/db';
import { sendTransactionalEmail } from '@/lib/mailgun';

function generateCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

export async function createOtpToken(
  email: string,
  type: 'register' | 'reset' | 'login',
  userId?: string,
) {
  const code = generateCode();
  const codeHash = await bcrypt.hash(code, 10);
  const expiresAt = new Date(Date.now() + 1000 * 60 * 15);

  await prisma.otpToken.create({
    data: {
      email,
      codeHash,
      type,
      expiresAt,
      userId,
    },
  });

  const subject = type === 'reset' ? 'Κωδικός επαναφοράς κωδικού' : 'Κωδικός επαλήθευσης';
  const message = `Ο κωδικός OTP είναι <strong>${code}</strong>. Είναι ενεργός για 15 λεπτά.`;

  await sendTransactionalEmail(email, subject, `<p>${message}</p>`);
  return code;
}

export async function verifyOtpToken(email: string, code: string, type: 'register' | 'reset' | 'login') {
  const token = await prisma.oTpToken.findFirst({
    where: {
      email,
      type,
      used: false,
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: 'desc' },
  });

  if (!token) return false;
  const valid = await bcrypt.compare(code, token.codeHash);
  if (!valid) return false;

  await prisma.oTpToken.update({ where: { id: token.id }, data: { used: true } });
  return true;
}
