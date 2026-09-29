import { Request } from 'express';
import { rateLimit, ipKeyGenerator } from 'express-rate-limit';

// Limiti ai tentativi: fermano chi prova migliaia di password o crea account a raffica.
// I conteggi stanno in memoria: se il server si riavvia ripartono da zero (va bene così).
//
// Attenzione al Wi-Fi della palestra: tutti i clienti escono dallo STESSO indirizzo IP.
// Per questo il limite del login conta solo i tentativi SBAGLIATI e per coppia IP + email:
// un cliente che sbaglia la password non blocca gli altri.

const QUINDICI_MINUTI = 15 * 60 * 1000;
const UN_ORA = 60 * 60 * 1000;

function risposta(testo: string) {
  return (_req: Request, res: import('express').Response) => {
    res.status(429).json({ errore: testo });
  };
}

// IP del visitatore (su Render arriva tramite proxy: vedi app.set('trust proxy') in server.ts).
// ipKeyGenerator raggruppa gli indirizzi IPv6 della stessa rete, così non si aggira cambiandoli.
const ip = (req: Request) => ipKeyGenerator(req.ip ?? 'sconosciuto');
const emailDellaRichiesta = (req: Request) =>
  typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';

// Login: massimo 8 password sbagliate in 15 minuti per la stessa email dallo stesso IP.
export const limiteLoginPerIp = rateLimit({
  windowMs: QUINDICI_MINUTI,
  limit: 8,
  skipSuccessfulRequests: true, // gli accessi riusciti non contano
  keyGenerator: (req) => `${ip(req)}|${emailDellaRichiesta(req)}`,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler: risposta('Troppi tentativi sbagliati. Riprova tra 15 minuti.'),
});

// Login: massimo 30 password sbagliate in un'ora sulla stessa email da QUALSIASI indirizzo
// (chi prova password da tanti computer diversi viene fermato lo stesso).
export const limiteLoginPerEmail = rateLimit({
  windowMs: UN_ORA,
  limit: 30,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => `email|${emailDellaRichiesta(req)}`,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler: risposta('Troppi tentativi sbagliati su questo account. Riprova tra un’ora o chiedi al tuo trainer.'),
});

// Registrazione: massimo 20 account nuovi all'ora dallo stesso indirizzo
// (basta per iscrivere un gruppo in palestra, blocca chi crea account a raffica
// o prova a indovinare i codici invito).
export const limiteRegistrazione = rateLimit({
  windowMs: UN_ORA,
  limit: 20,
  keyGenerator: (req) => ip(req),
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler: risposta('Troppe registrazioni da questa rete. Riprova tra un’ora.'),
});

// Cambio password: massimo 10 tentativi in 15 minuti (chi trova un telefono sbloccato
// non può provare all'infinito la password attuale).
export const limiteCambioPassword = rateLimit({
  windowMs: QUINDICI_MINUTI,
  limit: 10,
  keyGenerator: (req) => ip(req),
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler: risposta('Troppi tentativi. Riprova tra 15 minuti.'),
});

// Limite generale molto largo: un uso normale non ci arriva mai, ma ferma
// uno script che bombarda il server di richieste.
export const limiteGenerale = rateLimit({
  windowMs: 60 * 1000,
  limit: 600,
  keyGenerator: (req) => ip(req),
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler: risposta('Troppe richieste in poco tempo. Riprova tra un minuto.'),
});
