'use strict';

/**
 * @file config.js
 * Centraliza la carga y validación de variables de entorno.
 * Se carga una sola vez al arrancar la aplicación.
 * Si falta alguna variable requerida, el proceso termina con un mensaje claro.
 */

require('dotenv').config();

/** Variables de entorno que DEBEN estar definidas para que la app funcione. */
const REQUIRED_VARS = ['COMFY_URL'];

for (const key of REQUIRED_VARS) {
  if (!process.env[key]) {
    console.error(
      `\n[config] ❌ Variable de entorno requerida no encontrada: "${key}"\n` +
      '  → Copia .env.example a .env y configura los valores antes de arrancar.\n'
    );
    process.exit(1);
  }
}

module.exports = {
  PORT: parseInt(process.env.PORT ?? '3000', 10),
  COMFY_URL: process.env.COMFY_URL,
  COMFY_NODE_LOGO_ID: process.env.COMFY_NODE_LOGO_ID ?? '13',
  COMFY_NODE_OUTPUT_ID: process.env.COMFY_NODE_OUTPUT_ID ?? '5',
  COMFY_BG_FILENAME: process.env.COMFY_BG_FILENAME ?? 'fondo.jpg',
  // Fracción del fondo que ocupa la persona (0.1 – 1.0, o > 1.0 si quieres que desborde)
  // PERSON_SCALE permite a las personas crecer más para llenar la pantalla
  PERSON_SCALE: process.env.PERSON_SCALE ?? '0.94',
  GOOGLE_REVIEW_URL: process.env.GOOGLE_REVIEW_URL ?? 'https://g.page/r/CWAYKlgUL2eKEAE/review',
  PHONE_PREFIX: process.env.PHONE_PREFIX ?? '34',
};
