# Progetto App Palestra — Recap

**Punto di partenza:** backend Node.js completato (task manager, vedi `recap-percorso-nodejs.md`)
**Obiettivo:** secondo progetto full-stack con un concetto nuovo — ruoli e permessi differenziati
**Repository:** https://github.com/Felice556/palestra-backend (privato)

---

## Il progetto

Un'app per gestire clienti di una palestra/personal trainer:

- **Trainer**: crea schede di allenamento e le assegna ai clienti
- **Cliente**: vede la propria scheda (esercizi con video, serie/reps/recupero) e registra i propri allenamenti (peso usato, reps fatte) — da cui nasce uno storico/progressione nel tempo

---

## ✅ COMPLETATO

### Giorno 1 — Backend con ruoli e permessi

**Stack:** stesso del task manager (Node/Express/TypeScript/Prisma/PostgreSQL/JWT), con una novità importante: **Prisma 7**, che ha cambiato il modo in cui si configura la connessione al database.

#### Concetto nuovo: l'enum per i ruoli

```prisma
enum Ruolo {
  TRAINER
  CLIENTE
}

model User {
  id       Int    @id @default(autoincrement())
  nome     String
  email    String @unique
  password String
  ruolo    Ruolo
}
```
L'enum obbliga il campo a uno dei due valori — niente stringhe libere scrivibili in modo incoerente (`"trainer"` vs `"Trainer"`).

#### Schema dati completo

```
User (ruolo: TRAINER | CLIENTE)
  └─ Scheda (assegnata a un cliente)
       └─ Esercizio (nome, videoUrl, serieTarget, repsTarget, recuperoSecondi)
            └─ RegistroAllenamento (pesoUsato, repsFatte, data) — uno "snapshot" per ogni allenamento
```

`RegistroAllenamento` ha sia `esercizioId` sia `clienteId` — leggermente ridondante (si potrebbe risalire al cliente passando dalla scheda), ma tenerlo esplicito rende immediate le query tipo "tutto lo storico di questo cliente", compromesso comune tra normalizzazione pura e comodità delle query.

Ogni allenamento registrato crea **un nuovo record**, non aggiorna uno esistente: è così che si costruisce uno storico/grafico di progressione nel tempo.

---

#### ⚠️ Breaking change: Prisma 7 e `prisma.config.ts`

Da Prisma 7 il datasource **non contiene più** la connection string:

```prisma
// schema.prisma — NON più questo:
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")   // ❌ non supportato in Prisma 7
}

// ma questo:
datasource db {
  provider = "postgresql"
}
```

La connection string per `migrate`/`generate` va in un **nuovo file** nella root del progetto:

```typescript
// prisma.config.ts
import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    url: env('DATABASE_URL'),
  },
});
```

Il client a runtime (in `src/prisma.ts`) resta invece basato sull'adapter, come già scoperto nel progetto precedente:
```typescript
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
export const prisma = new PrismaClient({ adapter });
```

---

#### Ruoli e permessi: il middleware `richiedeRuolo`

Novità rispetto al task manager: non basta essere autenticati (`autentica`), serve anche avere il ruolo giusto per quella rotta specifica.

```typescript
export function richiedeRuolo(...ruoliAmmessi: Ruolo[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const ruolo = (req as any).ruolo as Ruolo;
    if (!ruoliAmmessi.includes(ruolo)) {
      res.status(403).json({ errore: 'Non hai i permessi per questa azione' });
      return;
    }
    next();
  };
}
```

- È una funzione che **restituisce** un middleware — per questo si chiama `richiedeRuolo('TRAINER')` e non si passa direttamente
- `401` = non sei autenticato; `403` = sei autenticato ma non hai il permesso — due significati diversi, due status code diversi
- Il ruolo viaggia **dentro il token JWT** (`jwt.sign({ userId, ruolo }, ...)`), così ogni richiesta successiva sa chi sei e cosa puoi fare senza dover reinterrogare il database

**Rotte e permessi:**

| Rotta | Chi può |
|---|---|
| `POST /register`, `POST /login` | Chiunque |
| `POST /schede`, `PUT /schede/:id`, `DELETE /schede/:id` | Solo TRAINER |
| `PUT /esercizi/:id`, `DELETE /esercizi/:id` | Solo TRAINER |
| `GET /schede` | Tutti (ma il CLIENTE vede solo le proprie, il TRAINER può filtrare per cliente) |
| `POST /registro` | Solo CLIENTE |
| `GET /registro/:esercizioId` | Tutti (con controllo di appartenenza) |

---

#### Isolamento dati su relazioni annidate

Il controllo del ruolo da solo **non basta**. Esempio in `POST /registro`:

```typescript
const esercizio = await prisma.esercizio.findUnique({
  where: { id: esercizioId },
  include: { scheda: true },
});
if (!esercizio || esercizio.scheda.clienteId !== clienteId) {
  res.status(404).json({ errore: 'Esercizio non trovato' });
  return;
}
```

`richiedeRuolo('CLIENTE')` verifica solo **che tipo** di utente sei, non **quale**. Senza questo secondo controllo, un cliente qualsiasi potrebbe mandare l'`esercizioId` di un **altro** cliente e inquinarne lo storico. È lo stesso principio del `where: { id, userId }` del task manager, solo su una catena più lunga: Cliente → Scheda → Esercizio.

---

#### Cascade delete

```prisma
model Esercizio {
  ...
  scheda Scheda @relation(fields: [schedaId], references: [id], onDelete: Cascade)
}

model RegistroAllenamento {
  ...
  esercizio Esercizio @relation(fields: [esercizioId], references: [id], onDelete: Cascade)
}
```

Senza `onDelete: Cascade`, Postgres si rifiuta di cancellare una scheda finché esistono esercizi che la referenziano (vincolo di chiave esterna). Con il cascade, cancellare una `Scheda` cancella automaticamente anche i suoi `Esercizio` e, a cascata, il loro `RegistroAllenamento` — verificato: `DELETE /schede/:id` → `204 No Content`, poi `GET /registro/:esercizioId` sull'esercizio cancellato → `404`.

---

#### Endpoint CRUD completati

- `POST /register` — con `ruolo` (TRAINER/CLIENTE) nel body
- `POST /login` — ruolo incluso nel JWT
- `POST /schede` — trainer crea scheda + esercizi in un'unica query annidata (`esercizi: { create: [...] }`)
- `GET /schede` — cliente vede le proprie, trainer filtra con `?clienteId=`
- `PUT /schede/:id` — rinomina
- `DELETE /schede/:id` — cascade
- `PUT /esercizi/:id` — modifica parziale (`.partial()` su schema zod)
- `DELETE /esercizi/:id`
- `POST /registro` — cliente registra un allenamento, con verifica di appartenenza
- `GET /registro/:esercizioId` — storico ordinato cronologicamente, per il futuro grafico di progressione

**Utenti di test creati:** Felice (TRAINER), Alessio (CLIENTE)

---

## Git

Repository creato e pushato con `gh repo create --private --source=. --remote=origin --push` (via Claude Code locale, dopo un intoppo transitorio di refresh OAuth risolto chiudendo le sessioni doppie).

`.gitignore` verificato: `node_modules`, `dist`, `.env` esclusi — nessun segreto su GitHub.

---

## ⬜ DA FARE

### Prossima sessione — Frontend React/TypeScript
- Login con selezione ruolo (o rilevato dal token dopo login)
- Vista **Trainer**: lista clienti, creazione/modifica schede ed esercizi
- Vista **Cliente**: la propria scheda con video embed, form per registrare un allenamento
- Grafico di progressione pesi nel tempo (probabile candidato per una libreria tipo Recharts)
- Collegamento fetch alle API già pronte (stesso pattern del task manager: `fetch` + `Authorization: Bearer`)

### Più avanti (Fase 4, come da percorso precedente)
- Jest, Docker — da integrare quando l'app base è stabile
- Pagamenti (Stripe) — non ancora, rimandato

---

## Note utili

**Comando per avviare il server:**
```bash
npm run dev
```

**Se serve rigenerare il client Prisma dopo un problema:**
```bash
npx prisma generate
```

**Promemoria Prisma 7:** la connection string sta in `prisma.config.ts`, non più in `schema.prisma`. Se in futuro un altro progetto Prisma dà l'errore "The datasource property url is no longer supported", è lo stesso fix.

**Repository:**
- Backend: github.com/Felice556/palestra-backend
