-- Circonferenze (torace, fianchi, bicipite, coscia) tra le misure del corpo.
-- Solo quattro valori nuovi nell'elenco dei tipi di misura: le misure esistenti restano identiche.
-- Nessun dato viene cancellato o modificato.

-- AlterEnum
ALTER TYPE "TipoMisura" ADD VALUE 'TORACE';
ALTER TYPE "TipoMisura" ADD VALUE 'FIANCHI';
ALTER TYPE "TipoMisura" ADD VALUE 'BICIPITE';
ALTER TYPE "TipoMisura" ADD VALUE 'COSCIA';
