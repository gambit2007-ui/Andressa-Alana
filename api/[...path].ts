import fs from "node:fs";
import path from "node:path";
import express, { type NextFunction, type Request, type Response } from "express";
import { config as loadEnv } from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

for (const envFile of [".env.local", ".env"]) {
  const fullPath = path.resolve(process.cwd(), envFile);
  if (fs.existsSync(fullPath)) {
    loadEnv({ path: fullPath, override: false });
  }
}

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const TIME_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;
const MONTH_REGEX = /^\d{4}-\d{2}$/;
const configuredYear = Number(process.env.FINANCE_YEAR ?? "");
const FINANCE_YEAR = Number.isInteger(configuredYear) && configuredYear >= 2000
  ? configuredYear
  : Number(format(new Date(), "yyyy"));

const VALID_APPOINTMENT_STATUS = new Set(["scheduled", "completed", "cancelled"] as const);
type AppointmentStatus = "scheduled" | "completed" | "cancelled";
type GenericRow = Record<string, unknown>;
type UploadAsset = { id: string; name: string; type: string; size: number; dataUrl: string };
type FinanceHistoryItem = { id: string; label: string; revenue: number; expenses: number; net: number; appointmentCount: number };

type DailyPerformancePoint = { date: string; day: number; total: number; expenses: number };

const MAX_ASSETS = 12;
const MAX_ASSET_BYTES = 5 * 1024 * 1024;
const MAX_IMAGE_DATA_URL_LENGTH = 7_500_000;

const parsePositiveInt = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

const parseNonNegativeNumber = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
};

const asRequiredText = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const asOptionalText = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const toNumber = (value: unknown, fallback = 0): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const isValidStatus = (value: unknown): value is AppointmentStatus =>
  typeof value === "string" && VALID_APPOINTMENT_STATUS.has(value as AppointmentStatus);

const withErrorHandling =
  (handler: (req: Request, res: Response) => Promise<void> | void) =>
  (req: Request, res: Response, next: NextFunction): void => {
    Promise.resolve(handler(req, res)).catch(next);
  };

const parseImageDataUrl = (value: unknown): string | null | "invalid" => {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") return "invalid";
  const trimmed = value.trim();
  if (!trimmed.startsWith("data:image/")) return "invalid";
  if (trimmed.length > MAX_IMAGE_DATA_URL_LENGTH) return "invalid";
  return trimmed;
};

const sanitizeAssets = (value: unknown): UploadAsset[] | "invalid" => {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_ASSETS) return "invalid";

  const assets: UploadAsset[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") return "invalid";
    const payload = item as Partial<UploadAsset>;

    if (
      typeof payload.name !== "string" ||
      payload.name.trim().length === 0 ||
      typeof payload.type !== "string" ||
      payload.type.trim().length === 0 ||
      typeof payload.dataUrl !== "string" ||
      !payload.dataUrl.startsWith("data:") ||
      !Number.isFinite(payload.size)
    ) {
      return "invalid";
    }

    if (payload.size! < 0 || payload.size! > MAX_ASSET_BYTES) return "invalid";
    if (payload.dataUrl.length > MAX_IMAGE_DATA_URL_LENGTH) return "invalid";

    assets.push({
      id: typeof payload.id === "string" && payload.id.trim().length > 0
        ? payload.id
        : `file-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: payload.name.trim(),
      type: payload.type.trim(),
      size: Number(payload.size),
      dataUrl: payload.dataUrl,
    });
  }

  return assets;
};

const parseStoredAssets = (value: unknown): UploadAsset[] => {
  if (Array.isArray(value)) {
    const sanitized = sanitizeAssets(value);
    return sanitized === "invalid" ? [] : sanitized;
  }

  if (typeof value !== "string" || value.trim().length === 0) return [];

  try {
    const parsed = JSON.parse(value) as unknown;
    const sanitized = sanitizeAssets(parsed);
    return sanitized === "invalid" ? [] : sanitized;
  } catch {
    return [];
  }
};

const parseStoredImage = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  return value.startsWith("data:image/") ? value : null;
};

const normalizeTime = (value: unknown): string => String(value ?? "").slice(0, 5);
const dateToMonth = (date: string): string => date.slice(0, 7);
const monthToRange = (month: string) => ({ start: `${month}-01`, end: `${month}-31` });

const normalizeClient = (row: GenericRow) => ({
  ...row,
  id: toNumber(row.id, 0),
  name: String(row.name ?? ""),
  birth_date: row.birth_date ? String(row.birth_date) : null,
  profile_photo: parseStoredImage(row.profile_photo),
  attachments: parseStoredAssets(row.attachments),
});

const normalizeProcedure = (row: GenericRow) => ({
  ...row,
  id: toNumber(row.id, 0),
  name: String(row.name ?? ""),
  price: toNumber(row.price, 0),
  duration: toNumber(row.duration, 0),
  active: Boolean(row.active),
  cover_photo: parseStoredImage(row.cover_photo),
  attachments: parseStoredAssets(row.attachments),
});

const normalizeAppointment = (row: GenericRow) => ({
  ...row,
  id: toNumber(row.id, 0),
  client_id: toNumber(row.client_id, 0),
  procedure_id: toNumber(row.procedure_id, 0),
  appointment_date: String(row.appointment_date ?? ""),
  appointment_time: normalizeTime(row.appointment_time),
  status: String(row.status ?? "scheduled"),
});

const normalizeExpense = (row: GenericRow) => ({
  ...row,
  id: toNumber(row.id, 0),
  amount: toNumber(row.amount, 0),
  expense_date: String(row.expense_date ?? ""),
});

const parseQueryId = (req: Request): number | null => {
  const rawId = Array.isArray(req.query.id) ? req.query.id[0] : req.query.id;
  return parsePositiveInt(rawId);
};

let supabaseCache: SupabaseClient | null = null;
const getDb = (): SupabaseClient => {
  if (supabaseCache) return supabaseCache;

  const url = process.env.SUPABASE_URL?.trim();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

  const missing: string[] = [];
  if (!url) missing.push("SUPABASE_URL");
  if (!serviceRoleKey) missing.push("SUPABASE_SERVICE_ROLE_KEY");

  if (missing.length > 0) {
    throw new Error(`Variaveis Supabase ausentes: ${missing.join(", ")}`);
  }

  supabaseCache = createClient(url as string, serviceRoleKey as string, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  return supabaseCache;
};

const app = express();
app.use(express.json({ limit: "15mb" }));

const getClientDetails = async (clientId: number) => {
  const db = getDb();
  const [clientResult, appointmentsResult, proceduresResult] = await Promise.all([
    db.from("clients").select("*").eq("id", clientId).maybeSingle(),
    db
      .from("appointments")
      .select("*")
      .eq("client_id", clientId)
      .order("appointment_date", { ascending: false })
      .order("appointment_time", { ascending: false }),
    db.from("procedures").select("id,name"),
  ]);

  if (clientResult.error) throw new Error(clientResult.error.message);
  if (appointmentsResult.error) throw new Error(appointmentsResult.error.message);
  if (proceduresResult.error) throw new Error(proceduresResult.error.message);

  if (!clientResult.data) return null;

  const proceduresById = new Map(
    (proceduresResult.data ?? []).map((item) => [toNumber(item.id, 0), String(item.name ?? "Procedimento")]),
  );

  const appointments = (appointmentsResult.data ?? []).map((item) => {
    const normalized = normalizeAppointment(item as GenericRow);
    return {
      ...normalized,
      procedure_name: proceduresById.get(toNumber(normalized.procedure_id, 0)) ?? "Procedimento",
    };
  });

  return {
    ...normalizeClient(clientResult.data as GenericRow),
    appointments,
  };
};

const updateAppointmentStatus = async (appointmentId: number, status: AppointmentStatus): Promise<boolean> => {
  const db = getDb();
  const result = await db.from("appointments").update({ status }).eq("id", appointmentId).select("id");

  if (result.error) throw new Error(result.error.message);
  return Boolean(result.data && result.data.length > 0);
};

app.get("/api/clients", withErrorHandling(async (req, res) => {
  const result = await getDb().from("clients").select("*").order("name", { ascending: true });
  if (result.error) throw new Error(result.error.message);
  res.json((result.data ?? []).map((item) => normalizeClient(item as GenericRow)));
}));

app.post("/api/clients", withErrorHandling(async (req, res) => {
  const name = asRequiredText(req.body.name);
  if (!name) {
    res.status(400).json({ error: "Nome e obrigatorio." });
    return;
  }

  const birthDateRaw = asOptionalText(req.body.birth_date);
  if (birthDateRaw && !DATE_REGEX.test(birthDateRaw)) {
    res.status(400).json({ error: "Data de nascimento deve estar no formato YYYY-MM-DD." });
    return;
  }

  const profilePhoto = parseImageDataUrl(req.body.profile_photo);
  if (profilePhoto === "invalid") {
    res.status(400).json({ error: "Foto de perfil invalida. Use uma imagem valida." });
    return;
  }

  const attachments = sanitizeAssets(req.body.attachments);
  if (attachments === "invalid") {
    res.status(400).json({ error: "Arquivos invalidos. Envie ate 12 arquivos com no maximo 5MB cada." });
    return;
  }

  const result = await getDb().from("clients").insert({
    name,
    phone: asOptionalText(req.body.phone),
    email: asOptionalText(req.body.email),
    birth_date: birthDateRaw,
    notes: asOptionalText(req.body.notes),
    profile_photo: profilePhoto,
    attachments,
  }).select("id").single();

  if (result.error) throw new Error(result.error.message);
  res.status(201).json({ id: toNumber(result.data?.id, 0) });
}));

app.delete("/api/clients-delete", withErrorHandling(async (req, res) => {
  const clientId = parseQueryId(req);
  if (!clientId) {
    res.status(400).json({ error: "Id de cliente invalido." });
    return;
  }

  const db = getDb();
  const result = await db.from("clients").delete().eq("id", clientId).select("id");
  if (result.error) throw new Error(result.error.message);

  if (!result.data || result.data.length === 0) {
    res.status(404).json({ error: "Cliente nao encontrado." });
    return;
  }

  const appointmentsDelete = await db.from("appointments").delete().eq("client_id", clientId).select("id");
  if (appointmentsDelete.error) throw new Error(appointmentsDelete.error.message);

  res.json({ success: true, appointmentsRemoved: appointmentsDelete.data?.length ?? 0 });
}));

app.get("/api/clients/:id", withErrorHandling(async (req, res) => {
  const clientId = parsePositiveInt(req.params.id);
  if (!clientId) {
    res.status(400).json({ error: "Id de cliente invalido." });
    return;
  }

  const payload = await getClientDetails(clientId);
  if (!payload) {
    res.status(404).json({ error: "Cliente nao encontrado." });
    return;
  }

  res.json(payload);
}));

app.get("/api/client-details", withErrorHandling(async (req, res) => {
  const rawId = Array.isArray(req.query.id) ? req.query.id[0] : req.query.id;
  const clientId = parsePositiveInt(rawId);
  if (!clientId) {
    res.status(400).json({ error: "Id de cliente invalido." });
    return;
  }

  const payload = await getClientDetails(clientId);
  if (!payload) {
    res.status(404).json({ error: "Cliente nao encontrado." });
    return;
  }

  res.json(payload);
}));

app.get("/api/procedures", withErrorHandling(async (req, res) => {
  const result = await getDb().from("procedures").select("*").eq("active", true).order("name", { ascending: true });
  if (result.error) throw new Error(result.error.message);
  res.json((result.data ?? []).map((item) => normalizeProcedure(item as GenericRow)));
}));

app.post("/api/procedures", withErrorHandling(async (req, res) => {
  const name = asRequiredText(req.body.name);
  const price = parseNonNegativeNumber(req.body.price);
  const duration = parsePositiveInt(req.body.duration);

  if (!name) {
    res.status(400).json({ error: "Nome do procedimento e obrigatorio." });
    return;
  }
  if (price === null) {
    res.status(400).json({ error: "Preco deve ser um numero nao negativo." });
    return;
  }
  if (duration === null) {
    res.status(400).json({ error: "Duracao deve ser um numero inteiro positivo." });
    return;
  }

  const coverPhoto = parseImageDataUrl(req.body.cover_photo);
  if (coverPhoto === "invalid") {
    res.status(400).json({ error: "Foto do procedimento invalida." });
    return;
  }

  const attachments = sanitizeAssets(req.body.attachments);
  if (attachments === "invalid") {
    res.status(400).json({ error: "Arquivos invalidos. Envie ate 12 arquivos com no maximo 5MB cada." });
    return;
  }

  const result = await getDb().from("procedures").insert({
    name,
    description: asOptionalText(req.body.description),
    price,
    duration,
    cover_photo: coverPhoto,
    attachments,
    active: true,
  }).select("id").single();

  if (result.error) throw new Error(result.error.message);
  res.status(201).json({ id: toNumber(result.data?.id, 0) });
}));

app.delete("/api/procedures-delete", withErrorHandling(async (req, res) => {
  const procedureId = parseQueryId(req);
  if (!procedureId) {
    res.status(400).json({ error: "Id de procedimento invalido." });
    return;
  }

  const db = getDb();
  const result = await db.from("procedures").delete().eq("id", procedureId).select("id");
  if (result.error) throw new Error(result.error.message);

  if (!result.data || result.data.length === 0) {
    res.status(404).json({ error: "Procedimento nao encontrado." });
    return;
  }

  const appointmentsDelete = await db.from("appointments").delete().eq("procedure_id", procedureId).select("id");
  if (appointmentsDelete.error) throw new Error(appointmentsDelete.error.message);

  res.json({ success: true, appointmentsRemoved: appointmentsDelete.data?.length ?? 0 });
}));

app.get("/api/appointments", withErrorHandling(async (req, res) => {
  const date = typeof req.query.date === "string" ? req.query.date.trim() : null;
  if (date && !DATE_REGEX.test(date)) {
    res.status(400).json({ error: "Data deve estar no formato YYYY-MM-DD." });
    return;
  }

  const db = getDb();
  let appointmentsQuery = db.from("appointments").select("*").order("appointment_date", { ascending: true }).order("appointment_time", { ascending: true });
  if (date) appointmentsQuery = appointmentsQuery.eq("appointment_date", date);

  const [appointmentsResult, clientsResult, proceduresResult] = await Promise.all([
    appointmentsQuery,
    db.from("clients").select("id,name"),
    db.from("procedures").select("id,name"),
  ]);

  if (appointmentsResult.error) throw new Error(appointmentsResult.error.message);
  if (clientsResult.error) throw new Error(clientsResult.error.message);
  if (proceduresResult.error) throw new Error(proceduresResult.error.message);

  const clientsById = new Map((clientsResult.data ?? []).map((item) => [toNumber(item.id, 0), String(item.name ?? "Cliente")]));
  const proceduresById = new Map((proceduresResult.data ?? []).map((item) => [toNumber(item.id, 0), String(item.name ?? "Procedimento")]));

  const appointments = (appointmentsResult.data ?? []).map((item) => {
    const normalized = normalizeAppointment(item as GenericRow);
    return {
      ...normalized,
      client_name: clientsById.get(toNumber(normalized.client_id, 0)) ?? "Cliente",
      procedure_name: proceduresById.get(toNumber(normalized.procedure_id, 0)) ?? "Procedimento",
    };
  });

  res.json(appointments);
}));

app.post("/api/appointments", withErrorHandling(async (req, res) => {
  const clientId = parsePositiveInt(req.body.client_id);
  const procedureId = parsePositiveInt(req.body.procedure_id);
  const appointmentDate = asRequiredText(req.body.appointment_date);
  const appointmentTime = asRequiredText(req.body.appointment_time);

  if (!clientId) {
    res.status(400).json({ error: "client_id deve ser um numero inteiro positivo." });
    return;
  }
  if (!procedureId) {
    res.status(400).json({ error: "procedure_id deve ser um numero inteiro positivo." });
    return;
  }
  if (!appointmentDate || !DATE_REGEX.test(appointmentDate)) {
    res.status(400).json({ error: "Data deve estar no formato YYYY-MM-DD." });
    return;
  }
  if (!appointmentTime || !TIME_REGEX.test(appointmentTime)) {
    res.status(400).json({ error: "Horario deve estar no formato HH:mm." });
    return;
  }

  const db = getDb();
  const [clientResult, procedureResult] = await Promise.all([
    db.from("clients").select("id").eq("id", clientId).maybeSingle(),
    db.from("procedures").select("id").eq("id", procedureId).eq("active", true).maybeSingle(),
  ]);

  if (clientResult.error) throw new Error(clientResult.error.message);
  if (procedureResult.error) throw new Error(procedureResult.error.message);

  if (!clientResult.data) {
    res.status(400).json({ error: "Cliente nao encontrado." });
    return;
  }

  if (!procedureResult.data) {
    res.status(400).json({ error: "Procedimento nao encontrado ou inativo." });
    return;
  }

  const result = await db.from("appointments").insert({
    client_id: clientId,
    procedure_id: procedureId,
    appointment_date: appointmentDate,
    appointment_time: `${appointmentTime}:00`,
    status: "scheduled",
    notes: asOptionalText(req.body.notes),
  }).select("id").single();

  if (result.error) throw new Error(result.error.message);
  res.status(201).json({ id: toNumber(result.data?.id, 0) });
}));

app.patch("/api/appointments/:id", withErrorHandling(async (req, res) => {
  const appointmentId = parsePositiveInt(req.params.id);
  const status = req.body.status;

  if (!appointmentId) {
    res.status(400).json({ error: "Id do agendamento invalido." });
    return;
  }
  if (!isValidStatus(status)) {
    res.status(400).json({ error: "Status invalido. Valores permitidos: scheduled, completed, cancelled." });
    return;
  }

  const updated = await updateAppointmentStatus(appointmentId, status);
  if (!updated) {
    res.status(404).json({ error: "Agendamento nao encontrado." });
    return;
  }

  res.json({ success: true });
}));

app.patch("/api/appointments-update", withErrorHandling(async (req, res) => {
  const appointmentId = parsePositiveInt(req.body.id);
  const status = req.body.status;

  if (!appointmentId) {
    res.status(400).json({ error: "Id do agendamento invalido." });
    return;
  }
  if (!isValidStatus(status)) {
    res.status(400).json({ error: "Status invalido. Valores permitidos: scheduled, completed, cancelled." });
    return;
  }

  const updated = await updateAppointmentStatus(appointmentId, status);
  if (!updated) {
    res.status(404).json({ error: "Agendamento nao encontrado." });
    return;
  }

  res.json({ success: true });
}));

app.delete("/api/appointments-delete", withErrorHandling(async (req, res) => {
  const appointmentId = parseQueryId(req);
  if (!appointmentId) {
    res.status(400).json({ error: "Id do agendamento invalido." });
    return;
  }

  const result = await getDb().from("appointments").delete().eq("id", appointmentId).select("id");
  if (result.error) throw new Error(result.error.message);

  if (!result.data || result.data.length === 0) {
    res.status(404).json({ error: "Agendamento nao encontrado." });
    return;
  }

  res.json({ success: true });
}));

app.get("/api/expenses", withErrorHandling(async (req, res) => {
  const month = typeof req.query.month === "string" ? req.query.month.trim() : "";
  if (month && !MONTH_REGEX.test(month)) {
    res.status(400).json({ error: "Mes invalido. Use YYYY-MM." });
    return;
  }

  const db = getDb();
  let query = db.from("expenses").select("*").order("expense_date", { ascending: false }).order("created_at", { ascending: false });
  if (month) {
    const range = monthToRange(month);
    query = query.gte("expense_date", range.start).lte("expense_date", range.end);
  }

  const result = await query;
  if (result.error) throw new Error(result.error.message);

  res.json((result.data ?? []).map((item) => normalizeExpense(item as GenericRow)));
}));

app.post("/api/expenses", withErrorHandling(async (req, res) => {
  const description = asRequiredText(req.body.description);
  const amount = parseNonNegativeNumber(req.body.amount);
  const expenseDate = asRequiredText(req.body.expense_date);

  if (!description) {
    res.status(400).json({ error: "Descricao e obrigatoria." });
    return;
  }
  if (amount === null || amount === 0) {
    res.status(400).json({ error: "Valor da despesa deve ser maior que zero." });
    return;
  }
  if (!expenseDate || !DATE_REGEX.test(expenseDate)) {
    res.status(400).json({ error: "Data da despesa deve estar no formato YYYY-MM-DD." });
    return;
  }

  const result = await getDb().from("expenses").insert({
    description,
    category: asOptionalText(req.body.category),
    amount,
    expense_date: expenseDate,
    notes: asOptionalText(req.body.notes),
  }).select("id").single();

  if (result.error) throw new Error(result.error.message);
  res.status(201).json({ id: toNumber(result.data?.id, 0) });
}));

app.delete("/api/expenses-delete", withErrorHandling(async (req, res) => {
  const expenseId = parseQueryId(req);
  if (!expenseId) {
    res.status(400).json({ error: "Id da despesa invalido." });
    return;
  }

  const result = await getDb().from("expenses").delete().eq("id", expenseId).select("id");
  if (result.error) throw new Error(result.error.message);

  if (!result.data || result.data.length === 0) {
    res.status(404).json({ error: "Despesa nao encontrada." });
    return;
  }

  res.json({ success: true });
}));

app.get("/api/stats", withErrorHandling(async (req, res) => {
  const today = format(new Date(), "yyyy-MM-dd");
  const db = getDb();

  const [appointmentsToday, clientsCount, pendingAppointments] = await Promise.all([
    db.from("appointments").select("id", { count: "exact", head: true }).eq("appointment_date", today),
    db.from("clients").select("id", { count: "exact", head: true }),
    db.from("appointments").select("id", { count: "exact", head: true }).eq("status", "scheduled"),
  ]);

  if (appointmentsToday.error) throw new Error(appointmentsToday.error.message);
  if (clientsCount.error) throw new Error(clientsCount.error.message);
  if (pendingAppointments.error) throw new Error(pendingAppointments.error.message);

  res.json({
    todayAppointments: appointmentsToday.count ?? 0,
    totalClients: clientsCount.count ?? 0,
    pendingAppointments: pendingAppointments.count ?? 0,
  });
}));

app.get("/api/finances", withErrorHandling(async (req, res) => {
  const yearStart = `${FINANCE_YEAR}-01-01`;
  const yearEnd = `${FINANCE_YEAR}-12-31`;
  const db = getDb();

  const [proceduresResult, appointmentsResult, expensesResult] = await Promise.all([
    db.from("procedures").select("id,name,price"),
    db.from("appointments").select("id,procedure_id,status,appointment_date").gte("appointment_date", yearStart).lte("appointment_date", yearEnd),
    db.from("expenses").select("id,amount,expense_date").gte("expense_date", yearStart).lte("expense_date", yearEnd),
  ]);

  if (proceduresResult.error) throw new Error(proceduresResult.error.message);
  if (appointmentsResult.error) throw new Error(appointmentsResult.error.message);
  if (expensesResult.error) throw new Error(expensesResult.error.message);

  const proceduresById = new Map((proceduresResult.data ?? []).map((item) => [toNumber(item.id, 0), toNumber(item.price, 0)]));
  const completedAppointments = (appointmentsResult.data ?? [])
    .map((item) => normalizeAppointment(item as GenericRow))
    .filter((item) => item.status === "completed");

  const expenses = (expensesResult.data ?? []).map((item) => normalizeExpense(item as GenericRow));

  const history: FinanceHistoryItem[] = Array.from({ length: 12 }, (_, index) => {
    const monthDate = new Date(FINANCE_YEAR, index, 1);
    const monthId = format(monthDate, "yyyy-MM");

    const monthAppointments = completedAppointments.filter((appointment) => dateToMonth(String(appointment.appointment_date ?? "")) === monthId);
    const revenue = monthAppointments.reduce((total, appointment) => total + (proceduresById.get(toNumber(appointment.procedure_id, 0)) ?? 0), 0);
    const monthExpenses = expenses.filter((expense) => dateToMonth(String(expense.expense_date ?? "")) === monthId).reduce((total, expense) => total + toNumber(expense.amount, 0), 0);

    return {
      id: monthId,
      label: format(monthDate, "MMMM 'de' yyyy", { locale: ptBR }),
      revenue,
      expenses: monthExpenses,
      net: revenue - monthExpenses,
      appointmentCount: monthAppointments.length,
    };
  });

  const totalReceitas = history.reduce((acc, month) => acc + month.revenue, 0);
  const totalDespesas = history.reduce((acc, month) => acc + month.expenses, 0);
  const caixaGeral = history.reduce((acc, month) => acc + month.net, 0);
  const currentMonth = format(new Date(), "yyyy-MM");
  const monthReference = history.find((month) => month.id === currentMonth) ?? history[0];

  res.json({
    year: FINANCE_YEAR,
    history,
    summary: {
      caixaGeral,
      totalReceitas,
      totalDespesas,
      mesAtual: monthReference.id,
      faturamentoMes: monthReference.revenue,
      despesasMes: monthReference.expenses,
      saldoMes: monthReference.net,
      totalAtendimentosMes: monthReference.appointmentCount,
    },
  });
}));

app.get("/api/finances-details", withErrorHandling(async (req, res) => {
  const month = typeof req.query.month === "string" ? req.query.month.trim() : "";
  if (!MONTH_REGEX.test(month) || !month.startsWith(`${FINANCE_YEAR}-`)) {
    res.status(400).json({ error: `Mes invalido. Use um mes de ${FINANCE_YEAR} no formato YYYY-MM.` });
    return;
  }

  const range = monthToRange(month);
  const db = getDb();

  const [proceduresResult, appointmentsResult, expensesResult] = await Promise.all([
    db.from("procedures").select("id,name,price"),
    db.from("appointments").select("id,procedure_id,status,appointment_date").gte("appointment_date", range.start).lte("appointment_date", range.end),
    db.from("expenses").select("id,amount,expense_date").gte("expense_date", range.start).lte("expense_date", range.end),
  ]);

  if (proceduresResult.error) throw new Error(proceduresResult.error.message);
  if (appointmentsResult.error) throw new Error(appointmentsResult.error.message);
  if (expensesResult.error) throw new Error(expensesResult.error.message);

  const proceduresById = new Map(
    (proceduresResult.data ?? []).map((item) => [toNumber(item.id, 0), { name: String(item.name ?? "Procedimento"), price: toNumber(item.price, 0) }]),
  );

  const completedAppointments = (appointmentsResult.data ?? [])
    .map((item) => normalizeAppointment(item as GenericRow))
    .filter((item) => item.status === "completed");

  const expenses = (expensesResult.data ?? []).map((item) => normalizeExpense(item as GenericRow));

  const monthlyTotal = completedAppointments.reduce((total, appointment) => {
    const procedure = proceduresById.get(toNumber(appointment.procedure_id, 0));
    return total + toNumber(procedure?.price, 0);
  }, 0);

  const monthlyExpenses = expenses.reduce((total, expense) => total + toNumber(expense.amount, 0), 0);

  const byProcedureAccumulator = new Map<string, { value: number; count: number }>();
  const dailyRevenue = new Map<string, number>();

  for (const appointment of completedAppointments) {
    const procedure = proceduresById.get(toNumber(appointment.procedure_id, 0));
    const procedureName = String(procedure?.name ?? "Procedimento");
    const procedurePrice = toNumber(procedure?.price, 0);

    const current = byProcedureAccumulator.get(procedureName) ?? { value: 0, count: 0 };
    byProcedureAccumulator.set(procedureName, {
      value: current.value + procedurePrice,
      count: current.count + 1,
    });

    const date = String(appointment.appointment_date ?? "");
    dailyRevenue.set(date, (dailyRevenue.get(date) ?? 0) + procedurePrice);
  }

  const dailyExpenses = new Map<string, number>();
  for (const expense of expenses) {
    const date = String(expense.expense_date ?? "");
    dailyExpenses.set(date, (dailyExpenses.get(date) ?? 0) + toNumber(expense.amount, 0));
  }

  const [yearRaw, monthRaw] = month.split("-");
  const year = Number(yearRaw);
  const monthIndex = Number(monthRaw);
  const daysInMonth = new Date(year, monthIndex, 0).getDate();

  const dailyPerformance: DailyPerformancePoint[] = Array.from({ length: daysInMonth }, (_, index) => {
    const day = index + 1;
    const date = `${month}-${String(day).padStart(2, "0")}`;
    return {
      date,
      day,
      total: dailyRevenue.get(date) ?? 0,
      expenses: dailyExpenses.get(date) ?? 0,
    };
  });

  const byProcedure = Array.from(byProcedureAccumulator.entries())
    .map(([name, payload]) => ({
      name,
      value: payload.value,
      count: payload.count,
    }))
    .sort((a, b) => b.value - a.value);

  res.json({
    monthlyTotal,
    monthlyExpenses,
    netTotal: monthlyTotal - monthlyExpenses,
    appointmentCount: completedAppointments.length,
    byProcedure,
    dailyPerformance,
  });
}));

app.use((error: unknown, req: Request, res: Response, next: NextFunction): void => {
  console.error("Erro nao tratado na API:", error);
  if (res.headersSent) {
    next(error);
    return;
  }

  const isDev = process.env.NODE_ENV !== "production";
  const message = isDev && error instanceof Error ? error.message : "Erro interno do servidor.";
  res.status(500).json({ error: message });
});

export default function handler(req: Request, res: Response) {
  return app(req, res);
}
