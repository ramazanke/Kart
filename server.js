require('dotenv').config();
const app = require('./api/index');

const port = Number(process.env.PORT || 3000);
app.listen(port, () => {
  console.log(`Kartvizit uygulamasi http://localhost:${port} adresinde calisiyor.`);
});
