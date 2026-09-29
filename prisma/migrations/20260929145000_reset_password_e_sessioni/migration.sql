-- AlterTable
ALTER TABLE "User" ADD COLUMN     "passwordTemporanea" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "versioneToken" INTEGER NOT NULL DEFAULT 0;
