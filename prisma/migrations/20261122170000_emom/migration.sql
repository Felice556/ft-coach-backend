-- EMOM: un giro ogni N secondi (null = esercizio normale). Solo una colonna nuova, nessun dato toccato.
ALTER TABLE "Esercizio" ADD COLUMN "emomSecondi" INTEGER;
