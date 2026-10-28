import { Router } from 'express';
import { randomBytes } from 'node:crypto';
import bcrypt from 'bcrypt';
import { z } from 'zod';
import { prisma } from '../prisma.js';
import { motivoSospensione } from '../middleware/auth.js';
import { limitePasswordDimenticata, limiteReimpostaPassword } from '../limiti.js';
import { linguaRichiesta } from '../traduzioni.js';
import { inviaEmail } from '../email.js';
import { emailReset } from '../email-testi.js';
import { impronta, indirizzoApp } from '../conferma-email.js';

// "Password dimenticata?" per TUTTI (anche chi si allena da solo e i trainer):
// 1) POST /password/dimenticata con l'email → se l'account esiste, parte un'email con un link;
// 2) il link apre liftio.it/nuova-password?token=… → POST /password/reimposta con il codice e la nuova password.
// Il link vale 30 minuti e una volta sola; chiederne uno nuovo annulla quelli precedenti.

const router = Router();

export const DURATA_LINK_MINUTI = 30;
// Al massimo 3 link all'ora per la stessa persona (oltre, la richiesta viene ignorata in silenzio).
export const MASSIMO_LINK_ORA = 3;

const UN_ORA = 60 * 60 * 1000;
const UN_GIORNO = 24 * UN_ORA;

const passwordSchema = z.string().min(8, 'La password deve avere almeno 8 caratteri').max(72);

const dimenticataSchema = z.object({
  email: z.string().trim().toLowerCase().email('Email non valida'),
});

router.post('/password/dimenticata', limitePasswordDimenticata, async (req, res) => {
  const risultato = dimenticataSchema.safeParse(req.body);
  if (!risultato.success) {
    res.status(400).json({ errori: risultato.error.issues });
    return;
  }
  const { email } = risultato.data;
  const lingua = linguaRichiesta(req);

  // Pulizia: i link di più di un giorno non servono più a niente.
  await prisma.resetPassword.deleteMany({ where: { creatoIl: { lt: new Date(Date.now() - UN_GIORNO) } } });

  const utente = await prisma.user.findFirst({
    where: { email: { equals: email, mode: 'insensitive' } },
    include: { trainer: { select: { sospeso: true } } },
  });

  // Account sospeso: niente email (non potrebbe comunque accedere).
  if (utente && !motivoSospensione(utente)) {
    const recenti = await prisma.resetPassword.count({
      where: { userId: utente.id, creatoIl: { gte: new Date(Date.now() - UN_ORA) } },
    });
    if (recenti < MASSIMO_LINK_ORA) {
      const adesso = new Date();
      // Il codice vero va solo nell'email; nel database ne salviamo l'impronta.
      const codice = randomBytes(32).toString('base64url');
      await prisma.$transaction([
        // Un link nuovo annulla quelli vecchi non ancora usati.
        prisma.resetPassword.updateMany({
          where: { userId: utente.id, usatoIl: null, scadeIl: { gt: adesso } },
          data: { scadeIl: adesso },
        }),
        prisma.resetPassword.create({
          data: {
            userId: utente.id,
            tokenHash: impronta(codice),
            scadeIl: new Date(adesso.getTime() + DURATA_LINK_MINUTI * 60 * 1000),
          },
        }),
      ]);
      const link = `${indirizzoApp()}/nuova-password?token=${codice}${lingua === 'en' ? '&lang=en' : ''}`;
      // Senza await: la risposta impiega lo stesso tempo che l'email esista o no.
      void inviaEmail(emailReset(utente.email, utente.nome, link, lingua, DURATA_LINK_MINUTI));
    }
  }

  // Sempre la stessa risposta: così nessuno scopre quali email sono registrate.
  res.status(204).send();
});

const reimpostaSchema = z.object({
  token: z.string().min(20).max(200),
  nuovaPassword: passwordSchema,
});

router.post('/password/reimposta', limiteReimpostaPassword, async (req, res) => {
  const risultato = reimpostaSchema.safeParse(req.body);
  if (!risultato.success) {
    // Un codice malformato è come un link non valido; gli altri errori (password corta) restano chiari.
    if (risultato.error.issues.some((i) => i.path[0] === 'token')) {
      res.status(400).json({ errore: 'Il link non è valido o è scaduto: chiedine uno nuovo' });
      return;
    }
    res.status(400).json({ errori: risultato.error.issues });
    return;
  }
  const { token, nuovaPassword } = risultato.data;
  const adesso = new Date();
  const link = await prisma.resetPassword.findUnique({ where: { tokenHash: impronta(token) } });
  if (!link || link.usatoIl || link.scadeIl <= adesso) {
    res.status(400).json({ errore: 'Il link non è valido o è scaduto: chiedine uno nuovo' });
    return;
  }

  await prisma.$transaction([
    prisma.user.update({
      where: { id: link.userId },
      data: {
        password: await bcrypt.hash(nuovaPassword, 10),
        passwordTemporanea: false,
        versioneToken: { increment: 1 }, // esce da tutti i dispositivi: chi aveva la vecchia password è fuori
      },
    }),
    prisma.resetPassword.update({ where: { id: link.id }, data: { usatoIl: adesso } }),
    // Gli altri link ancora validi della stessa persona non servono più.
    prisma.resetPassword.updateMany({
      where: { userId: link.userId, usatoIl: null, scadeIl: { gt: adesso } },
      data: { scadeIl: adesso },
    }),
  ]);
  res.status(204).send();
});

export default router;
