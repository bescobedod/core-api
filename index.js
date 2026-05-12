require('dotenv').config()
const express = require('express');
const cors = require('cors');
const routes = require('./routes/routes')
const { connectionDb } = require('./configuration/db');
const SapServiceLayerClient = require('./integrations/sap/sapClient');
const helmet = require('helmet');

const app = express();
const PORT = process.env.PORT || 8001;

// app.set('sapClient', sapClient);
app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }))
app.use('/core', routes);

app.listen(PORT, () => {
    connectionDb();
    console.log(`Server running on http://localhost:${PORT}`);
});