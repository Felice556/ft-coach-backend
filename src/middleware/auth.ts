import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { Ruolo } from '@prisma/client';
import { prisma } from '../prisma.js';

const JWT_SECRET = process.env.JWT_SECRET!;

// Dati che mettiamo dentro il token al login.
export interface DatiToken {
  userId: number;
  ruolo: Ruolo;
  v?: number; // versione del token: deve coincidere con User.versioneToken (i token vecchi non ce l'hanno = 0)
}

// Crea il token di accesso (valido 30 giorni: il cliente non rifà il login ogni settimana in palestra).
export function creaToken(utente: { id: number; ruolo: Ruolo; versioneToken: number }): string {
  const dati: DatiToken = { userId: utente.id, ruolo: utente.ruolo, v: utente.versioneToken };
  return jwt.sign(dati, JWT_SECRET, { expiresIn: '30d' });
}

// Rotte che si possono usare anche con una password temporanea (serve per cambiarla).
const PERMESSE_CON_PASSWORD_TEMPORANEA = new Set(['/me/password']);

// Legge l'header, verifica il token e "allega" i dati dell'utente alla request.
// In più controlla nel database che l'utente esista ancora e che il token non sia
// stato revocato: dopo un cambio o reset della password, versioneToken sale di 1 e
// tutti gli accessi precedenti (es. un telefono perso) smettono di funzionare.
export async function autentica(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    res.status(401).json({ errore: 'Token mancante' });
    return;
  }

  let payload: DatiToken;
  try {
    payload = jwt.verify(authHeader.split(' ')[1], JWT_SECRET) as unknown as DatiToken;
  } catch {
    res.status(401).json({ errore: 'Token non valido o scaduto' });
    return;
  }

  const utente = await prisma.user.findUnique({
    where: { id: payload.userId },
    select: { ruolo: true, versioneToken: true, passwordTemporanea: true },
  });
  if (!utente || (payload.v ?? 0) !== utente.versioneToken) {
    res.status(401).json({ errore: 'Sessione non più valida, accedi di nuovo' });
    return;
  }

  // Password impostata dal trainer: finché l'utente non ne sceglie una sua, può solo cambiarla.
  if (utente.passwordTemporanea && !PERMESSE_CON_PASSWORD_TEMPORANEA.has(req.path)) {
    res.status(403).json({ errore: 'Devi prima scegliere una nuova password', codice: 'CAMBIO_PASSWORD' });
    return;
  }

  (req as any).userId = payload.userId;
  // Il ruolo lo prendiamo dal database, non dal token: è sempre quello attuale.
  (req as any).ruolo = utente.ruolo;
  next();
}

// Non basta essere autenticati: serve anche il ruolo giusto per quella rotta.
// Uso: router.post('/schede', autentica, richiedeRuolo('TRAINER'), handler)
export function richiedeRuolo(...ruoliAmmessi: Ruolo[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const ruolo = (req as any).ruolo as Ruolo;
    if (!ruoliAmmessi.includes(ruolo)) {
      res.status(403).json({ errore: 'Non hai i permessi per questa azione' });
      return;
    }
    next();
  };
}
