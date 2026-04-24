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
 * Orquesta el flujo completo: preprocesar → upload → encolar → esperar → descargar.
 * Calcula automáticamente el tamaño y la posición centrada de la persona
 * en función de las dimensiones reales del fondo.
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
  const workflow = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));

  // ── PASO 1: Obtener dimensiones del fondo ────────────────────────────────
  const bg = await getBackgroundDimensions();

  // ── PASO 1.5: Preparar el logo: recortar bordes negros + subir a ComfyUI ──
  // El logo.png tiene bordes negros grandes que hacen que el cálculo de posición
  // y escala sea incorrecto. Hacemos trim ANTES de calcular cualquier dimensión.
  const logo = await prepareAndUploadLogo(logoName);

  // ── PASO 2: Reservar espacio para el logo arriba + calcular tamaño persona ─
  // El logo tendrá como máximo el 55% del ancho del fondo,
  // y no más del 18% del alto (sin contar márgenes).
  const LOGO_TARGET_WIDTH_RATIO = 0.55;
  const LOGO_MAX_HEIGHT_RATIO = 0.18;
  const LOGO_MARGIN_TOP = Math.max(15, Math.round(bg.height * 0.025));
  const LOGO_MARGIN_BOTTOM = Math.max(10, Math.round(bg.height * 0.015));

  let logoMultiplier = (bg.width * LOGO_TARGET_WIDTH_RATIO) / logo.width;
  if ((logo.height * logoMultiplier) > (bg.height * LOGO_MAX_HEIGHT_RATIO)) {
    logoMultiplier = (bg.height * LOGO_MAX_HEIGHT_RATIO) / logo.height;
  }

  const finalLogoWidth = Math.round(logo.width * logoMultiplier);
  const finalLogoHeight = Math.round(logo.height * logoMultiplier);
  const logoX = Math.round((bg.width - finalLogoWidth) / 2);
  const logoY = LOGO_MARGIN_TOP;

  // Espacio vertical total reservado para el logo (desde arriba)
  const logoReservedHeight = logoY + finalLogoHeight + LOGO_MARGIN_BOTTOM;

  console.info(
    `[comfyClient] Logo → escala=${logoMultiplier.toFixed(3)}, ` +
    `tamaño=${finalLogoWidth}x${finalLogoHeight}px | x=${logoX}, y=${logoY} | ` +
    `espacio reservado arriba: ${logoReservedHeight}px`
  );

  // ── PASO 2.5: Calcular tamaño objetivo de la persona ──────────────────────
  // PERSON_SCALE: fracción del fondo que pueden ocupar. Como las fotos originales
  // pueden tener mucho "cielo" que luego se recorta, permitimos que crezcan bastante.
  const personScale = parseFloat(config.PERSON_SCALE ?? '1.0');
  const targetWidth  = Math.round(bg.width * personScale);
  const targetHeight = Math.round(bg.height * personScale);

  // ── PASO 3: Preprocesar → corregir EXIF + escalar de forma segura ─────────
  const processed = await preprocessImage(filePath, targetWidth, targetHeight);

  // ── PASO 4: Centrar persona en X; anclarla abajo en Y ────────────────────
  // ComfyUI devuelve error HTTP 400 si `x` o `y` son negativos.
  // Como la foto original tiene fondo que luego se elimina, el sujeto suele estar abajo.
  // Al anclar la foto completa a la parte inferior del fondo, las cabezas subirán.
  const centerX = Math.max(0, Math.round((bg.width - processed.width) / 2));
  // Pega la foto a la parte inferior (dejando que el cielo vacío esté arriba), 
  // pero nunca con coordenadas negativas.
  const personY = Math.max(0, bg.height - processed.height);

  console.info(
    `[comfyClient] Composición → persona ${processed.width}x${processed.height}px ` +
    `en fondo ${bg.width}x${bg.height}px | x=${centerX}, y=${personY}`
  );

  // ── PASO 5: Subir la imagen procesada a ComfyUI ───────────────────────────
  const safeOriginalName = originalName.replace(/[^a-zA-Z0-9.-]/g, '_');
  const uploadedName = await uploadImage(processed.path, `${Date.now()}_${safeOriginalName}`);

  // Limpiar el temporal original de multer
  fs.unlink(filePath, (err) => {
    if (err) console.warn('[comfyClient] No se pudo limpiar el temporal original:', err.message);
  });

  // ── PASO 6: Inyectar en el workflow ───────────────────────────────────────
  workflow['1'].inputs.image = uploadedName;
  workflow['3'].inputs.image = config.COMFY_BG_FILENAME ?? 'fondo.jpg';
  // Usar el logo ya recortado y subido (sin bordes negros)
  workflow[config.COMFY_NODE_LOGO_ID].inputs.image = logo.uploadedName;

  // La imagen del usuario ya llega pre-escalada → multiplicador a 1.0
  workflow['15'].inputs['resize_type.multiplier'] = 1.0;
  workflow['18'].inputs['resize_type.multiplier'] = 1.0;

  // Posición de la persona (centro horizontal, debajo del logo)
  workflow['7'].inputs.x = centerX;
  workflow['7'].inputs.y = personY;

  // ── PASO 6.5: Escalar y posicionar el logo (ya recortado) ─────────────────
  workflow['17'].inputs['resize_type.multiplier'] = Number(logoMultiplier.toFixed(3));
  workflow['19'].inputs['resize_type.multiplier'] = Number(logoMultiplier.toFixed(3));
  workflow['16'].inputs.x = logoX;
  workflow['16'].inputs.y = logoY;

  // ── PASO 7: Encolar → esperar → descargar ────────────────────────────────
  const promptId = await queuePrompt(workflow);
  const comfyFilename = await waitForResult(promptId);
  const localPath = await downloadImage(comfyFilename);

  // ── PASO 8: Superponer texto ¡FELICIDADES! al final de la imagen ──────────
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
  // Aproximación: cada carácter ocupa ~0.55x el font-size en ancho.
  // Dejamos un margen lateral de 5% a cada lado (90% del ancho disponible).
  const maxTextWidth = imgWidth * 0.90;
  const charsEstimate = text.length;
  let fontSize = Math.floor(maxTextWidth / (charsEstimate * 0.55));
  fontSize = Math.min(fontSize, Math.round(bannerHeight * 0.60)); // nunca mayor que la banda
  fontSize = Math.max(fontSize, 20); // mínimo legible

  // Posición del texto: centro de la banda inferior
  const textY = imgHeight - bannerHeight + Math.round(bannerHeight * 0.68);

  const svgOverlay = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${imgWidth}" height="${imgHeight}">
      <!-- Sombra del texto -->
      <text
        x="${Math.round(imgWidth / 2) + 3}" y="${textY + 3}"
        font-family="Arial Black, Arial, sans-serif"
        font-size="${fontSize}"
        font-weight="900"
        text-anchor="middle"
        fill="rgba(0,0,0,0.6)"
      >${text}</text>
      <!-- Texto principal: blanco con borde rojo -->
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

