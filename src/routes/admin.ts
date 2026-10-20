import { Router } from 'express';
import { prisma } from '../prisma.js';
import { autentica, richiedeAdmin } from '../middleware/auth.js';

const router = Router();

const GIORNO = 24 * 60 * 60 * 1000;

// Panoramica per l'amministratore: quanti trainer usano l'app e quanto la usano i loro clienti.
// Solo NUMERI: nessun nome o dato dei clienti degli altri trainer esce da qui.
router.get('/admin/trainer', autentica, richiedeAdmin, async (_req, res) => {
  const da30giorni = new Date(Date.now() - 30 * GIORNO);

  const trainer = await prisma.user.findMany({
    where: { ruolo: 'TRAINER' },
    orderBy: { id: 'asc' },
    select: {
      id: true,
      nome: true,
      email: true,
      admin: true,
      invitoUsato: { select: { usatoIl: true } }, // quando si è registrato (se con un invito trainer)
      _count: { select: { clienti: true } },
    },
  });

  const righe = await Promise.all(
    trainer.map(async (t) => {
      const deiSuoiClienti = { cliente: { trainerId: t.id } };
      const [clientiAttivi, schedeAttive, allenamenti30, ultimo] = await Promise.all([
        // clienti con almeno un allenamento concluso negli ultimi 30 giorni
        prisma.user.count({ where: { trainerId: t.id, sessioni: { some: { completataIl: { gte: da30giorni } } } } }),
        prisma.scheda.count({ where: { ...deiSuoiClienti, archiviataIl: null } }),
        prisma.sessioneAllenamento.count({ where: { ...deiSuoiClienti, completataIl: { gte: da30giorni } } }),
        prisma.sessioneAllenamento.findFirst({
          where: deiSuoiClienti,
          orderBy: { completataIl: 'desc' },
          select: { completataIl: true },
        }),
      ]);
      return {
        id: t.id,
        nome: t.nome,
        email: t.email,
        admin: t.admin,
        registratoIl: t.invitoUsato?.usatoIl ?? null,
        clienti: t._count.clienti,
        clientiAttivi,
        schedeAttive,
        allenamenti30,
        ultimoAllenamento: ultimo?.completataIl ?? null,
      };
    }),
  );

  res.json({
    totali: {
      trainer: righe.length,
      clienti: righe.reduce((s, r) => s + r.clienti, 0),
      clientiAttivi: righe.reduce((s, r) => s + r.clientiAttivi, 0),
      allenamenti30: righe.reduce((s, r) => s + r.allenamenti30, 0),
    },
    trainer: righe,
  });
});

export default router;
