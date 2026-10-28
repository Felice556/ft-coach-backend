// Conferma dell'email dopo l'iscrizione: non blocca l'accesso, ma chi riceve un'iscrizione
// non sua può annullarla ("Non sono stato io"), solo finché l'email non è stata confermata.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { api, auth, creaUtente, login, prisma, utentiDiPartenza, token } from './aiuti';
import { intercettaEmail, type Email } from '../src/email';

let inviate: Email[] = [];
let n = 0;
const ip = () => `10.8.${Math.floor(n / 200)}.${n++ % 200}`;
const codice = (e: Email, pagina: 'conferma-email' | 'annulla-registrazione') =>
  new URL(e.testo.match(new RegExp(`https?://\\S+/${pagina}\\S*`))![0]).searchParams.get('token')!;
const registra = (email: string, extra: object = {}) =>
  api().post('/register').set('X-Forwarded-For', ip()).send({ nome: 'Nuovo Utente', email, password: 'password123', ...extra });
const conferma = (t: string) => api().post('/email/conferma').set('X-Forwarded-For', ip()).send({ token: t });
const annulla = (t: string) => api().post('/email/annulla').set('X-Forwarded-For', ip()).send({ token: t });

describe('Conferma email', () => {
  beforeEach(async () => {
    await utentiDiPartenza();
    inviate = [];
    intercettaEmail((e) => inviate.push(e));
  });
  afterEach(() => intercettaEmail(null));

  it('iscrizione: entra subito, riceve l’email con i due link e conferma', async () => {
    expect((await registra('nuovo@test.com')).status).toBe(201);
    expect(inviate).toHaveLength(1);
    expect(inviate[0].a).toBe('nuovo@test.com');
    expect(inviate[0].oggetto).toBe('Conferma la tua email su Liftio');
    const t = (await login('nuovo@test.com')).body.token;
    expect(t).toBeTruthy(); // l'accesso non è bloccato
    expect((await api().get('/me').set(auth(t))).body).toMatchObject({ email: 'nuovo@test.com', emailConfermata: false });

    const r = await conferma(codice(inviate[0], 'conferma-email'));
    expect(r.status).toBe(200);
    expect((await api().get('/me').set(auth(t))).body.emailConfermata).toBe(true);
    // Il link resta leggibile ("già confermata") ma non permette più di annullare.
    const info = await api().get('/email/link').query({ token: codice(inviate[0], 'conferma-email') });
    expect(info.body).toMatchObject({ confermata: true, annullabile: false });
    expect((await annulla(codice(inviate[0], 'annulla-registrazione'))).status).toBe(409);
    expect(await prisma.user.count({ where: { email: 'nuovo@test.com' } })).toBe(1);
  });

  it('"Non sono stato io": l’iscrizione mai confermata viene cancellata e l’email torna libera', async () => {
    await registra('vittima@test.com');
    const t = codice(inviate[0], 'annulla-registrazione');
    expect((await api().get('/email/link').query({ token: t })).body).toMatchObject({ email: 'vittima@test.com', confermata: false, annullabile: true });
    expect((await annulla(t)).status).toBe(204);
    expect(await prisma.user.count({ where: { email: 'vittima@test.com' } })).toBe(0);
    expect(await prisma.confermaEmail.count()).toBe(0);
    expect((await registra('vittima@test.com')).status).toBe(201);
  });

  it('cancella anche i dati che l’impostore ha inserito', async () => {
    await registra('vittima@test.com');
    const tI = (await login('vittima@test.com')).body.token;
    const m = await api().put('/misure').set(auth(tI)).send({ tipo: 'PESO', valore: 80, data: new Date().toISOString().slice(0, 10) });
    expect(m.status).toBeLessThan(300);
    expect(await prisma.misuraCorporea.count()).toBe(1);
    expect((await annulla(codice(inviate[0], 'annulla-registrazione'))).status).toBe(204);
    expect(await prisma.user.count({ where: { email: 'vittima@test.com' } })).toBe(0);
    expect(await prisma.misuraCorporea.count()).toBe(0);
  });

  it('il link scade dopo 7 giorni', async () => {
    await registra('nuovo@test.com');
    await prisma.confermaEmail.updateMany({ data: { scadeIl: new Date(Date.now() - 1000) } });
    expect((await conferma(codice(inviate[0], 'conferma-email'))).status).toBe(400);
    expect((await annulla(codice(inviate[0], 'annulla-registrazione'))).status).toBe(400);
  });

  it('codice inventato: rifiutato', async () => {
    expect((await conferma('codice-inventato-ma-lungo-abbastanza')).status).toBe(400);
    expect((await annulla('codice-inventato-ma-lungo-abbastanza')).status).toBe(400);
  });

  it('un trainer con clienti non si può annullare dal link', async () => {
    await registra('nuovotrainer@test.com', { ruolo: 'TRAINER', fasciaClienti: '1-10' });
    const trainer = await prisma.user.findUniqueOrThrow({ where: { email: 'nuovotrainer@test.com' } });
    await creaUtente('Cliente Suo', 'suo@test.com', 'CLIENTE', { trainerId: trainer.id });
    expect((await annulla(codice(inviate[0], 'annulla-registrazione'))).status).toBe(409);
  });

  it('gli account già esistenti (confermati) non sono annullabili', async () => {
    await prisma.user.updateMany({ data: { emailConfermataIl: new Date() } });
    const tA = await token('alessio@test.com');
    expect((await api().get('/me').set(auth(tA))).body.emailConfermata).toBe(true);
  });

  it('"Rimanda l’email": al massimo 3 all’ora, e non a chi ha già confermato', async () => {
    await registra('nuovo@test.com'); // 1ª
    const t = (await login('nuovo@test.com')).body.token;
    expect((await api().post('/email/rimanda').set(auth(t))).status).toBe(204); // 2ª
    expect((await api().post('/email/rimanda').set(auth(t))).status).toBe(204); // 3ª
    expect((await api().post('/email/rimanda').set(auth(t))).status).toBe(429);
    expect(inviate).toHaveLength(3);
    await conferma(codice(inviate[2], 'conferma-email'));
    expect((await api().post('/email/rimanda').set(auth(t))).body.errore).toBe('La tua email è già confermata');
  });

  it('cambio email: serve la password, va riconfermata, e i vecchi link non valgono più', async () => {
    await registra('sbagliata@gmal.com');
    const t = (await login('sbagliata@gmal.com')).body.token;
    const vecchio = codice(inviate[0], 'annulla-registrazione');
    expect((await api().put('/me/email').set(auth(t)).send({ email: 'giusta@gmail.com', password: 'sbagliata' })).status).toBe(400);
    expect((await api().put('/me/email').set(auth(t)).send({ email: 'alessio@test.com', password: 'password123' })).status).toBe(409);
    const r = await api().put('/me/email').set(auth(t)).send({ email: 'Giusta@Gmail.com', password: 'password123' });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ email: 'giusta@gmail.com', emailConfermata: false });
    expect(inviate.at(-1)!.a).toBe('giusta@gmail.com');
    // Il link mandato all'indirizzo sbagliato non può più cancellare l'account.
    expect((await annulla(vecchio)).status).toBe(400);
    expect((await conferma(codice(inviate.at(-1)!, 'conferma-email'))).status).toBe(200);
    expect((await login('giusta@gmail.com')).status).toBe(200);
  });

  it('il trainer vede chi non ha confermato; se corregge l’email del cliente parte una nuova conferma', async () => {
    const tF = await token('felice@test.com');
    await prisma.user.update({ where: { email: 'giulia@test.com' }, data: { emailConfermataIl: new Date() } });
    const elenco = (await api().get('/clienti').set(auth(tF))).body;
    expect(elenco.find((c: { email: string }) => c.email === 'alessio@test.com').emailConfermata).toBe(false);
    expect(elenco.find((c: { email: string }) => c.email === 'giulia@test.com').emailConfermata).toBe(true);
    const giulia = await prisma.user.findUniqueOrThrow({ where: { email: 'giulia@test.com' } });
    const r = await api().put(`/clienti/${giulia.id}/email`).set(auth(tF)).send({ email: 'giulia.nuova@test.com' });
    expect(r.body).toMatchObject({ email: 'giulia.nuova@test.com', emailConfermata: false });
    expect(inviate.at(-1)!.a).toBe('giulia.nuova@test.com');
  });

  it('email già registrata: il messaggio suggerisce "Password dimenticata?"', async () => {
    const r = await registra('Alessio@Test.com');
    expect(r.status).toBe(400);
    expect(r.body.errore).toContain('Password dimenticata?');
    expect(inviate).toHaveLength(0);
  });
});
