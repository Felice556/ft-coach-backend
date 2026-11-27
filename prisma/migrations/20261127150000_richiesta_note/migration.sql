-- "Guarda le mie note": il cliente chiede al trainer di leggere le sue note. Solo colonne nuove e vuote, nessun dato toccato.
ALTER TABLE "User" ADD COLUMN "richiestaNoteIl" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "richiestaNoteTesto" TEXT;
ALTER TABLE "User" ADD COLUMN "noteVisteIl" TIMESTAMP(3);
