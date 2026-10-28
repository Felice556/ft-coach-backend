import crypto from 'node:crypto';
import { prisma } from './prisma.js';
import { inviaEmail } from './email.js';
import { emailConferma } from './email-testi.js';

// Email "Conferma il tuo indirizzo" dopo l'iscrizione (o dopo un cambio di email).
// Il link vale 7 giorni e porta a due azioni: confermare, oppure "Non sono stato io" per
// annullare un'iscrizione fatta da qualcun altro con questa email (solo se mai confermata).

export const GIORNI_LINK_CONFERMA = 7;
// Al massimo 3 email di conferma all'ora per la stessa persona ("Rimanda l'email").
export const MASSIMO_CONFERME_ORA = 3;

const UN_ORA = 60 * 60 * 1000;
const UN_GIORNO = 24 * UN_ORA;

export const impronta = (codice: string) => crypto.createHash('sha256').update(codice).digest('hex');

// Indirizzo dell'app per i link nelle email (su Render si può cambiare con APP_URL).
export const indirizzoApp = () => (process.env.APP_URL || 'https://liftio.it').replace(/\/+$/, '');

// Crea il link e manda l'email. Restituisce false se la persona ne ha già chieste troppe in un'ora.
// L'email parte senza attendere: chi si registra non aspetta i tempi del servizio di posta.
export async function mandaConfermaEmail(utente: { id: number; nome: string; email: string }, lingua: 'it' | 'en') {
  const adesso = new Date();
  // Pulizia: i link di più di 30 giorni non servono più a niente.
  await prisma.confermaEmail.deleteMany({ where: { creatoIl: { lt: new Date(adesso.getTime() - 30 * UN_GIORNO) } } });
  const recenti = await prisma.confermaEmail.count({
    where: { userId: utente.id, creatoIl: { gte: new Date(adesso.getTime() - UN_ORA) } },
  });
  if (recenti >= MASSIMO_CONFERME_ORA) return false;

  const codice = crypto.randomBytes(32).toString('base64url');
  await prisma.confermaEmail.create({
    data: {
      userId: utente.id,
      email: utente.email,
      tokenHash: impronta(codice),
      scadeIl: new Date(adesso.getTime() + GIORNI_LINK_CONFERMA * UN_GIORNO),
    },
  });
  const lang = lingua === 'en' ? '&lang=en' : '';
  const conferma = `${indirizzoApp()}/conferma-email?token=${codice}${lang}`;
  const annulla = `${indirizzoApp()}/annulla-registrazione?token=${codice}${lang}`;
  void inviaEmail(emailConferma(utente.email, utente.nome, conferma, annulla, lingua, GIORNI_LINK_CONFERMA));
  return true;
}

// Il link è valido se esiste, non è scaduto e l'account ha ancora la stessa email a cui è stato mandato.
// (usatoIl non conta qui: un link già usato per confermare può ancora dire "già confermata".)
export async function leggiLinkConferma(codice: string) {
  const link = await prisma.confermaEmail.findUnique({
    where: { tokenHash: impronta(codice) },
    include: { user: { select: { id: true, nome: true, email: true, ruolo: true, admin: true, emailConfermataIl: true } } },
  });
  if (!link || link.scadeIl <= new Date()) return null;
  if (link.user.email.toLowerCase() !== link.email.toLowerCase()) return null;
  return link;
}
