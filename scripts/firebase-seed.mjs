import fs from "node:fs";
import path from "node:path";
import { config as loadEnv } from "dotenv";
import Database from "better-sqlite3";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

for (const envFile of [".env.local", ".env"]) {
  const fullPath = path.resolve(process.cwd(), envFile);
  if (fs.existsSync(fullPath)) {
    loadEnv({ path: fullPath, override: false });
  }
}

const projectId = process.env.FIREBASE_PROJECT_ID?.trim();
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL?.trim();
const privateKeyRaw = process.env.FIREBASE_PRIVATE_KEY?.trim();
const privateKeyB64 = process.env.FIREBASE_PRIVATE_KEY_B64?.trim();

let privateKey = null;
if (privateKeyRaw) {
  privateKey = privateKeyRaw.replace(/\\n/g, "\n").trim();
} else if (privateKeyB64) {
  try {
    privateKey = Buffer.from(privateKeyB64, "base64").toString("utf8").replace(/\\n/g, "\n").trim();
  } catch {
    privateKey = null;
  }
}

const missing = [];
if (!projectId) missing.push("FIREBASE_PROJECT_ID");
if (!clientEmail) missing.push("FIREBASE_CLIENT_EMAIL");
if (!privateKey) missing.push("FIREBASE_PRIVATE_KEY (ou FIREBASE_PRIVATE_KEY_B64)");

if (missing.length > 0) {
  console.error(`Variaveis ausentes: ${missing.join(", ")}`);
  console.error("Preencha o .env.local antes de executar este script.");
  process.exit(1);
}

if (!getApps().length) {
  initializeApp({
    credential: cert({
      projectId,
      clientEmail,
      privateKey,
    }),
  });
}

const firestoreDatabaseId = process.env.FIREBASE_DATABASE_ID?.trim() || "(default)";
const firestore = firestoreDatabaseId === "(default)" ? getFirestore() : getFirestore(firestoreDatabaseId);
const sqlitePath = process.env.SQLITE_PATH?.trim() || "estetica.db";
const sqlite = new Database(sqlitePath, { readonly: true });

const parseJsonArray = (value) => {
  if (typeof value !== "string" || value.trim().length === 0) {
    return [];
  }

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const toNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const mapClient = (row) => ({
  id: toNumber(row.id),
  name: row.name ?? "",
  phone: row.phone ?? null,
  email: row.email ?? null,
  birth_date: row.birth_date ?? null,
  notes: row.notes ?? null,
  profile_photo: row.profile_photo ?? null,
  attachments: parseJsonArray(row.attachments),
  created_at: row.created_at ?? null,
  source: "sqlite",
});

const mapProcedure = (row) => ({
  id: toNumber(row.id),
  name: row.name ?? "",
  description: row.description ?? null,
  price: toNumber(row.price),
  duration: toNumber(row.duration),
  cover_photo: row.cover_photo ?? null,
  attachments: parseJsonArray(row.attachments),
  active: toNumber(row.active, 1) === 1,
  source: "sqlite",
});

const mapAppointment = (row) => ({
  id: toNumber(row.id),
  client_id: toNumber(row.client_id),
  procedure_id: toNumber(row.procedure_id),
  appointment_date: row.appointment_date ?? null,
  appointment_time: row.appointment_time ?? null,
  status: row.status ?? "scheduled",
  notes: row.notes ?? null,
  source: "sqlite",
});

const mapExpense = (row) => ({
  id: toNumber(row.id),
  description: row.description ?? "",
  category: row.category ?? null,
  amount: toNumber(row.amount),
  expense_date: row.expense_date ?? null,
  notes: row.notes ?? null,
  created_at: row.created_at ?? null,
  source: "sqlite",
});

const toDocs = (items, mapper) =>
  items.map((item) => {
    const mapped = mapper(item);
    return {
      docId: String(mapped.id),
      data: mapped,
    };
  });

async function writeInBatches(collectionName, docs) {
  const BATCH_SIZE = 400;

  for (let i = 0; i < docs.length; i += BATCH_SIZE) {
    const chunk = docs.slice(i, i + BATCH_SIZE);
    const batch = firestore.batch();

    for (const doc of chunk) {
      const ref = firestore.collection(collectionName).doc(doc.docId);
      batch.set(ref, doc.data, { merge: true });
    }

    await batch.commit();
    console.log(`${collectionName}: ${Math.min(i + BATCH_SIZE, docs.length)}/${docs.length}`);
  }
}

async function main() {
  console.log("Iniciando migracao para Firebase Firestore...");
  console.log(`Banco local: ${sqlitePath}`);
  console.log(`Projeto Firebase: ${projectId} | Database: ${firestoreDatabaseId}`);

  const clients = sqlite.prepare("SELECT * FROM clients ORDER BY id ASC").all();
  const procedures = sqlite.prepare("SELECT * FROM procedures ORDER BY id ASC").all();
  const appointments = sqlite.prepare("SELECT * FROM appointments ORDER BY id ASC").all();
  const expenses = sqlite.prepare("SELECT * FROM expenses ORDER BY id ASC").all();

  await writeInBatches("clients", toDocs(clients, mapClient));
  await writeInBatches("procedures", toDocs(procedures, mapProcedure));
  await writeInBatches("appointments", toDocs(appointments, mapAppointment));
  await writeInBatches("expenses", toDocs(expenses, mapExpense));

  await firestore.collection("_meta").doc("migration").set(
    {
      source: "sqlite",
      sqlitePath,
      lastMigrationAt: new Date().toISOString(),
      counts: {
        clients: clients.length,
        procedures: procedures.length,
        appointments: appointments.length,
        expenses: expenses.length,
      },
    },
    { merge: true },
  );

  sqlite.close();
  console.log("Migracao concluida com sucesso.");
}

main().catch((error) => {
  console.error("Falha ao migrar dados para o Firestore:", error);
  try {
    sqlite.close();
  } catch {
    // noop
  }
  process.exit(1);
});

