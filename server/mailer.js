import nodemailer from 'nodemailer';

// 발신 설정은 서버에서만 읽습니다. 비밀값·수신자·링크를 로그에 남기지 않습니다.
export function createMailer(options = {}) {
  if (Object.hasOwn(options, 'mailer')) return options.mailer;
  const env = options.env ?? process.env;
  if (!env.SMTP_HOST && !env.SMTP_FROM) return null;
  const port = Number(env.SMTP_PORT ?? 465);
  if (!env.SMTP_HOST || !env.SMTP_FROM || /[\r\n]/.test(env.SMTP_FROM) || ![465, 587].includes(port) || !env.SMTP_USER || !env.SMTP_PASS) throw new Error('메일 서버 설정을 확인해 주세요.');
  const transport = nodemailer.createTransport({
    host: env.SMTP_HOST, port, secure: port === 465, requireTLS: true,
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
    tls: { minVersion: 'TLSv1.2', rejectUnauthorized: true },
    connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000,
    logger: false, debug: false, disableFileAccess: true, disableUrlAccess: true,
  });
  return async message => { await transport.sendMail({ from: env.SMTP_FROM, to: message.to, ...(message.replyTo ? { replyTo: message.replyTo } : {}), subject: message.subject, text: message.text }); };
}
