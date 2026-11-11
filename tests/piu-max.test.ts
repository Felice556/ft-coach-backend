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
