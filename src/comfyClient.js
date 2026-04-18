'use strict';

/**
 * @file comfyClient.js
 * Cliente de la API REST de ComfyUI.
 * Responsabilidades:
 *   1. Subir imágenes al input de ComfyUI.
 *   2. Encolar un workflow (prompt).
 *   3. Hacer polling al endpoint /history hasta que el job termine (con timeout).
 *   4. Descargar la imagen resultante y guardarla localmente en ./outputs/.
 */

const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const config = require('./config');

/** Directorio local donde se guardan las imágenes generadas. */
const OUTPUTS_DIR = path.join(__dirname, '..', 'outputs');

/** Intervalo de polling al endpoint /history de ComfyUI (ms). */
const POLL_INTERVAL_MS = 1_500;

// ---------------------------------------------------------------------------
// Helpers internos
// ---------------------------------------------------------------------------

/** Crea ./outputs/ si no existe. */
function ensureOutputsDir() {
  if (!fs.existsSync(OUTPUTS_DIR)) {
    fs.mkdirSync(OUTPUTS_DIR, { recursive: true });
  }
}

/**
 * Sube una imagen al directorio de inputs de ComfyUI.
 *
 * @param {string} filePath     - Ruta absoluta del archivo temporal (multer).
 * @param {string} uploadedName - Nombre con el que se registrará en ComfyUI.
 * @returns {Promise<string>}   - Nombre asignado por ComfyUI al archivo subido.
 */
async function uploadImage(filePath, uploadedName) {
  const formData = new FormData();
  formData.append('image', fs.createReadStream(filePath), uploadedName);

  const { data } = await axios.post(
    `${config.COMFY_URL}/upload/image`,
    formData,
    { headers: formData.getHeaders() }
  );

  // Eliminar el temporal de multer tras el upload exitoso
  fs.unlink(filePath, (err) => {
    if (err) console.warn('[comfyClient] No se pudo eliminar el temporal:', err.message);
  });

  return data.name;
}

/**
 * Envía un workflow al endpoint /prompt de ComfyUI para encolarlo.
 *
 * @param {object} workflow - Objeto JSON del workflow con los inputs ya modificados.
 * @returns {Promise<string>} - El prompt_id generado por ComfyUI.
 */
async function queuePrompt(workflow) {
  const { data } = await axios.post(`${config.COMFY_URL}/prompt`, { prompt: workflow });
  return data.prompt_id;
}

/**
 * Hace polling al endpoint /history/{promptId} hasta que el job se complete.
 * Lanza un error si se supera el tiempo máximo de espera.
 *
 * @param {string} promptId        - ID del prompt a monitorizar.
 * @param {number} [timeoutMs=120000] - Timeout en ms (por defecto 2 minutos).
 * @returns {Promise<string>}      - Nombre del archivo de imagen generado por ComfyUI.
 * @throws {Error}                 - Si hay timeout o ComfyUI reporta un error interno.
 */
async function waitForResult(promptId, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));

    const { data } = await axios.get(`${config.COMFY_URL}/history/${promptId}`);
    const entry = data[promptId];

    // El prompt aún no ha empezado a procesarse
    if (!entry) continue;

    // ComfyUI reportó un error interno en la ejecución del nodo
    if (entry.status?.status_str === 'error') {
      throw new Error(
        `ComfyUI reportó un error al procesar el prompt "${promptId}". ` +
        'Revisa la consola de ComfyUI para más detalles.'
      );
    }

    if (entry.status?.completed) {
      const outputNodeId = config.COMFY_NODE_OUTPUT_ID;
      const images = entry.outputs?.[outputNodeId]?.images;

      if (!images || images.length === 0) {
        throw new Error(
          `El nodo de salida "${outputNodeId}" no produjo ninguna imagen. ` +
          'Verifica que COMFY_NODE_OUTPUT_ID apunta al nodo SaveImage correcto.'
        );
      }

      return images[0].filename;
    }
  }

  throw new Error(
    `Timeout: ComfyUI no completó la generación en ${timeoutMs / 1000} segundos. ` +
    'Comprueba que el servidor ComfyUI está activo y tiene recursos disponibles.'
  );
}

/**
 * Descarga la imagen generada desde ComfyUI y la guarda localmente en ./outputs/.
 * Usa la Opción A: streaming via GET /view?filename=...&type=output.
 *
 * @param {string} comfyFilename - Nombre del archivo tal como lo devuelve ComfyUI.
 * @returns {Promise<string>}    - Ruta absoluta del archivo guardado localmente.
 */
async function downloadImage(comfyFilename) {
  ensureOutputsDir();

  const { data } = await axios.get(`${config.COMFY_URL}/view`, {
    params: { filename: comfyFilename, type: 'output' },
    responseType: 'arraybuffer',
  });

  // Nombre único para evitar colisiones entre sesiones simultáneas
  const localFilename = `${Date.now()}_${comfyFilename}`;
  const localPath = path.join(OUTPUTS_DIR, localFilename);

  fs.writeFileSync(localPath, Buffer.from(data));
  console.info(`[comfyClient] ✅ Imagen guardada localmente en: ${localPath}`);

  return localPath;
}

// ---------------------------------------------------------------------------
// API pública del módulo
// ---------------------------------------------------------------------------

/**
 * Obtiene las dimensiones del fondo directamente desde ComfyUI via /view.
 * Si falla (ComfyUI apagado o fondo no encontrado), devuelve un fallback razonable.
 *
 * @returns {Promise<{width: number, height: number}>}
 */
async function getBackgroundDimensions() {
  const BG_FILENAME = config.COMFY_BG_FILENAME ?? 'fondo (1).jpg';
  try {
    const { data } = await axios.get(`${config.COMFY_URL}/view`, {
      params: { filename: BG_FILENAME, type: 'input' },
      responseType: 'arraybuffer',
    });
    const meta = await sharp(Buffer.from(data)).metadata();
    console.info(`[comfyClient] Fondo detectado: ${meta.width}x${meta.height}px`);
    return { width: meta.width, height: meta.height };
  } catch (err) {
    console.warn(`[comfyClient] No se pudo leer el fondo "${BG_FILENAME}": ${err.message}`);
    console.warn('[comfyClient] Usando dimensiones de fallback: 1920x1080');
    return { width: 1920, height: 1080 };
  }
}

/**
 * Preprocesa la imagen del cliente antes de enviarla a ComfyUI:
 *   1. Corrige la orientación EXIF (causa de deformación en fotos de móvil).
 *   2. Redimensiona para que encaje DENTRO de un límite (ancho x alto).
 *   3. Exporta como JPEG normalizado.
 *
 * @param {string} inputPath    - Ruta del temporal de multer.
 * @param {number} targetWidth  - Anchura máxima permitida en píxeles.
 * @param {number} targetHeight - Altura máxima permitida en píxeles.
 * @returns {Promise<{path: string, width: number, height: number}>}
 */
async function preprocessImage(inputPath, targetWidth, targetHeight) {
  const outputPath = `${inputPath}_ready.jpg`;

  // Log de diagnóstico: dimensiones y orientación EXIF originales
  const originMeta = await sharp(inputPath).metadata();
  console.info(
    `[comfyClient] Foto original → ${originMeta.width}x${originMeta.height}px | ` +
    `EXIF orientación: ${originMeta.orientation ?? 'sin datos'}`
  );

  await sharp(inputPath)
    // Aplica la rotación EXIF y elimina el tag del resultado.
    // Es la causa principal de fotos "tumbadas" al llegar a ComfyUI.
    .rotate()
    .resize({
      width: Math.max(1, targetWidth),
      height: Math.max(1, targetHeight),
      fit: 'inside',             // mantiene el aspect ratio sin recortar, garantizando que quepa
      // Permitimos enlargement para que fotos pequeñas de móvil SE HAGAN más grandes si lo pides.
    })
    .jpeg({ quality: 92, progressive: true })
    .toFile(outputPath);

  const finalMeta = await sharp(outputPath).metadata();
  console.info(
    `[comfyClient] Foto procesada → ${finalMeta.width}x${finalMeta.height}px ` +
    `(caja máxima: ${targetWidth}x${targetHeight})`
  );

  return { path: outputPath, width: finalMeta.width, height: finalMeta.height };
}

/**
 * Orquesta el flujo completo: preprocesar → upload → encolar → esperar → descargar.
 * Calcula automáticamente el tamaño y la posición centrada de la persona
 * en función de las dimensiones reales del fondo.
 *
 * @param {object} params
 * @param {string} params.filePath     - Ruta absoluta del temporal de multer.
 * @param {string} params.originalName - Nombre original del archivo subido.
 * @param {string} params.logoName     - Nombre del logo a inyectar.
 * @returns {Promise<{localPath: string, outputFilename: string}>}
 */
async function processImage({ filePath, originalName, logoName }) {
  const workflowPath = path.join(__dirname, '..', 'workflow.json');
  const workflow = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));

  // ── PASO 1: Obtener dimensiones del fondo ─────────────────────────────────
  const bg = await getBackgroundDimensions();

  // ── PASO 2: Calcular tamaño objetivo de la persona ────────────────────────
  // PERSON_SCALE (0.1–1.0): fracción que la persona puede ocupar del fondo (máximo).
  // Se aplica la escala a ambas dimensiones para asegurarse de que NUNCA sea 
  // más ancha que el fondo en fotos horizontales.
  const personScale = parseFloat(config.PERSON_SCALE ?? '0.70');
  const targetWidth = Math.round(bg.width * personScale);
  const targetHeight = Math.round(bg.height * personScale);

  // ── PASO 3: Preprocesar → corregir EXIF + escalar de forma segura ─────────
  const processed = await preprocessImage(filePath, targetWidth, targetHeight);

  // ── PASO 4: Centrar en X e Y (Totalmente centralizado) ────────────────────
  // ComfyUI (ImageCompositeMasked) devuelve error HTTP 400 si `x` o `y` son negativos.
  // Usamos Math.max(0, ...) para garantizar que nunca baje de 0.
  // Si la imagen es más grande que el fondo (ej. escala 1.2), se anclará a la 
  // esquina (0,0) superior izquierda, recortando el sobrante derecho y debajoo.
  const centerX = Math.max(0, Math.round((bg.width - processed.width) / 2));
  const centerY = Math.max(0, Math.round((bg.height - processed.height) / 2));

  console.info(
    `[comfyClient] Composición → persona ${processed.width}x${processed.height}px ` +
    `en fondo ${bg.width}x${bg.height}px | x=${centerX}, y=${centerY}`
  );

  // ── PASO 5: Subir la imagen procesada a ComfyUI ───────────────────────────
  const safeOriginalName = originalName.replace(/[^a-zA-Z0-9.-]/g, '_');
  const uploadedName = await uploadImage(processed.path, `${Date.now()}_${safeOriginalName}`);

  // Limpiar el temporal original de multer
  fs.unlink(filePath, (err) => {
    if (err) console.warn('[comfyClient] No se pudo limpiar el temporal original:', err.message);
  });

  // ── PASO 6: Inyectar en el workflow ──────────────────────────────────────
  workflow['1'].inputs.image = uploadedName;
  workflow['3'].inputs.image = config.COMFY_BG_FILENAME ?? 'fondo (1).jpg';
  workflow[config.COMFY_NODE_LOGO_ID].inputs.image = logoName;

  // La imagen ya llega pre-escalada a su tamaño óptimo final → multiplicador a 1.0 (tamaño original)
  workflow['15'].inputs['resize_type.multiplier'] = 1.0;
  workflow['18'].inputs['resize_type.multiplier'] = 1.0;

  // Actualizar las coordenadas al centro exacto
  workflow['7'].inputs.x = centerX;
  workflow['7'].inputs.y = centerY;

  // ── PASO 7: Encolar → esperar → descargar ────────────────────────────────
  const promptId = await queuePrompt(workflow);
  const comfyFilename = await waitForResult(promptId);
  const localPath = await downloadImage(comfyFilename);

  return { localPath, outputFilename: path.basename(localPath) };
}

module.exports = { processImage };

