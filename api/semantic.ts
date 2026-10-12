import { validSemanticRequest } from '../server/analytics/dispatch.mjs';
import { executeHosted } from '../server/analytics/hosted.mjs';
import { AnalyticsService } from '../server/analytics/service.mjs';
import { getStore } from '../server/store.mjs';
export default async function handler(req: any, res: any) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json');
  if (!validSemanticRequest(req, process.env.SESSION_SECRET)) {
    res.statusCode = 401;
    return res.end(JSON.stringify({ error: 'Acceso no autorizado.' }));
  }
  try {
    const result = await executeHosted(new AnalyticsService(getStore()));
    res.statusCode = result.failed ? 503 : 200;
    return res.end(JSON.stringify(result));
  } catch {
    res.statusCode = 503;
    return res.end(JSON.stringify({ error: 'Procesamiento privado no disponible.' }));
  }
}
