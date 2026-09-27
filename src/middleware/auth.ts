import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { Ruolo } from '@prisma/client';

const JWT_SECRET = process.env.JWT_SECRET!;

// Stesso pattern del task manager: legge l'header, verifica il token,
// e "allega" i dati dell'utente alla request per le rotte successive.
export function autentica(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    res.status(401).json({ errore: 'Token mancante' });
    return;
  }

  const token = authHeader.split(' ')[1];
  try {
    const payload = jwt.verify(token, JWT_SECRET) as unknown as {
      userId: number;
      ruolo: Ruolo;
    };
    (req as any).userId = payload.userId;
    (req as any).ruolo = payload.ruolo;
    next();
  } catch {
    res.status(401).json({ errore: 'Token non valido o scaduto' });
  }
}

// Novità rispetto al task manager: non basta essere autenticati,
// serve anche avere il ruolo giusto per quella rotta.
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
