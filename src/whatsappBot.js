'use strict';

/**
 * @file whatsappBot.js
 * Gestiona el cliente de whatsapp-web.js.
 * Responsabilidades:
 *   - Inicializar y autenticar la sesión (LocalAuth persiste el QR).
 *   - Exponer sendImageToContact() para que las rutas puedan enviar imágenes.
 *   - Normalizar números de teléfono al formato internacional.
 */

const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const config = require('./config');

// ---------------------------------------------------------------------------
// Inicialización del cliente
// ---------------------------------------------------------------------------

const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: {
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  },
});

client.on('qr', (qr) => {
  console.info('\n[WhatsApp] Escanea el QR con tu móvil para vincular la sesión:\n');
  qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
  console.info('[WhatsApp] ✅ Cliente conectado y listo para enviar mensajes.');
});

client.on('auth_failure', (msg) => {
  console.error('[WhatsApp] ❌ Fallo de autenticación:', msg);
});

client.on('disconnected', (reason) => {
  console.warn('[WhatsApp] ⚠️  Cliente desconectado. Razón:', reason);
});

client.initialize();

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

/**
 * Normaliza un número de teléfono al formato internacional completo.
 * Si el número tiene exactamente 9 dígitos, se antepone el PHONE_PREFIX del .env.
 *
 * @param {string} rawPhone - Número tal como lo introduce el usuario.
 * @returns {string}        - Número solo con dígitos, listo para WhatsApp.
 *
 * @example
 * formatPhoneNumber('600 123 456')  // → '34600123456'  (ES)
 * formatPhoneNumber('+34600123456') // → '34600123456'
 * formatPhoneNumber('34600123456')  // → '34600123456'
 */
function formatPhoneNumber(rawPhone) {
  const digits = rawPhone.replace(/\D/g, '');
  if (digits.length === 9) return `${config.PHONE_PREFIX}${digits}`;
  return digits;
}

// ---------------------------------------------------------------------------
// API pública del módulo
// ---------------------------------------------------------------------------

/**
 * Envía una imagen local a un contacto de WhatsApp.
 *
 * @param {string} rawPhone      - Número de teléfono (con o sin prefijo de país).
 * @param {string} localImagePath - Ruta absoluta de la imagen en el disco del servidor.
 * @param {string} caption       - Texto que acompaña a la imagen.
 * @returns {Promise<void>}
 * @throws {Error} Si el número no está en WhatsApp o el cliente no está listo.
 */
async function sendImageToContact(rawPhone, localImagePath, caption) {
  const phone    = formatPhoneNumber(rawPhone);
  const numberId = await client.getNumberId(phone);

  if (!numberId) {
    throw new Error(
      `El número "${phone}" no está registrado en WhatsApp. ` +
      'Verifica que el prefijo del país sea correcto (PHONE_PREFIX en .env).'
    );
  }

  const media = MessageMedia.fromFilePath(localImagePath);
  await client.sendMessage(numberId._serialized, media, { caption });

  console.info(`[WhatsApp] ✅ Imagen enviada correctamente a ${phone}`);
}

module.exports = { sendImageToContact, formatPhoneNumber };
