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
