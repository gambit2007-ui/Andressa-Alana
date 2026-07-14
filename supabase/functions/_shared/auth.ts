import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

export type RequestProfile = { id: string; organization_id: string; role: string };

const url = Deno.env.get('SUPABASE_URL') ?? '';
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

export const adminClient = () => createClient(url, serviceKey, { auth: { persistSession: false } });

export async function authorize(req: Request, allowedRoles: string[]): Promise<{ profile: RequestProfile; token: string }> {
  const authorization = req.headers.get('Authorization') ?? '';
  const token = authorization.replace(/^Bearer\s+/i, '');
  if (!token) throw new Error('UNAUTHORIZED');
  const admin = adminClient();
  const { data: userData, error: userError } = await admin.auth.getUser(token);
  if (userError || !userData.user) throw new Error('UNAUTHORIZED');
  const { data: profile, error: profileError } = await admin.from('profiles').select('id,organization_id,role,active').eq('id', userData.user.id).single();
  if (profileError || !profile?.active || !allowedRoles.includes(profile.role)) throw new Error('FORBIDDEN');
  return { profile: profile as RequestProfile, token };
}

export function isCronRequest(req: Request): boolean {
  const expected = Deno.env.get('BILLING_CRON_SECRET');
  return Boolean(expected && req.headers.get('x-cron-secret') === expected);
}

export function tokenIssuedRecently(token: string, maxAgeSeconds = 300): boolean {
  try {
    const payloadPart = token.split('.')[1];
    if (!payloadPart) return false;
    const normalized = payloadPart.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(payloadPart.length / 4) * 4, '=');
    const payload = JSON.parse(atob(normalized)) as { iat?: number };
    return typeof payload.iat === 'number' && Math.floor(Date.now() / 1000) - payload.iat <= maxAgeSeconds;
  } catch {
    return false;
  }
}
