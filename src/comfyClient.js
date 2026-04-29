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
  const BG_FILENAME = config.COMFY_BG_FILENAME ?? 'fondo.jpg';
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
 * Preprocesa el logo: recorta los bordes transparentes/negros con sharp.trim(),
 * lo sube a ComfyUI como temporal y devuelve el nombre asignado y las dimensiones reales.
 *
 * @param {string} logoName - Nombre del logo en la carpeta input/ de ComfyUI.
 * @returns {Promise<{uploadedName: string, width: number, height: number}>}
 */
async function prepareAndUploadLogo(logoName) {
  // 1. Intentar obtener el logo desde ComfyUI; si falla, leer localmente desde ./images/
  let logoBuffer;
  try {
    const { data } = await axios.get(`${config.COMFY_URL}/view`, {
      params: { filename: logoName, type: 'input' },
      responseType: 'arraybuffer',
    });
    logoBuffer = Buffer.from(data);
    console.info(`[comfyClient] Logo descargado desde ComfyUI: ${logoName}`);
  } catch {
    const localLogoPath = path.join(__dirname, '..', 'images', logoName);
    logoBuffer = fs.readFileSync(localLogoPath);
    console.info(`[comfyClient] Logo leído localmente: ${localLogoPath}`);
  }

  // 2. Recortar bordes negros/transparentes para obtener las dimensiones reales del contenido.
  //    threshold: tolerancia de color que se considera "borde vacío" (0-255).
  //    Lo hacemos sobre PNG para preservar la transparencia alfa del logo.
  const trimmedBuffer = await sharp(logoBuffer)
    .trim({ background: '#000000', threshold: 30 })
    .png()
    .toBuffer();

  const trimmedMeta = await sharp(trimmedBuffer).metadata();
  console.info(
    `[comfyClient] Logo recortado: ${trimmedMeta.width}x${trimmedMeta.height}px ` +
    `(original antes del trim puede tener bordes negros)
`
  );

  // 3. Escribir el buffer recortado a un temporal y subirlo a ComfyUI
  const tmpLogoPath = path.join(OUTPUTS_DIR, `logo_trim_${Date.now()}.png`);
  ensureOutputsDir();
  fs.writeFileSync(tmpLogoPath, trimmedBuffer);

  const uploadedLogoName = await uploadImage(tmpLogoPath, `logo_trim_${Date.now()}.png`);
  console.info(`[comfyClient] Logo (recortado) subido a ComfyUI como: ${uploadedLogoName}`);

  return {
    uploadedName: uploadedLogoName,
    width: trimmedMeta.width,
    height: trimmedMeta.height,
  };
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
 * Inyecta de forma segura un valor en un nodo del workflow.
 * Si el nodo o la clave no existen, registra un aviso en lugar de lanzar un error.
 *
 * @param {object} workflow - Objeto del workflow cargado desde JSON.
 * @param {string} nodeId   - ID del nodo (clave en el objeto).
 * @param {string} key      - Propiedad dentro de `inputs` a sobreescribir.
 * @param {*}      value    - Valor a asignar.
 */
function injectSafe(workflow, nodeId, key, value) {
  if (!workflow[nodeId]) {
    console.warn(`[comfyClient] ⚠️  Nodo "${nodeId}" no encontrado en el workflow – se omite la inyección de "${key}".`);
    return;
  }
  if (!workflow[nodeId].inputs) {
    console.warn(`[comfyClient] ⚠️  El nodo "${nodeId}" no tiene campo "inputs" – se omite la inyección de "${key}".`);
    return;
  }
  workflow[nodeId].inputs[key] = value;
}

/**
 * Orquesta el flujo completo: preprocesar → upload → encolar → esperar → descargar.
 *
 * El nuevo workflow delega TODO el escalado y posicionado a ComfyUI mediante
 * nodos MathExpression + ImageScale + ImageCompositeMasked, por lo que este
 * cliente sólo necesita:
 *   1. Inyectar los nombres de archivo en los nodos LoadImage.
 *   2. (Opcional) Sobreescribir las coordenadas x/y de composición del logo
 *      si el nodo existe en el workflow (compatibilidad hacia adelante).
 *
 * @param {object} params
 * @param {string} params.filePath     - Ruta absoluta del temporal de multer.
 * @param {string} params.originalName - Nombre original del archivo subido.
 * @param {string} params.logoName     - Nombre del logo a inyectar.
 * @param {string} params.clientName   - Nombre del cliente para el texto "¡FELICIDADES!".
 * @returns {Promise<{localPath: string, outputFilename: string}>}
 */
async function processImage({ filePath, originalName, logoName, clientName }) {
  const workflowPath = path.join(__dirname, '..', 'workflow.json');
  let workflow;
  try {
    workflow = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));
  } catch (err) {
    throw new Error(`[comfyClient] No se pudo leer o parsear workflow.json: ${err.message}`);
  }

  // ── PASO 1: Preprocesar la imagen del cliente (corregir EXIF + normalizar) ─
  // Limitamos la resolución de subida a 2048px para no sobrecargar ComfyUI;
  // el workflow escala internamente con sus nodos ImageScale.
  const MAX_UPLOAD_PX = 2048;
  const processed = await preprocessImage(filePath, MAX_UPLOAD_PX, MAX_UPLOAD_PX);

  // ── PASO 2: Subir la imagen procesada a ComfyUI ───────────────────────────
  const safeOriginalName = originalName.replace(/[^a-zA-Z0-9.-]/g, '_');
  const uploadedName = await uploadImage(processed.path, `${Date.now()}_${safeOriginalName}`);
  console.info(`[comfyClient] Foto subida a ComfyUI como: ${uploadedName}`);

  // Liberar el temporal original de multer
  fs.unlink(filePath, (err) => {
    if (err) console.warn('[comfyClient] No se pudo limpiar el temporal original:', err.message);
  });

  // ── PASO 3: Preparar el logo: trim + subir ────────────────────────────────
  const logo = await prepareAndUploadLogo(logoName);

  // ── PASO 4: Inyectar imágenes en los nodos LoadImage ─────────────────────
  // Nodo 1 → foto de la persona
  injectSafe(workflow, '1', 'image', uploadedName);
  // Nodo 3 → imagen de fondo
  injectSafe(workflow, '3', 'image', config.COMFY_BG_FILENAME ?? 'fondo.jpg');
  // Nodo logo (por defecto '13', configurable en .env)
  injectSafe(workflow, config.COMFY_NODE_LOGO_ID, 'image', logo.uploadedName);

  // ── PASO 5 (Opcional): sobreescribir posición del logo en nodo '120' ──────
  // El workflow puede calcular estas coordenadas internamente con MathExpression;
  // sólo sobreescribimos si se desea afinar desde el servidor (nodo opcional).
  // Si los nodos no existen, injectSafe emite un aviso y continúa sin error.
  const bg = await getBackgroundDimensions();
  const LOGO_TARGET_WIDTH_RATIO = 0.80;
  const LOGO_MAX_HEIGHT_RATIO   = 0.26;
  const LOGO_MARGIN_TOP         = Math.max(15, Math.round(bg.height * 0.025));

  let logoMultiplier = (bg.width * LOGO_TARGET_WIDTH_RATIO) / logo.width;
  if ((logo.height * logoMultiplier) > (bg.height * LOGO_MAX_HEIGHT_RATIO)) {
    logoMultiplier = (bg.height * LOGO_MAX_HEIGHT_RATIO) / logo.height;
  }
  const finalLogoWidth = Math.round(logo.width * logoMultiplier);
  const logoX = Math.max(0, Math.round((bg.width - finalLogoWidth) / 2));
  const logoY = LOGO_MARGIN_TOP;

  console.info(
    `[comfyClient] Logo → escala=${logoMultiplier.toFixed(3)}, ` +
    `tamaño=${finalLogoWidth}x${Math.round(logo.height * logoMultiplier)}px | x=${logoX}, y=${logoY}`
  );

  // Composición del logo (nodo 120 en el nuevo workflow)
  injectSafe(workflow, '120', 'x', logoX);
  injectSafe(workflow, '120', 'y', logoY);

  // ── PASO 6: Encolar → esperar → descargar ────────────────────────────────
  const promptId = await queuePrompt(workflow);
  console.info(`[comfyClient] Workflow encolado con promptId: ${promptId}`);

  const comfyFilename = await waitForResult(promptId);
  const localPath = await downloadImage(comfyFilename);

  // ── PASO 7: Superponer texto ¡FELICIDADES! ───────────────────────────────
  const finalPath = await addTextOverlay(localPath, clientName);

  return { localPath: finalPath, outputFilename: path.basename(finalPath) };
}

/**
 * Añade el texto "¡FELICIDADES {nombre}!" en la parte inferior de la imagen de salida.
 * Usa SVG + sharp.composite para renderizar sin dependencias externas de fuentes.
 * El tamaño de fuente se calcula de forma adaptativa para que SIEMPRE quepa en el ancho.
 *
 * @param {string} imagePath  - Ruta absoluta de la imagen descargada.
 * @param {string} clientName - Nombre del cliente.
 * @returns {Promise<string>} - Ruta de la imagen con el texto incrustado.
 */
async function addTextOverlay(imagePath, clientName) {
  const meta = await sharp(imagePath).metadata();
  const imgWidth = meta.width;
  const imgHeight = meta.height;

  const text = `¡FELICIDADES ${(clientName ?? '').toUpperCase()}!`;

  // Zona inferior reservada para el texto: 12% del alto, mínimo 80px
  const bannerHeight = Math.max(80, Math.round(imgHeight * 0.12));

  // Calcular font-size adaptativo:
  // Aproximación: la fuente Arial Black es muy ancha, cada carácter ocupa ~0.75x el font-size en ancho.
  // Dejamos un margen lateral (80% del ancho disponible máximo).
  const maxTextWidth = imgWidth * 0.80;
  const charsEstimate = text.length;
  let fontSize = Math.floor(maxTextWidth / (charsEstimate * 0.75));
  fontSize = Math.min(fontSize, Math.round(bannerHeight * 0.60)); // nunca mayor que la banda
  fontSize = Math.max(fontSize, 20); // mínimo legible

  // Posición del texto: centro de la banda inferior
  const textY = imgHeight - bannerHeight + Math.round(bannerHeight * 0.68);

  const svgOverlay = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${imgWidth}" height="${imgHeight}">
      <defs>
        <filter id="drop-shadow" x="-50%" y="-50%" width="200%" height="200%">
          <feDropShadow dx="3" dy="6" stdDeviation="5" flood-color="#000000" flood-opacity="1.0"/>
          <feDropShadow dx="0" dy="0" stdDeviation="8" flood-color="#000000" flood-opacity="0.7"/>
        </filter>
      </defs>
      <!-- Texto principal con sombreado -->
      <text
        x="${Math.round(imgWidth / 2)}" y="${textY}"
        font-family="Arial Black, Arial, sans-serif"
        font-size="${fontSize}"
        font-weight="900"
        text-anchor="middle"
        fill="#FFFFFF"
        stroke="#CC0000"
        stroke-width="${Math.max(1, Math.round(fontSize * 0.04))}"
        paint-order="stroke fill"
        filter="url(#drop-shadow)"
      >${text}</text>
    </svg>
  `;

  // Sobreescribir con la imagen + overlay (sharp no puede leer y escribir el mismo archivo)
  const outputPath = imagePath.replace(/\.(png|jpg|jpeg)$/i, '_final.jpg');
  await sharp(imagePath)
    .composite([{ input: Buffer.from(svgOverlay), top: 0, left: 0 }])
    .jpeg({ quality: 92 })
    .toFile(outputPath);

  console.info(`[comfyClient] ✅ Texto superpuesto → ${outputPath}`);
  return outputPath;
}

module.exports = { processImage };

