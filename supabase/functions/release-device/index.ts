import { authorize, adminClient, tokenIssuedRecently } from '../_shared/auth.ts';
import { json, optionsResponse } from '../_shared/http.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return optionsResponse();
  try {
    const { profile, token } = await authorize(req, ['admin']);
    if (!tokenIssuedRecently(token)) return json({ error: 'Reautenticacao recente obrigatoria.' }, 403);
    const body = await req.json() as { saleId?: string; confirmedSerial?: string };
    if (!body.saleId) return json({ error: 'Venda obrigatoria.' }, 400);
    const admin = adminClient();
    const { data: sale, error } = await admin.from('device_sales').select('id,device_id,paid_in_full,device:devices(serial_number)').eq('id', body.saleId).eq('organization_id', profile.organization_id).single();
    if (error || !sale) return json({ error: 'Venda nao encontrada.' }, 404);
    const deviceRelation = sale.device as unknown as { serial_number: string };
    if (!sale.paid_in_full) return json({ error: 'Venda ainda nao esta quitada.' }, 409);
    if (body.confirmedSerial?.toUpperCase() !== deviceRelation.serial_number.toUpperCase()) return json({ error: 'Serial incorreto.' }, 400);
    await admin.from('device_sales').update({ apple_release_confirmed: true, confirmed_by: profile.id }).eq('id', sale.id);
    await admin.from('devices').update({ status: 'sold', mdm_enrolled: false }).eq('id', sale.device_id);
    await admin.from('mdm_devices').update({ status: 'unmanaged' }).eq('device_id', sale.device_id);
    await admin.from('device_events').insert({ organization_id: profile.organization_id, device_id: sale.device_id, event_type: 'apple_release_confirmed', description: 'Liberacao manual registrada apos venda quitada.', actor_id: profile.id });
    return json({ released: true, externalAppleAction: false, message: 'Liberacao registrada internamente; nenhuma acao externa foi afirmada.' });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Falha ao liberar aparelho.';
    return json({ error: message }, message === 'UNAUTHORIZED' ? 401 : message === 'FORBIDDEN' ? 403 : 500);
  }
});
