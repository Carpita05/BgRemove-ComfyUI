'use strict';

/**
 * @file imageRoutes.js
 * Rutas Express para el flujo web de generación de imágenes:
 *   POST /procesar-imagen     → sube foto, lanza ComfyUI, muestra vista previa.
 *   POST /enviar-confirmacion → envía la imagen local al cliente por WhatsApp.
 *
 * Las páginas HTML de respuesta se construyen con funciones dedicadas al final
 * del archivo para mantener las rutas limpias y legibles.
 */

const express  = require('express');
const multer   = require('multer');
const path     = require('path');
const fs       = require('fs');
const { processImage }       = require('../comfyClient');
const { sendImageToContact } = require('../whatsappBot');
const config   = require('../config');

const router = express.Router();

/**
 * Multer: almacenamiento temporal en ./uploads/ (relativo a la raíz del proyecto).
 * Límite de 20 MB para evitar que clientes suban archivos arbitrariamente grandes.
 */
const upload = multer({
  dest: path.join(__dirname, '..', '..', 'uploads'),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB máximo
});

// ── POST /procesar-imagen ────────────────────────────────────────────────────
/**
 * Flujo:
 *   1. Recibe foto, logo y datos del cliente desde el formulario web.
 *   2. Delega en comfyClient.processImage() → upload, encolar, polling, descarga.
 *   3. Muestra la vista previa con la imagen descargada localmente.
 */
router.post('/procesar-imagen', upload.single('foto_cliente'), async (req, res) => {
  const { telefono, nombre_cliente, logo_empresa } = req.body;

  // Validación server-side: no confiar únicamente en la validación del navegador
  if (!req.file) {
    return res.status(400).send(buildErrorPage('No se ha recibido ninguna imagen. Por favor, selecciona un archivo.'));
  }
  if (!telefono || !nombre_cliente || !logo_empresa) {
    return res.status(400).send(buildErrorPage('Faltan campos obligatorios (teléfono, nombre o logo). Rellena el formulario completo.'));
  }

  try {
    const { localPath, outputFilename } = await processImage({
      filePath:     req.file.path,
      originalName: req.file.originalname,
      logoName:     logo_empresa,
      clientName:   nombre_cliente,
    });

    // Construir la URL de preview de forma segura usando solo el basename
    const safeFilename = path.basename(outputFilename);
    const outputUrl = `/outputs/${safeFilename}`;

    res.send(buildResultPage({ nombre: nombre_cliente, telefono, outputUrl, outputFilename: safeFilename }));

  } catch (err) {
    // Log técnico completo en el servidor (con stack trace), mensaje genérico al cliente.
    console.error('[route /procesar-imagen] Error interno:', err);
    res.status(500).send(buildErrorPage('Error interno al procesar la imagen. Comprueba que ComfyUI está activo e inténtalo de nuevo.'));
  }
});

// ── POST /enviar-confirmacion ────────────────────────────────────────────────
/**
 * Flujo:
 *   1. Lee la ruta local del archivo (guardado en ./outputs/ en el paso anterior).
 *   2. Llama a whatsappBot.sendImageToContact().
 *   3. Muestra página de confirmación o de error.
 */
router.post('/enviar-confirmacion', async (req, res) => {
  const { telefono, nombre, outputFilename } = req.body;

  // Validación server-side defensiva
  if (!telefono || !nombre || !outputFilename) {
    return res.status(400).send(buildErrorPage('Faltan datos de la solicitud (teléfono, nombre o archivo). Vuelve a generar la imagen.'));
  }

  // Seguridad: usar solo el basename para evitar ataques de path traversal
  const safeFilename = path.basename(outputFilename);
  const localImagePath = path.join(__dirname, '..', '..', 'outputs', safeFilename);

  // Verificar que el archivo existe antes de intentar enviarlo.
  // Usamos fs.promises.access (async) en lugar de existsSync (bloqueante).
  try {
    await fs.promises.access(localImagePath, fs.constants.R_OK);
  } catch {
    return res.status(404).send(buildErrorPage('El archivo de imagen no se encontró. Es posible que haya sido eliminado. Genera la imagen de nuevo.'));
  }

  try {
    const caption =
      `¡Hola ${nombre}! ✨ Aquí tienes tu foto personalizada. ` +
      `Déjanos una reseña: ${config.GOOGLE_REVIEW_URL}`;

    await sendImageToContact(telefono, localImagePath, caption);
    res.send(buildSentPage(nombre));

  } catch (err) {
    // Log técnico completo en el servidor, mensaje genérico al cliente.
    console.error('[route /enviar-confirmacion] Error interno:', err);
    res.status(500).send(buildErrorPage('Error al enviar la imagen por WhatsApp. Comprueba que Evolution API está activo e inténtalo de nuevo.'));
  }
});

// ── Constructores de páginas HTML ────────────────────────────────────────────

/** Cabecera HTML reutilizable para todas las páginas de respuesta. */
function htmlHead(title) {
  return /* html */`
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${escapeHtml(title)} · BgRemove ComfyUI</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="/style.css">
  `;
}

/**
 * Página de vista previa: muestra la imagen generada y el botón de confirmación.
 * @param {{nombre: string, telefono: string, outputUrl: string, outputFilename: string}} p
 */
function buildResultPage({ nombre, telefono, outputUrl, outputFilename }) {
  // IMPORTANTE: outputUrl se escapa para prevenir XSS en el atributo src
  return /* html */`<!DOCTYPE html>
<html lang="es">
<head>${htmlHead('Vista previa')}</head>
<body>
  <div class="container">
    <header>
      <h1>Vista previa generada</h1>
      <p>Revisa el resultado antes de enviarlo a ${escapeHtml(nombre)}</p>
    </header>

    <img class="result-img" src="${escapeHtml(outputUrl)}" alt="Montaje generado para ${escapeHtml(nombre)}">

    <form action="/enviar-confirmacion" method="POST">
      <input type="hidden" name="telefono"       value="${escapeHtml(telefono)}">
      <input type="hidden" name="nombre"          value="${escapeHtml(nombre)}">
      <input type="hidden" name="outputFilename"  value="${escapeHtml(outputFilename)}">
      <button type="submit" id="btn-enviar">✅ Transmitir por WhatsApp</button>
    </form>

    <a href="/" class="link-back">↩ Cancelar operación</a>
  </div>
</body>
</html>`;
}

/**
 * Página de confirmación de envío exitoso.
 * @param {string} nombre - Nombre del cliente al que se envió la imagen.
 */
function buildSentPage(nombre) {
  return /* html */`<!DOCTYPE html>
<html lang="es">
<head>${htmlHead('Enviado')}</head>
<body>
  <div class="container">
    <header>
      <h1>¡Imagen enviada!</h1>
      <p>El montaje fue transmitido correctamente a ${escapeHtml(nombre)}</p>
    </header>
    <p class="status-msg status-msg--success">
      ✅ La imagen ha sido enviada por WhatsApp exitosamente.
    </p>
    <a href="/" class="link-back">↩ Procesar nueva imagen</a>
  </div>
</body>
</html>`;
}

/**
 * Página de error genérica. Muestra un mensaje amigable al usuario sin exponer
 * detalles técnicos internos del servidor.
 * @param {string} userMessage - Mensaje descriptivo y seguro para mostrar al usuario.
 */
function buildErrorPage(userMessage) {
  return /* html */`<!DOCTYPE html>
<html lang="es">
<head>${htmlHead('Error')}</head>
<body>
  <div class="container">
    <header>
      <h1>Error en el proceso</h1>
      <p>Algo salió mal durante la generación o el envío</p>
    </header>
    <p class="status-msg status-msg--error">
      ❌ ${escapeHtml(userMessage)}
    </p>
    <a href="/" class="link-back">↩ Volver al inicio e intentarlo de nuevo</a>
  </div>
</body>
</html>`;
}

/**
 * Escapa caracteres HTML para evitar XSS al interpolar datos del usuario en el HTML.
 * @param {string} str
 * @returns {string}
 */
function escapeHtml(str) {
  return String(str)
    .replace(/&/g,  '&amp;')
    .replace(/</g,  '&lt;')
    .replace(/>/g,  '&gt;')
    .replace(/"/g,  '&quot;')
    .replace(/'/g,  '&#039;');
}

module.exports = router;
