-- Il gruppo "Braccia" della libreria si divide in Bicipiti e Tricipiti.
-- Qui si aggiungono solo i due valori nuovi; BRACCIA resta, così nessun esercizio salvato si perde.
-- (Lo spostamento degli esercizi è nella migrazione successiva: Postgres vuole i valori nuovi già salvati.)

-- AlterEnum
ALTER TYPE "GruppoMuscolare" ADD VALUE 'BICIPITI';
ALTER TYPE "GruppoMuscolare" ADD VALUE 'TRICIPITI';
