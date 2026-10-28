import { Router } from 'express';
import bcrypt from 'bcrypt';
import { z } from 'zod';
import { prisma } from '../prisma.js';
import { autentica } from '../middleware/auth.js';
import { limiteCambioPassword, limiteLinkEmail } from '../limiti.js';
import { linguaRichiesta } from '../traduzioni.js';
import { cancellaAccount } from '../elimina-account.js';
import { leggiLinkConferma, mandaConfermaEmail } from '../conferma-email.js';

// Conferma dell'email (vedi conferma-email.ts):
// - GET  /email/link?token=…   cosa dice il link (nome, email, se è già confermata, se si può annullare)
// - POST /email/conferma        "Conferma la mia email"
// - POST /email/annulla         "Non sono stato io": cancella l'account, SOLO se l'email non è mai stata confermata
// - POST /email/rimanda         (dall'app) manda di nuovo l'email di conferma
// - PUT  /me/email              (dall'app) cambia la propria email (serve la password) e manda la conferma al nuovo indirizzo

const router = Router();

const LINK_NON_VALIDO = 'Il link non è valido o è scaduto';
const tokenSchema = z.object({ token: z.string().min(20).max(200) });

// Si può annullare solo un'iscrizione mai confermata, e non l'amministratore
// o un trainer che ha già dei clienti (i loro account non si toccano).
async function motivoNonAnnullabile(u: { id: number; ruolo: string; admin: boolean; emailConfermataIl: Date | null }) {
  if (u.emailConfermataIl) return 'Questa email è già stata confermata: l’account non si può annullare da qui';
  if (u.admin) return "L'account amministratore non si può eliminare dall'app";
  if (u.ruolo === 'TRAINER' && (await prisma.user.count({ where: { trainerId: u.id } })) > 0) {
    return 'Questo account ha già dei clienti collegati: scrivi all’amministratore di Liftio';
  }
  return null;
}

router.get('/email/link', limiteLinkEmail, async (req, res) => {
  const risultato = tokenSchema.safeParse({ token: req.query.token });
  const link = risultato.success ? await leggiLinkConferma(risultato.data.token) : null;
  if (!link) {
    res.status(400).json({ errore: LINK_NON_VALIDO });
    return;
  }
  res.json({
    nome: link.user.nome,
    email: link.user.email,
    confermata: link.user.emailConfermataIl !== null,
    annullabile: (await motivoNonAnnullabile(link.user)) === null,
  });
});

router.post('/email/conferma', limiteLinkEmail, async (req, res) => {
  const risultato = tokenSchema.safeParse(req.body);
  const link = risultato.success ? await leggiLinkConferma(risultato.data.token) : null;
  if (!link) {
    res.status(400).json({ errore: LINK_NON_VALIDO });
    return;
  }
  if (!link.user.emailConfermataIl) {
    const adesso = new Date();
    await prisma.$transaction([
      prisma.user.update({ where: { id: link.user.id }, data: { emailConfermataIl: adesso } }),
      prisma.confermaEmail.update({ where: { id: link.id }, data: { usatoIl: adesso } }),
    ]);
  }
  res.json({ confermata: true, nome: link.user.nome });
});

router.post('/email/annulla', limiteLinkEmail, async (req, res) => {
  const risultato = tokenSchema.safeParse(req.body);
  const link = risultato.success ? await leggiLinkConferma(risultato.data.token) : null;
  if (!link) {
    res.status(400).json({ errore: LINK_NON_VALIDO });
    return;
  }
  const motivo = await motivoNonAnnullabile(link.user);
  if (motivo) {
    res.status(409).json({ errore: motivo });
    return;
  }
  await cancellaAccount(link.user as { id: number; ruolo: 'TRAINER' | 'CLIENTE' });
  res.status(204).send();
});

router.post('/email/rimanda', autentica, async (req, res) => {
  const utente = await prisma.user.findUnique({ where: { id: (req as any).userId as number } });
  if (!utente) {
    res.status(404).json({ errore: 'Utente non trovato' });
    return;
  }
  if (utente.emailConfermataIl) {
    res.status(400).json({ errore: 'La tua email è già confermata' });
    return;
  }
  if (!(await mandaConfermaEmail(utente, linguaRichiesta(req)))) {
    res.status(429).json({ errore: 'Ti abbiamo già mandato diverse email: controlla anche lo spam, o riprova tra un’ora' });
    return;
  }
  res.status(204).send();
});

const cambioEmailSchema = z.object({
  email: z.string().trim().toLowerCase().email('Email non valida').max(254),
  password: z.string().min(1, 'Scrivi la tua password').max(200),
});

router.put('/me/email', limiteCambioPassword, autentica, async (req, res) => {
  const risultato = cambioEmailSchema.safeParse(req.body);
  if (!risultato.success) {
    res.status(400).json({ errori: risultato.error.issues });
    return;
  }
  const { email, password } = risultato.data;
  const utente = await prisma.user.findUnique({ where: { id: (req as any).userId as number } });
  if (!utente) {
    res.status(404).json({ errore: 'Utente non trovato' });
    return;
  }
  // La password serve: chi trova un telefono sbloccato non può spostare l'account su un'altra email.
  if (!(await bcrypt.compare(password, utente.password))) {
    res.status(400).json({ errore: 'La password non è corretta' });
    return;
  }
  if (email === utente.email.toLowerCase()) {
    res.status(400).json({ errore: 'È già la tua email' });
    return;
  }
  const giaUsata = await prisma.user.findFirst({ where: { email: { equals: email, mode: 'insensitive' }, NOT: { id: utente.id } } });
  if (giaUsata) {
    res.status(409).json({ errore: 'Questa email è già usata da un altro account' });
    return;
  }
  // La nuova email va confermata di nuovo; i link mandati al vecchio indirizzo smettono di valere.
  const aggiornato = await prisma.user.update({
    where: { id: utente.id },
    data: { email, emailConfermataIl: null },
  });
  await mandaConfermaEmail(aggiornato, linguaRichiesta(req));
  res.json({ email: aggiornato.email, emailConfermata: false });
});

export default router;
