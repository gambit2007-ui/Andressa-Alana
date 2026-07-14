import { authorize, adminClient } from '../_shared/auth.ts';
import { json, optionsResponse } from '../_shared/http.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return optionsResponse();
  try {
    const { profile } = await authorize(req, ['admin', 'manager']);
    const { data, error } = await adminClient().from('mdm_devices').update({ last_sync_at: new Date().toISOString(), provider_payload: { simulated: true } }).eq('organization_id', profile.organization_id).select('id');
    if (error) throw error;
    return json({ synced: data?.length ?? 0, simulated: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Falha no sync MDM.';
    return json({ error: message }, message === 'UNAUTHORIZED' ? 401 : message === 'FORBIDDEN' ? 403 : 500);
  }
});
