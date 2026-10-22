// Clienti che si allenano da soli: creano le loro schede (le prime 3 gratis; il "Pro" per ora è solo un avviso).
// Possono collegarsi a un trainer (le loro schede vanno in pausa) e lasciarlo (tornano attive).
// Il trainer vede i dati solo da quando il cliente è suo; NIENTE viene mai cancellato.
import { beforeEach, describe, expect, it } from 'vitest';
import { altroTrainerConCliente, api, auth, creaUtente, prisma, schedaDiProva, token, utentiDiPartenza } from './aiuti';

let ids: Awaited<ReturnType<typeof utentiDiPartenza>> & Awaited<ReturnType<typeof altroTrainerConCliente>>;
let tF: string, tM: string, tA: string, tS: string;
let sara: { id: number };

const oggi = () => new Date().toISOString().slice(0, 10);
const giorniFa = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
const mia = (nome = 'Scheda mia') => ({ ...schedaDiProva(0), clienteId: undefined, nome });
const codiceDi = async (t: string) => (await api().post('/inviti').set(auth(t)).send({})).body.codice as string;
const collega = (t: string, codiceInvito: string) => api().post('/me/trainer').set(auth(t)).send({ codiceInvito });
const lascia = (t: string, password = 'password123') => api().delete('/me/trainer').set(auth(t)).send({ password });

beforeEach(async () => {
  ids = { ...(await utentiDiPartenza()), ...(await altroTrainerConCliente()) };
  sara = await creaUtente('Sara', 'sara@test.com', 'CLIENTE'); // nessun trainer: si allena da sola
  [tF, tM, tA, tS] = await Promise.all(['felice@test.com', 'marta@test.com', 'alessio@test.com', 'sara@test.com'].map((e) => token(e)));
});

describe('Iscrizione e schede personali', () => {
  it('ci si iscrive senza codice e si risulta "da soli"', async () => {
    const r = await api().post('/register').send({ nome: 'Nuovo', email: 'nuovo@test.com', password: 'password123' });
    expect(r.status).toBe(201);
    const me = await api().get('/me').set(auth(await token('nuovo@test.com')));
    expect(me.body).toMatchObject({ ruolo: 'CLIENTE', trainer: null, schedePersonali: 0, limiteSchede: 3 });
  });

  it('crea le sue schede: anche la quarta (il Pro per ora è solo un avviso), contate tutte, archiviate comprese', async () => {
    for (const n of ['A', 'B', 'C']) expect((await api().post('/schede').set(auth(tS)).send(mia(n))).status).toBe(201);
    const prima = (await api().get('/schede').set(auth(tS))).body;
    expect(prima.map((s: any) => s.nome)).toEqual(['A', 'B', 'C']);
    expect(prima.every((s: any) => s.personale && s.trainerId === null && s.clienteId === sara.id)).toBe(true);

    expect((await api().post('/schede').set(auth(tS)).send(mia('D'))).status).toBe(201);
    expect((await api().post(`/schede/${prima[0].id}/archivia`).set(auth(tS))).status).toBe(204);
    expect((await api().get('/schede?archiviate=1').set(auth(tS))).body.map((s: any) => s.nome)).toEqual(['A']);
    expect((await api().get('/me').set(auth(tS))).body).toMatchObject({ schedePersonali: 4, limiteSchede: 3 });
  });

  it('tetto di sicurezza: al massimo 30 schede attive insieme', async () => {
    await prisma.scheda.createMany({ data: Array.from({ length: 30 }, (_, i) => ({ nome: `S${i}`, clienteId: sara.id, personale: true })) });
    const r = await api().post('/schede').set(auth(tS)).send(mia('Troppe'));
    expect(r.status).toBe(400);
    expect(r.body.errore).toBe('Hai già 30 schede attive: archiviane qualcuna per crearne altre');
  });

  it('modifica le sue schede, ma non quelle degli altri', async () => {
    const s = (await api().post('/schede').set(auth(tS)).send(mia())).body;
    const mod = await api().put(`/schede/${s.id}`).set(auth(tS)).send({ nome: 'Rinominata', clienteId: ids.alessio.id });
    expect(mod.status).toBe(200);
    expect(mod.body).toMatchObject({ nome: 'Rinominata', clienteId: sara.id }); // il cliente non si cambia
    const diAlessio = (await api().post('/schede').set(auth(tF)).send(schedaDiProva(ids.alessio.id))).body;
    expect((await api().put(`/schede/${diAlessio.id}`).set(auth(tS)).send({ nome: 'X' })).status).toBe(404);
    // Il trainer non vede né tocca le schede personali di chi non segue
    expect((await api().put(`/schede/${s.id}`).set(auth(tF)).send({ nome: 'X' })).status).toBe(404);
  });

  it('un cliente seguito da un trainer non crea né modifica schede', async () => {
    const r = await api().post('/schede').set(auth(tA)).send(mia());
    expect(r.status).toBe(403);
    expect(r.body.errore).toBe('Le tue schede le prepara il tuo trainer');
    const diAlessio = (await api().post('/schede').set(auth(tF)).send(schedaDiProva(ids.alessio.id))).body;
    expect((await api().put(`/schede/${diAlessio.id}`).set(auth(tA)).send({ nome: 'X' })).status).toBe(403);
    expect((await api().post(`/schede/${diAlessio.id}/archivia`).set(auth(tA))).status).toBe(403);
  });

  it('da solo decide anche piano cardio, obiettivo passi e massa grassa', async () => {
    expect((await api().post('/cardio/obiettivi').set(auth(tS)).send({ attivita: 'Corsa', minuti: 30, volteSettimana: 3 })).status).toBe(201);
    expect((await api().put('/cardio/obiettivo-passi').set(auth(tS)).send({ passi: 9000 })).body).toEqual({ obiettivoPassi: 9000 });
    expect((await api().put('/misure').set(auth(tS)).send({ tipo: 'MASSA_GRASSA', valore: 18, data: oggi() })).status).toBe(200);
    // Chi ha un trainer no
    expect((await api().post('/cardio/obiettivi').set(auth(tA)).send({ attivita: 'Corsa', minuti: 30, volteSettimana: 3 })).status).toBe(403);
    expect((await api().put('/misure').set(auth(tA)).send({ tipo: 'MASSA_GRASSA', valore: 18, data: oggi() })).status).toBe(403);
  });
});

describe('Collegarsi a un trainer e lasciarlo', () => {
  it('con un codice si collega: schede personali in pausa, il trainer lo vede e gli prepara le schede', async () => {
    const personale = (await api().post('/schede').set(auth(tS)).send(mia())).body;
    const r = await collega(tS, await codiceDi(tM));
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ trainer: { nome: 'Marta' }, schedePersonali: 1 });
    expect((await api().get('/clienti').set(auth(tM))).body.map((c: any) => c.nome)).toContain('Sara');

    // La sua scheda personale non si vede più, né lei né Marta la possono toccare
    expect((await api().get('/schede').set(auth(tS))).body).toEqual([]);
    expect((await api().put(`/schede/${personale.id}`).set(auth(tS)).send({ nome: 'X' })).status).toBe(403);
    expect((await api().get('/schede').set(auth(tM))).body.map((s: any) => s.id)).not.toContain(personale.id);

    const diMarta = await api().post('/schede').set(auth(tM)).send(schedaDiProva(sara.id));
    expect(diMarta.status).toBe(201);
    expect((await api().get('/schede').set(auth(tS))).body.map((s: any) => s.id)).toEqual([diMarta.body.id]);
  });

  it('il codice vale una volta sola e dev’essere un codice cliente valido', async () => {
    const codice = await codiceDi(tM);
    expect((await collega(tS, codice)).status).toBe(200);
    expect((await collega(tA, codice)).status).toBe(400);
    expect((await collega(tS, 'ZZZZ-ZZZZ')).status).toBe(400);
    const trainerInvito = (await api().post('/inviti').set(auth(tF)).send({ ruolo: 'TRAINER' })).body.codice;
    if (trainerInvito) expect((await collega(tA, trainerInvito)).status).toBe(400);
    // Lo stesso trainer di adesso
    const r = await collega(tS, await codiceDi(tM));
    expect(r.status).toBe(400);
    expect(r.body.errore).toBe('Sei già seguito da questo trainer');
    // Un trainer non si collega a un trainer
    expect((await collega(tF, await codiceDi(tM))).status).toBe(403);
  });

  it('il nuovo trainer vede misure, cardio, passi e diario solo da quando è collegato', async () => {
    // Sara, da sola, prima del collegamento
    await api().put('/misure').set(auth(tS)).send({ tipo: 'PESO', valore: 60, data: giorniFa(5) });
    await api().put('/cardio/passi').set(auth(tS)).send({ data: giorniFa(5), passi: 7000 });
    await api().post('/cardio/sessioni').set(auth(tS)).send({ attivita: 'Corsa', minuti: 20, data: giorniFa(5) });
    await api().put('/diario/consenso').set(auth(tS)).send({ consenso: true });
    await api().put(`/diario/${giorniFa(5)}`).set(auth(tS)).send({ pasti: { PRANZO: { testo: 'Riso' } } });

    expect((await collega(tS, await codiceDi(tM))).status).toBe(200);
    // Dopo
    await api().put('/misure').set(auth(tS)).send({ tipo: 'PESO', valore: 59.5, data: oggi() });
    await api().put('/cardio/passi').set(auth(tS)).send({ data: oggi(), passi: 9000 });
    await api().put(`/diario/${oggi()}`).set(auth(tS)).send({ pasti: { CENA: { testo: 'Pesce' } } });

    const q = `?clienteId=${sara.id}`;
    expect((await api().get(`/misure${q}`).set(auth(tM))).body.map((m: any) => m.valore)).toEqual([59.5]);
    const cardio = (await api().get(`/cardio${q}`).set(auth(tM))).body;
    expect(cardio.passi.map((p: any) => p.passi)).toEqual([9000]);
    expect(cardio.sessioni).toEqual([]);
    expect((await api().get(`/diario${q}`).set(auth(tM))).body.giorni).toHaveLength(1);
    expect((await api().put(`/diario/${giorniFa(5)}/commento`).set(auth(tM)).send({ clienteId: sara.id, commento: 'X' })).status).toBe(404);

    // Sara invece vede ancora tutto il suo storico
    expect((await api().get('/misure').set(auth(tS))).body).toHaveLength(2);
    expect((await api().get('/diario').set(auth(tS))).body.giorni).toHaveLength(2);
  });

  it('i clienti di sempre restano come prima: il trainer vede tutto il loro storico', async () => {
    await api().put('/misure').set(auth(tA)).send({ tipo: 'PESO', valore: 80, data: giorniFa(300) });
    expect((await api().get(`/misure?clienteId=${ids.alessio.id}`).set(auth(tF))).body).toHaveLength(1);
  });

  it('lasciando il trainer: servono la password; niente si cancella; le schede personali tornano', async () => {
    const personale = (await api().post('/schede').set(auth(tS)).send(mia())).body;
    await collega(tS, await codiceDi(tM));
    const diMarta = (await api().post('/schede').set(auth(tM)).send(schedaDiProva(sara.id))).body;
    const es = diMarta.esercizi[0].id;
    expect((await api().post('/registro').set(auth(tS)).send({ esercizioId: es, pesoUsato: 40, repsFatte: 8 })).status).toBe(201);

    expect((await lascia(tS, 'sbagliata')).status).toBe(400);
    const r = await lascia(tS);
    expect(r.status).toBe(200);
    expect(r.body.trainer).toBeNull();

    // Torna la sua scheda; quella di Marta resta nel database con la serie registrata
    expect((await api().get('/schede').set(auth(tS))).body.map((s: any) => s.id)).toEqual([personale.id]);
    expect(await prisma.scheda.count({ where: { id: diMarta.id } })).toBe(1);
    expect(await prisma.registroAllenamento.count({ where: { esercizioId: es } })).toBe(1);

    // Marta non la vede più, né i suoi dati né le sue schede
    expect((await api().get('/clienti').set(auth(tM))).body.map((c: any) => c.nome)).not.toContain('Sara');
    expect((await api().get(`/misure?clienteId=${sara.id}`).set(auth(tM))).status).toBe(404);
    expect((await api().get('/schede').set(auth(tM))).body.map((s: any) => s.id)).not.toContain(diMarta.id);
    expect((await api().get(`/registro/${es}`).set(auth(tM))).status).toBe(404);
    expect((await api().get('/sessioni').set(auth(tM))).body).toEqual([]);

    expect((await lascia(tS)).body.errore).toBe('Ti alleni già da solo');
  });

  it('cambiando trainer, il nuovo non vede schede e allenamenti preparati dal vecchio', async () => {
    const vecchia = (await api().post('/schede').set(auth(tF)).send(schedaDiProva(ids.alessio.id))).body;
    const ini = new Date(Date.now() - 3_600_000).toISOString();
    await api().post('/registro').set(auth(tA)).send({ esercizioId: vecchia.esercizi[0].id, pesoUsato: 50, repsFatte: 8 });
    await api().post('/sessioni').set(auth(tA)).send({ schedaId: vecchia.id, inizioGiornata: ini });

    expect((await collega(tA, await codiceDi(tM))).status).toBe(200);
    expect((await api().get('/schede').set(auth(tM))).body.map((s: any) => s.id)).not.toContain(vecchia.id);
    expect((await api().get(`/sessioni?clienteId=${ids.alessio.id}`).set(auth(tM))).body).toEqual([]);
    expect((await api().get(`/registro/${vecchia.esercizi[0].id}`).set(auth(tM))).status).toBe(404);
    expect((await api().get(`/schede/${vecchia.id}/storico`).set(auth(tM))).status).toBe(404);
    // E Felice non vede più Alessio
    expect((await api().get('/clienti').set(auth(tF))).body.map((c: any) => c.nome)).not.toContain('Alessio');
    expect((await api().get(`/schede/${vecchia.id}/storico`).set(auth(tF))).status).toBe(404);
    // Alessio, ora con Marta, non vede più la scheda di Felice (che però esiste ancora)
    expect((await api().get('/schede').set(auth(tA))).body).toEqual([]);
    expect(await prisma.sessioneAllenamento.count({ where: { schedaId: vecchia.id } })).toBe(1);
  });

  it('un trainer lasciato da tutti può eliminare l’account: schede e misure restano ai clienti', async () => {
    const t = await creaUtente('Luca', 'luca-t@test.com', 'TRAINER');
    const tL = await token('luca-t@test.com');
    await collega(tS, await codiceDi(tL));
    const scheda = (await api().post('/schede').set(auth(tL)).send(schedaDiProva(sara.id))).body;
    await api().put('/misure').set(auth(tL)).send({ tipo: 'MASSA_GRASSA', valore: 20, data: oggi(), clienteId: sara.id });
    await lascia(tS);

    const r = await api().delete('/me').set(auth(tL)).send({ password: 'password123', conferma: 'ELIMINA' });
    expect(r.status).toBe(204);
    expect(await prisma.user.count({ where: { id: t.id } })).toBe(0);
    expect((await prisma.scheda.findUnique({ where: { id: scheda.id } }))?.trainerId).toBeNull();
    const misura = await prisma.misuraCorporea.findFirst({ where: { clienteId: sara.id, tipo: 'MASSA_GRASSA' } });
    expect(misura).toMatchObject({ valore: 20, inseritaDaId: sara.id });
  });
});
