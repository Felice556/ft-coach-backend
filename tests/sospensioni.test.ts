// Sospendere senza cancellare: l'amministratore sospende un trainer (e i suoi clienti restano fuori),
// un trainer sospende un suo cliente. Si può sempre riattivare e nessun dato va perso.
import { beforeEach, describe, expect, it } from 'vitest';
import { altroTrainerConCliente, api, auth, login, prisma, schedaDiProva, token, utentiDiPartenza } from './aiuti';

let ids: Awaited<ReturnType<typeof utentiDiPartenza>> & Awaited<ReturnType<typeof altroTrainerConCliente>>;
let tF: string, tM: string, tA: string, tP: string;

beforeEach(async () => {
  ids = { ...(await utentiDiPartenza()), ...(await altroTrainerConCliente()) };
  [tF, tM, tA, tP] = await Promise.all(
    ['felice@test.com', 'marta@test.com', 'alessio@test.com', 'paolo@test.com'].map((e) => token(e)),
  );
});

describe('Il trainer sospende un suo cliente', () => {
  it('sospeso: non accede più (nemmeno con un accesso già aperto), i dati restano; riattivato torna tutto', async () => {
    const scheda = (await api().post('/schede').set(auth(tF)).send(schedaDiProva(ids.alessio.id))).body;
    await api().post('/registro').set(auth(tA)).send({ esercizioId: scheda.esercizi[0].id, pesoUsato: 60, repsFatte: 8 });

    const r = await api().post(`/clienti/${ids.alessio.id}/sospendi`).set(auth(tF));
    expect(r.status).toBe(200);
    expect(r.body.sospeso).toBe(true);

    // L'accesso già aperto non funziona più
    const bloccato = await api().get('/schede').set(auth(tA));
    expect(bloccato.status).toBe(403);
    expect(bloccato.body.codice).toBe('SOSPESO');
    expect(bloccato.body.errore).toMatch(/contatta il tuo trainer/);
    // E non può rientrare
    const l = await login('alessio@test.com');
    expect(l.status).toBe(403);
    expect(l.body.token).toBeUndefined();
    // Password sbagliata: risposta "normale", non si scopre che è sospeso
    expect((await login('alessio@test.com', 'sbagliata')).status).toBe(401);

    // Il trainer lo vede come sospeso e vede ancora schede e serie
    const clienti = await api().get('/clienti').set(auth(tF));
    expect(clienti.body.find((c: any) => c.id === ids.alessio.id).sospeso).toBe(true);
    expect((await api().get(`/schede/${scheda.id}/storico`).set(auth(tF))).status).toBe(200);
    expect(await prisma.registroAllenamento.count({ where: { clienteId: ids.alessio.id } })).toBe(1);
    // Giulia (stesso trainer) non è toccata
    expect((await login('giulia@test.com')).status).toBe(200);

    // Riattivato: rientra e trova tutto
    expect((await api().post(`/clienti/${ids.alessio.id}/riattiva`).set(auth(tF))).body.sospeso).toBe(false);
    expect((await api().get('/schede').set(auth(tA))).status).toBe(200);
  });

  it('un trainer non può sospendere i clienti di un altro trainer, né un cliente può sospendere qualcuno', async () => {
    expect((await api().post(`/clienti/${ids.alessio.id}/sospendi`).set(auth(tM))).status).toBe(404);
    expect((await api().post(`/clienti/${ids.giulia.id}/sospendi`).set(auth(tA))).status).toBe(403);
    expect((await prisma.user.findUnique({ where: { id: ids.alessio.id } }))?.sospeso).toBe(false);
    expect((await prisma.user.findUnique({ where: { id: ids.giulia.id } }))?.sospeso).toBe(false);
  });
});

describe("L'amministratore sospende un trainer", () => {
  it('sospeso: il trainer e i suoi clienti restano fuori, i suoi inviti non valgono; gli altri non sono toccati', async () => {
    const invito = (await api().post('/inviti').set(auth(tM)).send({ nota: 'Futuro cliente' })).body;
    expect((await api().post(`/admin/trainer/${ids.marta.id}/sospendi`).set(auth(tF))).status).toBe(204);

    const m = await api().get('/clienti').set(auth(tM));
    expect(m.status).toBe(403);
    expect(m.body.codice).toBe('SOSPESO');
    const p = await api().get('/schede').set(auth(tP));
    expect(p.status).toBe(403);
    expect(p.body.errore).toMatch(/trainer al momento non è attivo/);
    expect((await login('marta@test.com')).status).toBe(403);
    expect((await login('paolo@test.com')).status).toBe(403);
    // Con l'invito di Marta non ci si registra più
    const reg = await api().post('/register').send({ nome: 'Nuovo', email: 'nuovo@test.com', password: 'password123', codiceInvito: invito.codice });
    expect(reg.status).toBe(400);

    // Felice e i suoi clienti lavorano normalmente; la panoramica mostra Marta sospesa
    expect((await api().get('/schede').set(auth(tA))).status).toBe(200);
    const pan = await api().get('/admin/trainer').set(auth(tF));
    expect(pan.body.trainer.find((t: any) => t.id === ids.marta.id).sospeso).toBe(true);
    // Nessun dato cancellato
    expect(await prisma.user.count({ where: { trainerId: ids.marta.id } })).toBe(1);

    // Riattivata: tutto come prima
    expect((await api().post(`/admin/trainer/${ids.marta.id}/riattiva`).set(auth(tF))).status).toBe(204);
    expect((await api().get('/clienti').set(auth(tM))).status).toBe(200);
    expect((await api().get('/schede').set(auth(tP))).status).toBe(200);
  });

  it("solo l'amministratore può sospendere trainer, e non può sospendere sé stesso né un cliente", async () => {
    expect((await api().post(`/admin/trainer/${ids.trainer.id}/sospendi`).set(auth(tM))).status).toBe(403);
    expect((await api().post(`/admin/trainer/${ids.trainer.id}/sospendi`).set(auth(tF))).status).toBe(404);
    expect((await api().post(`/admin/trainer/${ids.alessio.id}/sospendi`).set(auth(tF))).status).toBe(404);
    expect((await api().post(`/admin/trainer/${ids.marta.id}/sospendi`).set(auth(tA))).status).toBe(403);
    expect(await prisma.user.count({ where: { sospeso: true } })).toBe(0);
  });
});
