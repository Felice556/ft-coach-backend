// "+ max" (drop set) nelle ripetizioni: "6-9 + max", anche nelle serie aggiunte. Con "Max" da solo non vale.
import { beforeEach, describe, expect, it } from 'vitest';
import { api, auth, creaUtente, schedaDiProva, token, utentiDiPartenza } from './aiuti';

let tF: string, tS: string;
let ids: Awaited<ReturnType<typeof utentiDiPartenza>>;

beforeEach(async () => {
  ids = await utentiDiPartenza();
  await creaUtente('Sara', 'sara@test.com', 'CLIENTE'); // si allena da sola
  [tF, tS] = await Promise.all(['felice@test.com', 'sara@test.com'].map((e) => token(e)));
});

const conDropSet = [
  {
    nome: 'Panca piana',
    serieTarget: 2,
    repsTarget: 6,
    repsMax: 9,
    recuperoSecondi: 120,
    serieExtra: [
      { reps: 6, repsMax: 9, piuMax: true, recuperoSecondi: 120, nota: 'drop set' },
      { reps: null, piuMax: true, recuperoSecondi: 60 }, // "Max + max": il + max viene tolto
    ],
  },
  { nome: 'Croci', serieTarget: 3, repsTarget: 12, piuMax: true, recuperoSecondi: 60 },
  { nome: 'Plank', serieTarget: 3, repsTarget: null, piuMax: true, recuperoSecondi: 60 },
];

describe('Ripetizioni "+ max"', () => {
  it('il trainer salva "+ max" su serie normali e aggiunte; con Max da solo viene ignorato', async () => {
    const r = await api().post('/schede').set(auth(tF)).send(schedaDiProva(ids.alessio.id, conDropSet));
    expect(r.status).toBe(201);
    const [panca, croci, plank] = r.body.esercizi;
    expect(panca.piuMax).toBe(false);
    expect(panca.serieExtra.map((x: any) => x.piuMax)).toEqual([true, false]);
    expect(croci.piuMax).toBe(true);
    expect(plank.piuMax).toBe(false);
    // Il cliente lo vede così
    const delCliente = (await api().get('/schede').set(auth(await token('alessio@test.com')))).body[0];
    expect(delCliente.esercizi[1].piuMax).toBe(true);
  });

  it('si toglie e si rimette modificando la scheda; senza indicarlo resta com’era nella modifica singola', async () => {
    const s = (await api().post('/schede').set(auth(tF)).send(schedaDiProva(ids.alessio.id, conDropSet))).body;
    const croci = s.esercizi[1];
    const mod = await api().put(`/schede/${s.id}`).set(auth(tF)).send({
      nome: s.nome,
      esercizi: s.esercizi.map((e: any) => ({ id: e.id, nome: e.nome, serieTarget: e.serieTarget, repsTarget: e.repsTarget, repsMax: e.repsMax, recuperoSecondi: e.recuperoSecondi, piuMax: false })),
    });
    expect(mod.body.esercizi[1].piuMax).toBe(false);
    expect((await api().put(`/esercizi/${croci.id}`).set(auth(tF)).send({ piuMax: true })).body.piuMax).toBe(true);
    expect((await api().put(`/esercizi/${croci.id}`).set(auth(tF)).send({ recuperoSecondi: 90 })).body.piuMax).toBe(true);
  });

  it('chi si allena da solo usa "+ max" e aggiunge serie con valori propri', async () => {
    const r = await api().post('/schede').set(auth(tS)).send({ ...schedaDiProva(0, conDropSet), clienteId: undefined });
    expect(r.status).toBe(201);
    expect(r.body.esercizi[0].serieExtra).toHaveLength(2);
    expect(r.body.esercizi[1].piuMax).toBe(true);
  });
});

describe('Rest-pause "+ rp"', () => {
  it('si salva con la sua pausa; esclude il + max; pause assurde rifiutate', async () => {
    const esercizi = [
      { nome: 'Lat machine', serieTarget: 2, repsTarget: 8, repsMax: 10, rpSecondi: 15, piuMax: true, recuperoSecondi: 90, serieExtra: [{ reps: null, rpSecondi: 20, recuperoSecondi: 60 }] },
    ];
    const r = await api().post('/schede').set(auth(tF)).send(schedaDiProva(ids.alessio.id, esercizi));
    expect(r.status).toBe(201);
    const es = r.body.esercizi[0];
    expect(es).toMatchObject({ rpSecondi: 15, piuMax: false }); // o l'uno o l'altro
    expect(es.serieExtra[0]).toMatchObject({ reps: null, rpSecondi: 20 }); // "Max + rp 20" ha senso
    const troppo = await api().post('/schede').set(auth(tF)).send(schedaDiProva(ids.alessio.id, [{ ...esercizi[0], rpSecondi: 500, serieExtra: [] }]));
    expect(troppo.status).toBe(400);
    // Si toglie con la modifica singola
    expect((await api().put(`/esercizi/${es.id}`).set(auth(tF)).send({ rpSecondi: null })).body.rpSecondi).toBeNull();
  });

  it('modificando un solo campo dell\u2019esercizio, il resto (reps max, rp, collegamento, serie aggiunte) non cambia', async () => {
    const s = (await api().post('/schede').set(auth(tF)).send(schedaDiProva(ids.alessio.id, [
      { nome: 'Lat machine', serieTarget: 2, repsTarget: 8, repsMax: 10, rpSecondi: 15, recuperoSecondi: 90, collegamento: 'SUPERSET', serieExtra: [{ reps: 6, recuperoSecondi: 60 }] },
      { nome: 'Pulley', serieTarget: 3, repsTarget: 10, recuperoSecondi: 60 },
    ]))).body;
    const r = await api().put(`/esercizi/${s.esercizi[0].id}`).set(auth(tF)).send({ recuperoSecondi: 120 });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ recuperoSecondi: 120, repsMax: 10, rpSecondi: 15, piuMax: false, collegamento: 'SUPERSET' });
    expect(r.body.serieExtra).toHaveLength(1);
  });
});


describe('Cluster "5+5+5+5"', () => {
  it('si salva con mini-serie e pausa (di base 15 s); niente intervallo né + max; fuori da 2-10 rifiutato', async () => {
    const esercizi = [
      { nome: 'Pulldown corda', serieTarget: 3, repsTarget: 5, cluster: 4, rpSecondi: 10, recuperoSecondi: 120, serieExtra: [{ reps: 3, cluster: 3, recuperoSecondi: 60 }] },
      { nome: 'Panca', serieTarget: 2, repsTarget: 6, repsMax: 9, piuMax: true, cluster: 3, recuperoSecondi: 120 },
      { nome: 'Plank', serieTarget: 2, repsTarget: null, cluster: 3, recuperoSecondi: 60 },
    ];
    const r = await api().post('/schede').set(auth(tF)).send(schedaDiProva(ids.alessio.id, esercizi));
    expect(r.status).toBe(201);
    const [pulldown, panca, plank] = r.body.esercizi;
    expect(pulldown).toMatchObject({ repsTarget: 5, cluster: 4, rpSecondi: 10, recuperoSecondi: 120 });
    expect(pulldown.serieExtra[0]).toMatchObject({ reps: 3, cluster: 3, rpSecondi: 15 }); // pausa non scritta: 15 s
    expect(panca).toMatchObject({ repsTarget: 6, repsMax: null, piuMax: false, cluster: 3, rpSecondi: 15 });
    expect(plank).toMatchObject({ repsTarget: null, cluster: null }); // con "Max" il cluster non ha senso
    // Il cliente lo vede
    const delCliente = (await api().get('/schede').set(auth(await token('alessio@test.com')))).body[0];
    expect(delCliente.esercizi[0]).toMatchObject({ cluster: 4, rpSecondi: 10 });
    for (const cluster of [1, 11]) {
      const no = await api().post('/schede').set(auth(tF)).send(schedaDiProva(ids.alessio.id, [{ ...esercizi[0], cluster, serieExtra: [] }]));
      expect(no.status).toBe(400);
    }
  });

  it('modifica: resta se non lo indichi, si toglie con null (e torna l’intervallo)', async () => {
    const s = (await api().post('/schede').set(auth(tF)).send(schedaDiProva(ids.alessio.id, [
      { nome: 'Pulldown corda', serieTarget: 3, repsTarget: 5, cluster: 4, rpSecondi: 10, recuperoSecondi: 120 },
    ]))).body;
    const id = s.esercizi[0].id;
    expect((await api().put(`/esercizi/${id}`).set(auth(tF)).send({ recuperoSecondi: 90 })).body).toMatchObject({ cluster: 4, rpSecondi: 10, recuperoSecondi: 90 });
    const tolto = (await api().put(`/esercizi/${id}`).set(auth(tF)).send({ cluster: null, rpSecondi: null, repsTarget: 8, repsMax: 12 })).body;
    expect(tolto).toMatchObject({ cluster: null, rpSecondi: null, repsTarget: 8, repsMax: 12 });
    // Modifica dell'intera scheda: il cluster si salva anche lì
    const mod = await api().put(`/schede/${s.id}`).set(auth(tF)).send({
      nome: s.nome,
      esercizi: [{ id, nome: 'Pulldown corda', serieTarget: 3, repsTarget: 5, cluster: 5, rpSecondi: 20, recuperoSecondi: 120 }],
    });
    expect(mod.body.esercizi[0]).toMatchObject({ id, cluster: 5, rpSecondi: 20 });
  });

  it('chi si allena da solo può usare il cluster', async () => {
    const r = await api().post('/schede').set(auth(tS)).send({ ...schedaDiProva(0, [{ nome: 'Curl', serieTarget: 2, repsTarget: 4, cluster: 3, recuperoSecondi: 90 }]), clienteId: undefined });
    expect(r.status).toBe(201);
    expect(r.body.esercizi[0]).toMatchObject({ cluster: 3, rpSecondi: 15 });
  });
});

describe('EMOM', () => {
  it('si salva con un giro ogni N secondi; niente altre tecniche né serie extra; fino a 60 giri', async () => {
    const r = await api().post('/schede').set(auth(tF)).send(schedaDiProva(ids.alessio.id, [
      { nome: 'Push up', serieTarget: 16, repsTarget: 8, emomSecondi: 30, repsMax: 10, piuMax: true, rpSecondi: 15, cluster: 3, recuperoSecondi: 120, serieExtra: [{ reps: 5, recuperoSecondi: 60 }] },
      { nome: 'Trazioni', serieTarget: 10, repsTarget: null, emomSecondi: 60, recuperoSecondi: 90 },
    ]));
    expect(r.status).toBe(201);
    const [push, trazioni] = r.body.esercizi;
    expect(push).toMatchObject({ serieTarget: 16, repsTarget: 8, emomSecondi: 30, repsMax: null, piuMax: false, rpSecondi: null, cluster: null });
    expect(push.serieExtra).toHaveLength(0);
    expect(trazioni).toMatchObject({ repsTarget: null, emomSecondi: 60 });
    const delCliente = (await api().get('/schede').set(auth(await token('alessio@test.com')))).body[0];
    expect(delCliente.esercizi[0]).toMatchObject({ emomSecondi: 30 });
    // 40 giri sì con l'EMOM, 21 serie no senza
    expect((await api().post('/schede').set(auth(tF)).send(schedaDiProva(ids.alessio.id, [{ nome: 'Push up', serieTarget: 40, repsTarget: 5, emomSecondi: 30, recuperoSecondi: 60 }]))).status).toBe(201);
    expect((await api().post('/schede').set(auth(tF)).send(schedaDiProva(ids.alessio.id, [{ nome: 'Panca', serieTarget: 21, repsTarget: 5, recuperoSecondi: 60 }]))).status).toBe(400);
    for (const emomSecondi of [5, 301]) {
      expect((await api().post('/schede').set(auth(tF)).send(schedaDiProva(ids.alessio.id, [{ nome: 'Push up', serieTarget: 10, repsTarget: 5, emomSecondi, recuperoSecondi: 60 }]))).status).toBe(400);
    }
  });

  it('modifica: resta se non lo indichi, si toglie con null; con l’EMOM spariscono le serie extra', async () => {
    const s = (await api().post('/schede').set(auth(tF)).send(schedaDiProva(ids.alessio.id, [
      { nome: 'Squat', serieTarget: 3, repsTarget: 8, recuperoSecondi: 120, serieExtra: [{ reps: 5, recuperoSecondi: 60 }] },
    ]))).body;
    const id = s.esercizi[0].id;
    const emom = (await api().put(`/esercizi/${id}`).set(auth(tF)).send({ emomSecondi: 60, serieTarget: 30 })).body;
    expect(emom).toMatchObject({ emomSecondi: 60, serieTarget: 30 });
    expect(emom.serieExtra).toHaveLength(0);
    expect((await api().put(`/esercizi/${id}`).set(auth(tF)).send({ recuperoSecondi: 90 })).body).toMatchObject({ emomSecondi: 60, recuperoSecondi: 90 });
    // tornando normale, 30 serie sono troppe
    expect((await api().put(`/esercizi/${id}`).set(auth(tF)).send({ emomSecondi: null })).status).toBe(400);
    expect((await api().put(`/esercizi/${id}`).set(auth(tF)).send({ emomSecondi: null, serieTarget: 4 })).body).toMatchObject({ emomSecondi: null, serieTarget: 4 });
    const mod = await api().put(`/schede/${s.id}`).set(auth(tF)).send({
      nome: s.nome,
      esercizi: [{ id, nome: 'Squat', serieTarget: 20, repsTarget: 5, emomSecondi: 30, recuperoSecondi: 120, serieExtra: [{ reps: 5, recuperoSecondi: 60 }] }],
    });
    expect(mod.body.esercizi[0]).toMatchObject({ id, emomSecondi: 30, serieTarget: 20 });
    expect(mod.body.esercizi[0].serieExtra).toHaveLength(0);
  });
});

describe('Cluster a totale', () => {
  it('si salva con totale, RM e pausa (15s di base); niente altre tecniche né serie extra', async () => {
    const r = await api().post('/schede').set(auth(tF)).send(schedaDiProva(ids.alessio.id, [
      { nome: 'Leg extension', serieTarget: 2, repsTarget: 12, clusterTotale: 30, piuMax: true, cluster: 4, recuperoSecondi: 120, serieExtra: [{ reps: 5, recuperoSecondi: 60 }] },
      { nome: 'Curl', serieTarget: 1, repsTarget: 10, clusterTotale: 25, rpSecondi: 20, recuperoSecondi: 90 },
    ]));
    expect(r.status).toBe(201);
    const [le, curl] = r.body.esercizi;
    expect(le).toMatchObject({ clusterTotale: 30, repsTarget: 12, rpSecondi: 15, piuMax: false, cluster: null, emomSecondi: null });
    expect(le.serieExtra).toHaveLength(0);
    expect(curl).toMatchObject({ clusterTotale: 25, rpSecondi: 20 });
    const delCliente = (await api().get('/schede').set(auth(await token('alessio@test.com')))).body[0];
    expect(delCliente.esercizi[0]).toMatchObject({ clusterTotale: 30 });
  });

  it('rifiuta: totale fuori da 10-100, reps mancanti o non più basse del totale, insieme all’EMOM', async () => {
    const prova = (e: object) => api().post('/schede').set(auth(tF)).send(schedaDiProva(ids.alessio.id, [{ nome: 'X', serieTarget: 2, recuperoSecondi: 60, ...e }]));
    expect((await prova({ repsTarget: 5, clusterTotale: 8 })).status).toBe(400);
    expect((await prova({ repsTarget: 12, clusterTotale: 120 })).status).toBe(400);
    expect((await prova({ repsTarget: null, clusterTotale: 30 })).status).toBe(400);
    expect((await prova({ repsTarget: 30, clusterTotale: 30 })).status).toBe(400);
    expect((await prova({ repsTarget: 12, clusterTotale: 30, emomSecondi: 60 })).status).toBe(400);
  });

  it('modifica: si attiva e si toglie; con il cluster a totale spariscono le serie extra', async () => {
    const s = (await api().post('/schede').set(auth(tF)).send(schedaDiProva(ids.alessio.id, [
      { nome: 'Pressa', serieTarget: 3, repsTarget: 12, recuperoSecondi: 120, serieExtra: [{ reps: 8, recuperoSecondi: 60 }] },
    ]))).body;
    const id = s.esercizi[0].id;
    const on = (await api().put(`/esercizi/${id}`).set(auth(tF)).send({ clusterTotale: 30 })).body;
    expect(on).toMatchObject({ clusterTotale: 30, rpSecondi: 15 });
    expect(on.serieExtra).toHaveLength(0);
    expect((await api().put(`/esercizi/${id}`).set(auth(tF)).send({ recuperoSecondi: 90 })).body).toMatchObject({ clusterTotale: 30, recuperoSecondi: 90 });
    expect((await api().put(`/esercizi/${id}`).set(auth(tF)).send({ clusterTotale: null, rpSecondi: null })).body).toMatchObject({ clusterTotale: null, rpSecondi: null });
  });
});
