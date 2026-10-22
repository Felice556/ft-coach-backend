// Chi può vedere cosa: ogni trainer vede SOLO i propri clienti e i loro dati.
// Tutte le rotte del trainer passano da qui, così la regola è scritta in un posto solo.
import { Prisma } from '@prisma/client';
import { prisma } from './prisma.js';

// Schede gratis per chi si allena da solo (dalla quarta in poi servirà Liftio Pro).
export const LIMITE_SCHEDE_GRATIS = 3;

// Il cliente con questo id, solo se è un CLIENTE seguito da questo trainer (altrimenti null).
export function clienteDelTrainer(trainerId: number, clienteId: number) {
  return prisma.user.findFirst({ where: { id: clienteId, ruolo: 'CLIENTE', trainerId } });
}

// Filtro Prisma: "schede preparate da questo trainer per un cliente che è ANCORA suo".
// Se il cliente lo lascia, il trainer smette di vederle (restano al cliente, con lo storico).
export const schedeDelTrainer = (trainerId: number): Prisma.SchedaWhereInput => ({ trainerId, cliente: { trainerId } });

// Filtro Prisma: "esercizi delle schede di questo trainer" (stessa regola).
export const eserciziDelTrainer = (trainerId: number): Prisma.EsercizioWhereInput => ({ scheda: schedeDelTrainer(trainerId) });

// Filtro Prisma: "schede personali di questo cliente" (quelle che si è creato da solo).
export const schedePersonali = (clienteId: number): Prisma.SchedaWhereInput => ({ clienteId, personale: true });

// true se questo utente è un CLIENTE che si allena da solo (nessun trainer collegato).
export async function eAutonomo(userId: number): Promise<boolean> {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { ruolo: true, trainerId: true } });
  return u?.ruolo === 'CLIENTE' && u.trainerId === null;
}

// Schede che chi fa la richiesta può creare/modificare/archiviare:
// - il trainer: quelle preparate da lui per i suoi clienti;
// - il cliente che si allena da solo: le sue schede personali.
// null = nessuna (es. un cliente seguito da un trainer: le sue schede le decide il trainer).
export async function schedeGestibili(req: any): Promise<Prisma.SchedaWhereInput | null> {
  const userId = req.userId as number;
  if (req.ruolo === 'TRAINER') return schedeDelTrainer(userId);
  return (await eAutonomo(userId)) ? schedePersonali(userId) : null;
}

// Da quale giorno il trainer può vedere i dati di questo cliente (misure, cardio, passi, diario).
// null = nessun limite (clienti collegati da sempre). Restituisce l'inizio di quel giorno (UTC).
export async function visibileDal(clienteId: number): Promise<Date | null> {
  const u = await prisma.user.findUnique({ where: { id: clienteId }, select: { collegatoIl: true } });
  if (!u?.collegatoIl) return null;
  const d = new Date(u.collegatoIl);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

// La più recente tra due date (la seconda può mancare).
export const piuRecente = (a: Date, b: Date | null) => (b && b > a ? b : a);
