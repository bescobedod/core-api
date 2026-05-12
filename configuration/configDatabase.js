require('dotenv').config();
const fs = require('fs');
const path = require('path');

const rdsCaPath = process.env.PG_CA_PATH || path.resolve(__dirname, '..', 'certs', 'global-bundle.pem');

let rdsCa = undefined;

try {
  if(fs.existsSync(rdsCaPath)) {
    rdsCa = fs.readFileSync(rdsCaPath, 'utf8');
  }
} catch (error) {
  console.warn('No se pudo leer el CA bundle de RDS: ', error.message);
}

const configDatabase = {
  CORE: {
      database: process.env.DB_DATABASE,
      username: process.env.DB_USERNAME,
      password: process.env.DB_PASSWORD,
      options: {
          host: process.env.DB_HOST,
          port: process.env.DB_PORT,
          dialect: process.env.DB_CONNECTION,
          timezone: '-06:00',
          dialectOptions: {
            ssl: process.env.DB_SSL === '0' ? false : {
              require: true,
              rejectUnauthorized: false,
              ca: rdsCa
            }
          },
          loggin: false
      }
  },
  NOMINA: {
    database: process.env.DB_SECOND_DATABASE,
    username: process.env.DB_SECOND_USERNAME,
    password: process.env.DB_SECOND_PASSWORD,
    options: {
      host: process.env.DB_SECOND_HOST,
      port: process.env.DB_SECOND_PORT,
      dialect: process.env.DB_SECOND_CONNECTION,
      timezone: 'America/Guatemala',
      dialectOptions: {
        ssl: {
          require: true,
          rejectUnauthorized: false
        },
      },
    }
  },
  PDV: {
    database: process.env.DB_THIRD_DATABASE,
    username: process.env.DB_THIRD_USERNAME,
    password: process.env.DB_THIRD_PASSWORD,
    options: {
      host: process.env.DB_THIRD_HOST,
      port: process.env.DB_THIRD_PORT,
      dialect: process.env.DB_THIRD_CONNECTION,
      timezone: 'America/Guatemala',
      dialectOptions: {
        ssl: {
          require: true,
          rejectUnauthorized: false
        },
      },
    }
  },
  PIOAPP: {
    database: process.env.DB_FOURTH_DATABASE,
    username: process.env.DB_FOURTH_USERNAME,
    password: process.env.DB_FOURTH_PASSWORD,
    options: {
      host: process.env.DB_FOURTH_HOST,
      port: process.env.DB_FOURTH_PORT,
      dialect: process.env.DB_FOURTH_CONNECTION,
      timezone: '-06:00',
      dialectOptions: {
        useUTC: false,
        ssl: {
          require: true,
          rejectUnauthorized: false
        }
      }
    }
  }
}

const DEFAULT_CONNECTION = 'CORE';
const PIOAPP_CONNECTION = 'PIOAPP'

module.exports = {
    configDatabase,
    DEFAULT_CONNECTION,
    PIOAPP_CONNECTION
}