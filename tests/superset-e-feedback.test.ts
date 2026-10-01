import { beforeAll, describe, expect, it } from 'vitest';
import { api, auth, inizioGiornata, prisma, token, utentiDiPartenza } from './aiuti';

let ids: Awaited<ReturnType<typeof utentiDiPartenza>>;
let tF: string, tA: string, tG: string;
let schedaId: number;
let sessioneId: number;

type Es = { id: number; nome: string; collegamento: string | null };

beforeAll(async () => {
  ids = await utentiDiPartenza();
  [tF, tA, tG] = await Promise.all([token('felice@test.com'), token('alessio@test.com'), token('giulia@test.com')]);
});

describe('Superset e jumpset', () => {
  it('il trainer collega gli esercizi; serie e reps possono essere diverse', async () => {
    const r = await api()
      .post('/schede')
      .set(auth(tF))
      .send({
        nome: 'Upper',
        clienteId: ids.alessio.id,
        esercizi: [
          { nome: 'Panca', serieTarget: 4, repsTarget: 8, recuperoSecondi: 0, collegamento: 'SUPERSET' },
          { nome: 'Rematore', serieTarget: 3, repsTarget: 12, recuperoSecondi: 120 },
          { nome: 'Military', serieTarget: 3, repsTarget: 10, recuperoSecondi: 60, collegamento: 'JUMPSET' },
          { nome: 'Trazioni', serieTarget: 3, repsTarget: null, recuperoSecondi: 90 },
          // sull'ultimo esercizio un collegamento "al successivo" non ha senso: viene tolto
          { nome: 'Curl', serieTarget: 2, repsTarget: 15, recuperoSecondi: 60, collegamento: 'SUPERSET' },
        ],
      });
    expect(r.status).toBe(201);
    schedaId = r.body.id;
    expect(r.body.esercizi.map((e: Es) => e.collegamento)).toEqual(['SUPERSET', null, 'JUMPSET', null, null]);
  });

  it('il cliente vede i collegamenti nella sua scheda', async () => {
    const schede = (await api().get('/schede').set(auth(tA))).body;
    const s = schede.find((x: { id: number }) => x.id === schedaId);
    expect(s.esercizi[0]).toMatchObject({ nome: 'Panca', collegamento: 'SUPERSET' });
  });

  it('modificando la scheda si collega, si cambia tipo e si scollega', async () => {
    const attuale = (await api().get(`/schede?clienteId=${ids.alessio.id}`).set(auth(tF))).body[0];
    const esercizi = attuale.esercizi.map((e: Es & Record<string, unknown>, i: number) => ({
      id: e.id,
      nome: e.nome,
      serieTarget: e.serieTarget,
      repsTarget: e.repsTarget,
      recuperoSecondi: e.recuperoSecondi,
      // Panca diventa jumpset, Military si scollega, Trazioni si collega a Curl
      collegamento: ['JUMPSET', null, null, 'SUPERSET', null][i],
    }));
    const r = await api().put(`/schede/${schedaId}`).set(auth(tF)).send({ nome: 'Upper', esercizi });
    expect(r.status).toBe(200);
    expect(r.body.esercizi.map((e: Es) => e.collegamento)).toEqual(['JUMPSET', null, null, 'SUPERSET', null]);
  });

  it('modificando un solo esercizio il collegamento resta, se non lo mandi', async () => {
    const primo = (await api().get(`/schede?clienteId=${ids.alessio.id}`).set(auth(tF))).body[0].esercizi[0];
    const r = await api().put(`/esercizi/${primo.id}`).set(auth(tF)).send({ recuperoSecondi: 45 });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ recuperoSecondi: 45, collegamento: 'JUMPSET' });
  });

  it('tipi di collegamento inventati rifiutati', async () => {
    const r = await api()
      .post('/schede')
      .set(auth(tF))
      .send({
        nome: 'X',
        clienteId: ids.alessio.id,
        esercizi: [
          { nome: 'A', serieTarget: 3, repsTarget: 8, recuperoSecondi: 60, collegamento: 'GIANTSET' },
          { nome: 'B', serieTarget: 3, repsTarget: 8, recuperoSecondi: 60 },
        ],
      });
    expect(r.status).toBe(400);
  });
});

describe('Feedback a fine allenamento', () => {
  beforeAll(async () => {
    const scheda = (await api().get('/schede').set(auth(tA))).body.find((x: { id: number }) => x.id === schedaId);
    await api().post('/registro').set(auth(tA)).send({ esercizioId: scheda.esercizi[0].id, pesoUsato: 60, repsFatte: 8 });
    const r = await api().post('/sessioni').set(auth(tA)).send({ schedaId, inizioGiornata: inizioGiornata() });
    expect(r.status).toBe(201);
    sessioneId = r.body.id;
  });

  it('il cliente salva nota e voto di fatica; il trainer li vede', async () => {
    const r = await api()
      .put(`/sessioni/${sessioneId}/feedback`)
      .set(auth(tA))
      .send({ nota: '  Spalla un po’ dolorante sulla panca  ', fatica: 8 });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ nota: 'Spalla un po’ dolorante sulla panca', fatica: 8 });

    const delTrainer = (await api().get(`/sessioni?clienteId=${ids.alessio.id}`).set(auth(tF))).body;
    expect(delTrainer[0]).toMatchObject({ id: sessioneId, nota: 'Spalla un po’ dolorante sulla panca', fatica: 8 });
  });

  it('richiudere l’allenamento non cancella il feedback', async () => {
    const r = await api().post('/sessioni').set(auth(tA)).send({ schedaId, inizioGiornata: inizioGiornata() });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ id: sessioneId, nota: 'Spalla un po’ dolorante sulla panca', fatica: 8 });
  });

  it('si può togliere: nota vuota e voto null', async () => {
    const r = await api().put(`/sessioni/${sessioneId}/feedback`).set(auth(tA)).send({ nota: '   ', fatica: null });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ nota: null, fatica: null });
  });

  it('solo il proprietario: un altro cliente e il trainer ricevono 404/403', async () => {
    expect((await api().put(`/sessioni/${sessioneId}/feedback`).set(auth(tG)).send({ nota: 'ciao', fatica: 5 })).status).toBe(404);
    expect((await api().put(`/sessioni/${sessioneId}/feedback`).set(auth(tF)).send({ nota: 'ciao', fatica: 5 })).status).toBe(403);
    expect((await api().put(`/sessioni/999999/feedback`).set(auth(tA)).send({ nota: 'ciao', fatica: 5 })).status).toBe(404);
    const s = await prisma.sessioneAllenamento.findUnique({ where: { id: sessioneId } });
    expect(s?.nota).toBeNull();
  });

  it.each([
    ['voto 0', { nota: null, fatica: 0 }],
    ['voto 11', { nota: null, fatica: 11 }],
    ['voto con la virgola', { nota: null, fatica: 7.5 }],
    ['nota lunghissima', { nota: 'x'.repeat(1001), fatica: 5 }],
    ['campi mancanti', {}],
  ])('valori non validi rifiutati: %s', async (_nome, dati) => {
    expect((await api().put(`/sessioni/${sessioneId}/feedback`).set(auth(tA)).send(dati)).status).toBe(400);
  });
});
