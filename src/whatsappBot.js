'use strict';

/**
 * @file whatsappBot.js
 * Adaptador para enviar mensajes multimedia a través de Evolution API.
 *
 * Responsabilidades:
 *   - Exponer sendImageToContact() que hace una petición HTTP POST a Evolution API.
 *   - Normalizar números de teléfono al formato internacional antes de enviarlos.
 *
 * Nota: La autenticación de la sesión de WhatsApp (QR, Baileys, etc.) es
 * gestionada íntegramente por el servidor Evolution API externo.
 * Este módulo solo actúa como cliente HTTP de dicho servidor.
 */

const fs     = require('fs');
const path   = require('path');
const config = require('./config');

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

/**
 * Normaliza un número de teléfono al formato internacional completo.
 * Si el número tiene exactamente 9 dígitos, se antepone el PHONE_PREFIX del .env.
 *
 * @param {string} rawPhone - Número tal como lo introduce el usuario.
 * @returns {string}        - Número solo con dígitos, listo para la API.
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
 * Envía una imagen local a un contacto de WhatsApp a través de Evolution API.
 *
 * La imagen se lee desde el disco, se codifica en Base64 y se envía como
 * payload JSON al endpoint POST /message/sendMedia/{instanceName} de Evolution API.
 *
 * @param {string} rawPhone       - Número de teléfono (con o sin prefijo de país).
 * @param {string} localImagePath - Ruta absoluta de la imagen en el disco del servidor.
 * @param {string} caption        - Texto que acompaña a la imagen (pie de foto).
 * @returns {Promise<void>}
 * @throws {Error} Si la petición a Evolution API falla o devuelve un error HTTP.
 */
async function sendImageToContact(rawPhone, localImagePath, caption) {
  const phone = formatPhoneNumber(rawPhone);

  // Leer la imagen del disco y convertirla a Base64
  const imageBuffer  = fs.readFileSync(localImagePath);
  const base64Image  = imageBuffer.toString('base64');
  const mimeType     = _getMimeType(localImagePath);

  // Construir la URL del endpoint de Evolution API
  const url = `${config.EVOLUTION_BASE_URL}/message/sendMedia/${config.EVOLUTION_INSTANCE_NAME}`;

  // Cuerpo de la petición según la spec de Evolution API v2
  const body = {
    number:  `${phone}@s.whatsapp.net`,
    mediatype: 'image',
    mimetype: mimeType,
    caption:  caption ?? '',
    media:    base64Image,
    fileName: path.basename(localImagePath),
  };

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey':        config.EVOLUTION_API_KEY,
      },
      body: JSON.stringify(body),
    });

    // Si la respuesta no es 2xx, lanzamos un error con el detalle del servidor
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Evolution API respondió con ${response.status} ${response.statusText}: ${errorText}`
      );
    }

    console.info(`[WhatsApp] ✅ Imagen enviada correctamente a ${phone} vía Evolution API.`);

  } catch (err) {
    // Capturamos tanto errores de red (servidor caído) como errores HTTP (4xx/5xx)
    console.error('[WhatsApp] ❌ Error al enviar imagen via Evolution API:', err.message);
    throw err; // Re-lanzamos para que la ruta pueda devolver un 500 al cliente
  }
}

// ---------------------------------------------------------------------------
// Helpers privados
// ---------------------------------------------------------------------------

/**
 * Devuelve el MIME type correcto en función de la extensión del archivo.
 * Evolution API requiere este campo para procesar correctamente el adjunto.
 *
 * @param {string} filePath - Ruta o nombre de archivo.
 * @returns {string}        - MIME type (por defecto 'image/jpeg').
 */
function _getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const mimeMap = {
    '.jpg':  'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png':  'image/png',
    '.gif':  'image/gif',
    '.webp': 'image/webp',
  };
  return mimeMap[ext] ?? 'image/jpeg';
}

module.exports = { sendImageToContact, formatPhoneNumber };
