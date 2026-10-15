import http from 'node:http';
export function request(app, path, { method = 'GET', body, cookie, origin, headers = {} } = {}) {
  const data = body === undefined ? undefined : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port: app.port, path, method, headers: {
      host: new URL(app.origin).host,
      ...(data === undefined ? {} : { origin: origin ?? app.origin, 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) }),
      ...(cookie ? { cookie } : {}), ...headers,
    } }, res => { const chunks = []; res.on('data', chunk => chunks.push(chunk)); res.on('end', () => { const text = Buffer.concat(chunks).toString('utf8'); let body; try { body = JSON.parse(text); } catch {} resolve({ status: res.statusCode, headers: res.headers, body, text }); }); });
    req.on('error', reject); req.end(data);
  });
}
export function cookieFrom(response) { return (response.headers['set-cookie'] || []).map(value => value.split(';')[0]).join('; '); }
export function tokenFrom(mail) { return new URL(mail.text.match(/https?:\/\/[^\s]+#token=[^\s]+/)[0]).hash.slice('#token='.length); }
export async function registerAndLogin(app, mailbox, body, headers = {}) {
  const signup = await request(app, '/api/auth/sign-up/email', { method: 'POST', body, headers });
  if (signup.status !== 200) return signup;
  const mail = mailbox.findLast(item => item.to === body.email);
  const verified = await request(app, '/api/account/verify-email', { method: 'POST', body: { token: tokenFrom(mail) }, headers });
  if (verified.status !== 200) return verified;
  return request(app, '/api/auth/sign-in/email', { method: 'POST', body: { email: body.email, password: body.password }, headers });
}
