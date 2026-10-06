-- CreateEnum
CREATE TYPE "GruppoMuscolare" AS ENUM ('PETTO', 'DORSO', 'SPALLE', 'BRACCIA', 'GAMBE', 'ADDOME', 'CARDIO', 'ALTRO');

-- AlterTable
ALTER TABLE "EsercizioPreset" ADD COLUMN     "gruppo" "GruppoMuscolare";
