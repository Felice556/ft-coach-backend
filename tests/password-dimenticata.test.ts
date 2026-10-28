// "Password dimenticata?": link via email valido 30 minuti, usabile una volta, per tutti gli account.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { api, creaUtente, login, prisma, utentiDiPartenza, PASSWORD } from './aiuti';
import { intercettaEmail, type Email } from '../src/email';

let inviate: Email[] = [];
const codiceDallEmail = (e: Email) => new URL(e.testo.match(/https?:\/\/\S+/)![0]).searchParams.get('token')!;
// Ogni test usa un IP diverso, così il limite per rete (5 richieste in 15 minuti) non si somma tra i test.
let n = 0;
const ip = () => `10.9.${Math.floor(n / 200)}.${n++ % 200}`;
const chiedi = (email: string, lingua?: string) =>
  api().post('/password/dimenticata').set({ 'X-Forwarded-For': ip(), ...(lingua ? { 'Accept-Language': lingua } : {}) }).send({ email });
const reimposta = (token: string, nuovaPassword: string) =>
  api().post('/password/reimposta').set('X-Forwarded-For', ip()).send({ token, nuovaPassword });

describe('Password dimenticata', () => {
  beforeEach(async () => {
    await utentiDiPartenza();
    inviate = [];
    intercettaEmail((e) => inviate.push(e));
  });
  afterEach(() => intercettaEmail(null));

  it('chi si allena da solo riceve il link, cambia password e rientra solo con quella nuova', async () => {
    await creaUtente('Chiara Neri', 'chiara@test.com', 'CLIENTE');
    const r = await chiedi('Chiara@Test.com');
    expect(r.status).toBe(204);
    expect(inviate).toHaveLength(1);
    expect(inviate[0].a).toBe('chiara@test.com');
    expect(inviate[0].oggetto).toBe('Reimposta la password di Liftio');
    expect(inviate[0].testo).toContain('https://liftio.it/nuova-password?token=');
    // Nel database solo l'impronta, mai il codice del link.
    const codice = codiceDallEmail(inviate[0]);
    const riga = await prisma.resetPassword.findFirstOrThrow();
    expect(riga.tokenHash).not.toBe(codice);

    expect((await reimposta(codice, 'nuovaPassword1')).status).toBe(204);
    expect((await login('chiara@test.com', PASSWORD)).status).toBe(401);
    expect((await login('chiara@test.com', 'nuovaPassword1')).status).toBe(200);
  });

  it('funziona anche per i trainer', async () => {
    await chiedi('felice@test.com');
    expect(inviate).toHaveLength(1);
    expect((await reimposta(codiceDallEmail(inviate[0]), 'nuovaPassword1')).status).toBe(204);
    expect((await login('felice@test.com', 'nuovaPassword1')).status).toBe(200);
  });

  it('email sconosciuta: stessa risposta, nessuna email', async () => {
    const r = await chiedi('nessuno@test.com');
    expect(r.status).toBe(204);
    expect(inviate).toHaveLength(0);
  });

  it('account sospeso: nessuna email', async () => {
    await prisma.user.update({ where: { email: 'alessio@test.com' }, data: { sospeso: true } });
    expect((await chiedi('alessio@test.com')).status).toBe(204);
    expect(inviate).toHaveLength(0);
  });

  it('il link si usa una volta sola', async () => {
    await chiedi('alessio@test.com');
    const codice = codiceDallEmail(inviate[0]);
    expect((await reimposta(codice, 'nuovaPassword1')).status).toBe(204);
    const di_nuovo = await reimposta(codice, 'altraPassword2');
    expect(di_nuovo.status).toBe(400);
    expect(di_nuovo.body.errore).toBe('Il link non è valido o è scaduto: chiedine uno nuovo');
  });

  it('il link scade dopo 30 minuti', async () => {
    await chiedi('alessio@test.com');
    await prisma.resetPassword.updateMany({ data: { scadeIl: new Date(Date.now() - 1000) } });
    expect((await reimposta(codiceDallEmail(inviate[0]), 'nuovaPassword1')).status).toBe(400);
    const riga = await prisma.resetPassword.findFirstOrThrow();
    expect(riga.scadeIl.getTime() - riga.creatoIl.getTime()).toBeLessThanOrEqual(30 * 60 * 1000 + 1000);
  });

  it('un link nuovo annulla quello vecchio', async () => {
    await chiedi('alessio@test.com');
    await chiedi('alessio@test.com');
    expect(inviate).toHaveLength(2);
    expect((await reimposta(codiceDallEmail(inviate[0]), 'nuovaPassword1')).status).toBe(400);
    expect((await reimposta(codiceDallEmail(inviate[1]), 'nuovaPassword1')).status).toBe(204);
  });

  it('al massimo 3 link all’ora per persona', async () => {
    for (let i = 0; i < 5; i++) expect((await chiedi('alessio@test.com')).status).toBe(204);
    expect(inviate).toHaveLength(3);
  });

  it('codice inventato o password troppo corta: rifiutati', async () => {
    expect((await reimposta('codice-inventato-ma-lungo-abbastanza', 'nuovaPassword1')).status).toBe(400);
    await chiedi('alessio@test.com');
    const corta = await reimposta(codiceDallEmail(inviate[0]), 'corta');
    expect(corta.status).toBe(400);
    expect(corta.body.errori[0].message).toBe('La password deve avere almeno 8 caratteri');
  });

  it('dopo il cambio, i dispositivi già collegati vengono disconnessi', async () => {
    const vecchio = (await login('alessio@test.com')).body.token;
    expect((await api().get('/me').set('Authorization', `Bearer ${vecchio}`)).status).toBe(200);
    await chiedi('alessio@test.com');
    await reimposta(codiceDallEmail(inviate[0]), 'nuovaPassword1');
    expect((await api().get('/me').set('Authorization', `Bearer ${vecchio}`)).status).toBe(401);
  });

  it('chi usa l’app in inglese riceve l’email in inglese, con il link in inglese', async () => {
    await chiedi('alessio@test.com', 'en');
    expect(inviate[0].oggetto).toBe('Reset your Liftio password');
    expect(inviate[0].testo).toContain('&lang=en');
  });

  it('il nome nell’email non può inserire HTML', async () => {
    await prisma.user.update({ where: { email: 'alessio@test.com' }, data: { nome: '<b>Alessio</b>' } });
    await chiedi('alessio@test.com');
    expect(inviate[0].html).not.toContain('<b>Alessio</b>');
    expect(inviate[0].html).toContain('&lt;b&gt;Alessio&lt;/b&gt;');
  });

  it('eliminando l’account spariscono anche i suoi link', async () => {
    await chiedi('alessio@test.com');
    await prisma.user.delete({ where: { email: 'alessio@test.com' } });
    expect(await prisma.resetPassword.count()).toBe(0);
  });
});
