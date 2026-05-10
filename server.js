'use strict';

/**
 * @file server.js
 * Entry point de la aplicación BgRemove-ComfyUI.
 *
 * Responsabilidades exclusivas de este archivo:
 *   - Cargar la configuración (y validar variables de entorno).
 *   - Crear y configurar la app Express.
 *   - Registrar los middlewares globales (logger, rutas, error handler).
 *   - Iniciar el servidor HTTP.
 *
 * Toda la lógica de negocio vive en src/.
 */

// config.js DEBE importarse primero: carga dotenv y valida las vars de entorno.
const config      = require('./src/config');
const express     = require('express');
const path        = require('path');
const fs          = require('fs');
const imageRoutes = require('./src/routes/imageRoutes');
const { startComfyUIMonitor } = require('./src/comfyClient');

// ── Manejadores de errores globales de Node.js ────────────────────────────────
// Evitan que el proceso muera silenciosamente ante promesas rechazadas o
// excepciones no capturadas fuera del ciclo request/response.
process.on('unhandledRejection', (reason) => {
  console.error('[server] ⚠️  Promesa rechazada no capturada:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('[server] 💀 Excepción no capturada — cerrando proceso:', err);
  process.exit(1);
});

// ── Directorios necesarios ───────────────────────────────────────────────────
// Garantiza que ./uploads/ y ./outputs/ existen antes de recibir peticiones.
['uploads', 'outputs'].forEach((dir) => {
  const fullPath = path.join(__dirname, dir);
  if (!fs.existsSync(fullPath)) {
    fs.mkdirSync(fullPath, { recursive: true });
    console.info(`[server] 📁 Directorio creado: ${fullPath}`);
  }
});

// ── App Express ──────────────────────────────────────────────────────────────
const app = express();

// Parsear cuerpos de formularios HTML (application/x-www-form-urlencoded)
app.use(express.urlencoded({ extended: true }));

// ── Logger de peticiones HTTP ────────────────────────────────────────────────
// Registra cada petición entrante: método, ruta, IP del cliente y tiempo de
// respuesta. Esencial para auditoría y diagnóstico en producción.
app.use((req, _res, next) => {
  const start = Date.now();
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'IP desconocida';

  console.info(`[HTTP] ➡️  ${req.method} ${req.url}  |  Cliente: ${ip}`);

  _res.on('finish', () => {
    const duration = Date.now() - start;
    console.info(
      `[HTTP] ⬅️  ${req.method} ${req.url}  |  Estado: ${_res.statusCode}  |  ${duration}ms`
    );
  });

  next();
});

// ── Detectar conexión inicial (Página Web) ───────────────────────────────────
// Este middleware se ejecuta al cargar la página raíz. Nos permite lanzar un
// mensaje claro en consola cuando alguien entra desde el navegador.
app.get('/', (req, res, next) => {
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'Desconocida';
  const userAgent = req.headers['user-agent'] || 'Dispositivo desconocido';
  
  console.info('\n===============================================================');
  console.info(`🌐 ¡NUEVA CONEXIÓN! Alguien ha entrado a la web desde un navegador.`);
  console.info(`   IP: ${ip}`);
  console.info(`   Dispositivo: ${userAgent}`);
  console.info('===============================================================\n');
  
  // Pasamos el control al siguiente middleware (que será express.static)
  // para que sirva el archivo index.html.
  next();
});

// Archivos estáticos del frontend (HTML, CSS, etc.)
app.use(express.static(path.join(__dirname, 'public')));

// Imágenes generadas accesibles como estáticos bajo /outputs/
// Esto permite que la etiqueta <img src="/outputs/..."> funcione directamente.
app.use('/outputs', express.static(path.join(__dirname, 'outputs')));

// ── Rutas de la API ──────────────────────────────────────────────────────────
app.use('/', imageRoutes);

// ── Manejador de errores global de Express ───────────────────────────────────
// Captura cualquier error que llegue aquí via next(err) o excepciones síncronas
// en middlewares. Debe declararse DESPUÉS de todas las rutas.
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error('[server] 🔥 Error no controlado en Express:', err);
  res.status(500).send('Error interno del servidor.');
});

// ── Arranque ─────────────────────────────────────────────────────────────────
app.listen(config.PORT, () => {
  console.info('');
  console.info('╔══════════════════════════════════════════════════╗');
  console.info(`║  🚀  Servidor activo en http://localhost:${config.PORT}    ║`);
  console.info('║  🟢  Esperando conexiones de clientes…            ║');
  console.info('╚══════════════════════════════════════════════════╝');
  console.info('');
  
  // Iniciar monitorización en segundo plano (comprueba cada 10s)
  startComfyUIMonitor(10000);
});