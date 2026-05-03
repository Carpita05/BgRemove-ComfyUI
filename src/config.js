'use strict';

/**
 * @file config.js
 * Centraliza la carga y validación de variables de entorno.
 * Se carga una sola vez al arrancar la aplicación.
 * Si falta alguna variable requerida, el proceso termina con un mensaje claro.
 */

require('dotenv').config();

/**
 * Variables de entorno que DEBEN estar definidas para que la app funcione.
 * La ausencia de cualquiera de ellas provoca una salida inmediata del proceso.
 */
const REQUIRED_VARS = [
  'COMFY_URL',
  'EVOLUTION_BASE_URL',
  'EVOLUTION_API_KEY',
  'EVOLUTION_INSTANCE_NAME',
];

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
  // ── Servidor Express ────────────────────────────────────────────────────────
  PORT: parseInt(process.env.PORT ?? '3000', 10),

  // ── ComfyUI ─────────────────────────────────────────────────────────────────
  COMFY_URL:            process.env.COMFY_URL,
  COMFY_NODE_LOGO_ID:   process.env.COMFY_NODE_LOGO_ID ?? '13',
  COMFY_NODE_OUTPUT_ID: process.env.COMFY_NODE_OUTPUT_ID ?? '5',
  COMFY_BG_FILENAME:    process.env.COMFY_BG_FILENAME ?? 'fondo.jpg',

  /** Fracción del fondo que ocupa la persona (0.1 – 1.0, o > 1.0 si desborda) */
  PERSON_SCALE: parseFloat(process.env.PERSON_SCALE ?? '1.15'),

  // ── WhatsApp / Utilidades ───────────────────────────────────────────────────
  GOOGLE_REVIEW_URL: process.env.GOOGLE_REVIEW_URL ?? 'https://g.page/r/CWAYKlgUL2eKEAE/review',
  /** Prefijo telefónico que se antepone a números de 9 dígitos (ej: '34' para España) */
  PHONE_PREFIX: process.env.PHONE_PREFIX ?? '34',

  // ── Evolution API ───────────────────────────────────────────────────────────
  /** URL base del servidor Evolution API (sin barra final). Ej: http://localhost:8080 */
  EVOLUTION_BASE_URL: process.env.EVOLUTION_BASE_URL,
  /** Token de seguridad (apikey) requerido en cada petición a Evolution API */
  EVOLUTION_API_KEY: process.env.EVOLUTION_API_KEY,
  /** Nombre de la instancia/sesión de WhatsApp creada en Evolution API */
  EVOLUTION_INSTANCE_NAME: process.env.EVOLUTION_INSTANCE_NAME,
};
