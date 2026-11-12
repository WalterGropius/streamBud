// Vercel serverless function: GET /api/convert?url=<spotify or youtube link>
import { handleConvert } from '../lib/http.js';

export default async function handler(req, res) {
  const params = new URL(req.url, 'http://localhost').searchParams;
  const { status, headers, body } = await handleConvert(params, { env: process.env });
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.statusCode = status;
  res.end(JSON.stringify(body));
}
