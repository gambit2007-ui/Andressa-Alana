import { authorize, adminClient, tokenIssuedRecently } from '../_shared/auth.ts';
import { json, optionsResponse } from '../_shared/http.ts';
import { getMdmProvider } from '../_shared/mdm-provider.ts';

const destructiveCommands = new Set(['erase', 'clear_activation_lock', 'remove_management']);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return optionsResponse();
  try {
    const { profile, token } = await authorize(req, ['admin', 'manager']);
    const body = await req.json() as { mdmDeviceId?: string; command?: string; reason?: string; confirmedSerial?: string };
    if (!body.mdmDeviceId || !body.command || !body.reason) return json({ error: 'Dados obrigatorios ausentes.' }, 400);
    const admin = adminClient();
    const { data: mdmDevice, error } = await admin.from('mdm_devices').select('id,organization_id,device_id,device:devices(serial_number)').eq('id', body.mdmDeviceId).eq('organization_id', profile.organization_id).single();
    if (error || !mdmDevice) return json({ error: 'Dispositivo MDM nao encontrado.' }, 404);
    const destructive = destructiveCommands.has(body.command);
    const deviceRelation = mdmDevice.device as unknown as { serial_number: string };
    if (destructive) {
      if (profile.role !== 'admin') return json({ error: 'Comando destrutivo exige administrador.' }, 403);
      if (!tokenIssuedRecently(token)) return json({ error: 'Reautenticacao recente obrigatoria.' }, 403);
      if (body.reason.trim().length < 10) return json({ error: 'Informe um motivo com ao menos 10 caracteres.' }, 400);
      if (body.confirmedSerial?.trim().toUpperCase() !== deviceRelation.serial_number.toUpperCase()) return json({ error: 'Confirmacao do serial incorreta.' }, 400);
    }
    const commandId = crypto.randomUUID();
    const { error: insertError } = await admin.from('mdm_commands').insert({ id: commandId, organization_id: profile.organization_id, mdm_device_id: mdmDevice.id, command: body.command, reason: body.reason, is_destructive: destructive, status: 'sent', requested_by: profile.id, approved_by: destructive ? profile.id : null });
    if (insertError) throw insertError;
    const result = await getMdmProvider().sendCommand({ deviceId: mdmDevice.device_id, command: body.command, reason: body.reason });
    const { error: updateError } = await admin.from('mdm_commands').update({ status: result.status, provider_reference: result.reference, provider_response: result.payload, completed_at: new Date().toISOString() }).eq('id', commandId);
    if (updateError) throw updateError;
    return json({ id: commandId, status: result.status, simulated: result.payload.simulated === true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Falha ao registrar comando MDM.';
    return json({ error: message }, message === 'UNAUTHORIZED' ? 401 : message === 'FORBIDDEN' ? 403 : 500);
  }
});
