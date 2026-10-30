-- Esercizi della libreria che erano in "Braccia": quelli riconoscibili dal nome passano
-- a Bicipiti o Tricipiti. Quelli non riconosciuti restano in "Braccia" e il trainer li sposta a mano.
-- Cambia solo il gruppo: nome, video, note e schede restano come sono.

UPDATE "EsercizioPreset"
SET "gruppo" = 'BICIPITI'
WHERE "gruppo" = 'BRACCIA'
  AND "nome" ~* '(curl|hammer|bicip|scott|spider|martello)';

UPDATE "EsercizioPreset"
SET "gruppo" = 'TRICIPITI'
WHERE "gruppo" = 'BRACCIA'
  AND "nome" ~* '(push ?down|pushdown|pressdown|tricip|french|dip|estension|kick ?back|skull|mani strette|presa stretta|close grip)';
