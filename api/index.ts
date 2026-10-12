import { waitUntil } from '@vercel/functions';
import { handle } from '../server/http.mjs';
import { dispatchSemantic } from '../server/analytics/dispatch.mjs';
export default async function handler(req: any, res: any) {
  const schedule = () =>
    waitUntil(
      dispatchSemantic().catch(() => {
        console.error('Private semantic task deferred; source remains queued.');
      }),
    );
  await handle(req, res, undefined, process.env.VERCEL ? schedule : undefined);
}
