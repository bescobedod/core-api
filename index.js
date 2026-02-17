require('dotenv').config()
const express = require('express');
const cors = require('cors');
const routes = require('./routes/routes')
const { connectionDb } = require('./configuration/db');
const SapServiceLayerClient = require('./integrations/sap/sapClient');

// const sapClient = new SapServiceLayerClient({
//     baseUrl: process.env.SAP_SL_URL
// });

// await sapClient.login({
//     companyDB: process.env.SAP_COMPANY_DB,
//     username: process.env.SAP_USERNAME,
//     password: process.env.SAP_PASSWORD
// });

const app = express();
const PORT = process.env.PORT || 8001;

// app.set('sapClient', sapClient);
app.use(cors());
app.use(express.json());
app.use('/core', routes);

app.listen(PORT, () => {
    connectionDb();
    console.log(`Server running on http://localhost:${PORT}`);
});