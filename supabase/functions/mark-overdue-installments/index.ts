import { authorize, adminClient, isCronRequest } from '../_shared/auth.ts';
import { json, optionsResponse } from '../_shared/http.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return optionsResponse();
  try {
    if (!isCronRequest(req)) await authorize(req, ['admin', 'manager', 'finance']);
    const { data, error } = await adminClient().rpc('refresh_overdue_installments', { p_as_of: new Date().toISOString().slice(0, 10) });
    if (error) throw error;
    return json({ updated: data, message: 'Parcelas vencidas atualizadas.' });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Falha ao atualizar parcelas.';
    return json({ error: message }, message === 'UNAUTHORIZED' ? 401 : message === 'FORBIDDEN' ? 403 : 500);
  }
});
