-- Sospensione degli account (trainer dall'amministratore, clienti dal loro trainer).
-- DEFAULT false: nessuno è sospeso. Solo colonne nuove, nessun dato esistente toccato.
ALTER TABLE "User" ADD COLUMN "sospeso" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN "sospesoIl" TIMESTAMP(3);
