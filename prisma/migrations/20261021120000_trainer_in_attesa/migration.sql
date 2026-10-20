-- Trainer che si registrano da soli: restano "in attesa" finché l'amministratore non li approva.
-- DEFAULT true: tutti gli account già esistenti restano approvati, nessuno viene bloccato.
-- Aggiunge solo colonne: nessun dato esistente viene modificato o cancellato.
ALTER TABLE "User" ADD COLUMN "approvato" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "User" ADD COLUMN "presentazione" TEXT;
ALTER TABLE "User" ADD COLUMN "richiestaIl" TIMESTAMP(3);
