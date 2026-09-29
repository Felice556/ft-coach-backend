import 'dotenv/config';
import app from './app.js';

// Senza queste variabili il server non può funzionare: meglio fermarsi subito
// all'avvio con un messaggio chiaro, invece di scoprirlo al primo login.
for (const nome of ['DATABASE_URL', 'JWT_SECRET']) {
  if (!process.env[nome]) {
    console.error(`Variabile d'ambiente mancante: ${nome}. Controlla il file .env (o le variabili su Render).`);
    process.exit(1);
  }
}

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server palestra in ascolto su porta ${PORT}`);
});
