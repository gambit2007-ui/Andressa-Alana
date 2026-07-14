import { authorize, adminClient, isCronRequest } from '../_shared/auth.ts';
import { json, optionsResponse } from '../_shared/http.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return optionsResponse();
  try {
    const cron = isCronRequest(req);
    const context = cron ? null : await authorize(req, ['admin', 'manager', 'finance']);
    const admin = adminClient();
    await admin.rpc('refresh_overdue_installments', { p_as_of: new Date().toISOString().slice(0, 10) });
    const end = new Date();
    end.setDate(end.getDate() + 2);
    let query = admin.from('installments').select('id,organization_id,due_date,status').in('status', ['pending', 'partial', 'overdue']).lte('due_date', end.toISOString().slice(0, 10));
    if (context) query = query.eq('organization_id', context.profile.organization_id);
    const { data: installments, error } = await query;
    if (error) throw error;
    const notifications = (installments ?? []).flatMap((item) => ['whatsapp', 'email'].map((channel) => ({
      organization_id: item.organization_id,
      installment_id: item.id,
      channel,
      provider: 'mock',
      status: 'simulated',
      sent_at: new Date().toISOString(),
      payload: { simulated: true, dueDate: item.due_date, installmentStatus: item.status },
    })));
    if (notifications.length) {
      const { error: insertError } = await admin.from('billing_notifications').insert(notifications);
      if (insertError) throw insertError;
    }
    return json({ simulated: notifications.length, message: 'Regua mock concluida. Nenhuma mensagem ou Pix real foi enviado.' });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Falha na regua de cobranca.';
    return json({ error: message }, message === 'UNAUTHORIZED' ? 401 : message === 'FORBIDDEN' ? 403 : 500);
  }
});
