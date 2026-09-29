// Strumenti comuni ai test: richieste all'app, database pulito, utenti di partenza.
import request from 'supertest';
import bcrypt from 'bcrypt';
import app from '../src/app';
import { prisma } from '../src/prisma';

export { prisma };
export const api = () => request(app);

export const PASSWORD = 'password123';

// Svuota tutte le tabelle (il controllo in setup.ts garantisce che è il database di prova).
export async function databasePulito() {
  const tabelle = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  const elenco = tabelle.map((t) => `"public"."${t.tablename}"`).join(', ');
  if (elenco) await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${elenco} RESTART IDENTITY CASCADE`);
}

let hash: string | null = null;
async function hashPassword() {
  hash ??= await bcrypt.hash(PASSWORD, 10);
  return hash;
}

export async function creaUtente(nome: string, email: string, ruolo: 'TRAINER' | 'CLIENTE') {
  return prisma.user.create({ data: { nome, email, ruolo, password: await hashPassword() } });
}

// Un trainer e due clienti, come nella vita reale.
export async function utentiDiPartenza() {
  await databasePulito();
  const trainer = await creaUtente('Felice', 'felice@test.com', 'TRAINER');
  const alessio = await creaUtente('Alessio', 'alessio@test.com', 'CLIENTE');
  const giulia = await creaUtente('Giulia', 'giulia@test.com', 'CLIENTE');
  return { trainer, alessio, giulia };
}

// Login: restituisce il token. `ip` serve a simulare reti diverse (limiti ai tentativi).
export async function login(email: string, password = PASSWORD, ip?: string) {
  const r = await api()
    .post('/login')
    .set(ip ? { 'X-Forwarded-For': ip } : {})
    .send({ email, password });
  return r;
}

export async function token(email: string, password = PASSWORD) {
  const r = await login(email, password);
  if (r.status !== 200) throw new Error(`Login di ${email} fallito: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body.token as string;
}

export const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

// Una scheda semplice per un cliente.
export function schedaDiProva(clienteId: number, esercizi?: object[]) {
  return {
    nome: 'Full Body A',
    clienteId,
    esercizi: esercizi ?? [
      { nome: 'Panca piana', serieTarget: 2, repsTarget: 6, repsMax: 9, recuperoSecondi: 150 },
      { nome: 'Squat', serieTarget: 3, repsTarget: 8, recuperoSecondi: 120 },
    ],
  };
}

// Mezzanotte di oggi, come la manda il frontend per chiudere l'allenamento del giorno.
export function inizioGiornata() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}
