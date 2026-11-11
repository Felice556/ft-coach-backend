-- Cluster: mini-serie uguali con una breve pausa tra una e l'altra ("5+5+5+5").
-- Solo due colonne nuove, vuote (null = niente cluster): gli esercizi esistenti restano identici.
-- Nessun dato viene cancellato o modificato.

-- AlterTable
ALTER TABLE "Esercizio" ADD COLUMN     "cluster" INTEGER;

-- AlterTable
ALTER TABLE "SerieExtra" ADD COLUMN     "cluster" INTEGER;
