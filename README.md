# Web Product Scraper → Excel (HTML + JS)

Aplicación 100% **HTML + JavaScript** (sin backend obligatorio) para escanear sitios web de productos —tanto estáticos como con mucho JavaScript (SPA)— y extraer la información en un archivo Excel, facilitando migraciones de catálogo entre plataformas.

## 🎯 Objetivo

Cuando se migra una tienda online de una plataforma a otra (por ejemplo, de Wix a Shopify, de WooCommerce a una plataforma propia, etc.), uno de los trabajos más tediosos es volver a cargar manualmente cada producto. Esta app automatiza ese proceso:

1. Escanea las páginas de productos de un sitio web, sin importar si el contenido se genera en el servidor o con JavaScript.
2. Extrae los datos relevantes de cada producto.
3. Genera un archivo `.xlsx` listo para descargar y usar como plantilla de importación en la nueva plataforma.

## ✨ Funcionalidades principales

- **Detección automática del tipo de sitio**: la app intenta primero una extracción rápida (HTML estático); si detecta que el contenido relevante no está presente en el HTML crudo, cambia automáticamente a modo de renderizado.
- **Dos motores de escaneo**:
  - **Modo estático**: descarga el HTML directamente (`fetch`) y lo parsea con el DOM Parser del navegador. Rápido y liviano.
  - **Modo dinámico (JS pesado)**: carga la página dentro de un `<iframe>` oculto (o una pestaña controlada), espera a que el JavaScript del sitio se ejecute y el contenido se pinte, y luego lee el DOM ya renderizado.
- **Extracción de datos** por producto:
  - Nombre
  - Precio (y precio con descuento, si existe)
  - Descripción corta y larga
  - Categoría / subcategoría
  - SKU / referencia
  - Imágenes (URLs)
  - Variantes (talla, color, etc.) si aplica
  - Stock / disponibilidad
  - URL original del producto
- **Exportación a Excel** directamente desde el navegador usando **SheetJS**, sin necesidad de servidor.
- **Reintentos y manejo de errores**: si una página falla o no se puede leer (CORS, timeout, etc.), se reporta en una hoja aparte ("Errores") en lugar de detener todo el proceso.
- **Configuración por selectores**: panel donde el usuario puede definir selectores CSS para sitios que no siguen un patrón estándar (nombre, precio, imagen, etc.).
- **Vista previa**: tabla en pantalla con los productos detectados antes de exportar, para revisar y corregir antes de generar el Excel.
- **Modo incremental**: posibilidad de re-escanear y actualizar solo productos nuevos o modificados, guardando el progreso en `localStorage`.

## 🧱 Arquitectura propuesta

```
scraper-app/
├── index.html             # UI principal (formulario de URL, configuración, vista previa)
├── css/
│   └── styles.css
├── js/
│   ├── app.js              # Orquesta el flujo completo
│   ├── crawler.js          # Descubre URLs de producto (sitemap o navegación de listados)
│   ├── fetcher-static.js   # Descarga HTML vía fetch (modo estático)
│   ├── fetcher-dynamic.js  # Renderiza la página en iframe oculto (modo JS pesado)
│   ├── extractor.js        # Extrae datos de cada página de producto usando selectores
│   ├── exporter.js         # Genera el archivo Excel con SheetJS
│   ├── storage.js          # Guarda configuración y progreso en localStorage
│   └── config/
│       └── sites/          # Configuraciones de selectores guardadas por sitio
└── README.md
```

## ⚙️ Tecnologías

- **HTML5 + CSS3 + JavaScript vanilla** (sin frameworks obligatorios, para mantenerlo simple y portable)
- **SheetJS (xlsx)** vía CDN para generar el archivo Excel directamente en el navegador
- **Fetch API** + **DOMParser** para el modo estático
- **`<iframe>` oculto** (sandboxed) para el modo dinámico, dejando que el JavaScript del sitio objetivo se ejecute antes de leer el DOM resultante
- **localStorage** para guardar configuraciones de selectores por sitio y progreso de escaneo

## ⚠️ Limitación técnica importante: CORS

Al ser una app puramente cliente (HTML/JS sin backend), el navegador aplica la política de **CORS**, que puede bloquear la lectura de contenido de otros dominios. Para que el escaneo funcione en la mayoría de sitios, la app debe contemplar:

- **Sitios sin restricciones CORS o mismo origen**: funcionan directamente con `fetch` o `iframe`.
- **Sitios con CORS restrictivo**: se necesita pasar las peticiones por un proxy intermedio (por ejemplo, un pequeño endpoint propio o un servicio público de proxy CORS) que reenvíe el HTML al navegador. Esto se puede dejar como **configuración opcional** (campo "URL de proxy") para que el usuario use el que prefiera, sin que sea parte obligatoria del flujo.
- Esta limitación se documentará claramente en la interfaz cuando un sitio no pueda leerse directamente.

## 🚀 Uso (propuesto)

1. Abrir `index.html` en el navegador (no requiere instalación ni servidor).
2. Pegar la URL del listado de productos o del sitemap del sitio a migrar.
3. (Opcional) Definir selectores CSS personalizados si el sitio tiene una estructura poco común.
4. (Opcional) Indicar una URL de proxy si el sitio bloquea peticiones por CORS.
5. Presionar **"Escanear"** — la app detecta automáticamente si necesita modo estático o dinámico.
6. Revisar la vista previa de productos detectados.
7. Presionar **"Exportar a Excel"** para descargar el archivo `.xlsx`.

### Parámetros configurables en la UI

| Parámetro           | Descripción                                                  |
| ------------------- | ------------------------------------------------------------ |
| URL del sitio       | Listado de productos o sitemap a escanear                    |
| Selectores CSS      | Nombre, precio, imagen, descripción, SKU, etc. (opcional)    |
| URL de proxy CORS   | Para sitios que bloquean peticiones cross-origin (opcional)  |
| Límite de productos | Útil para hacer pruebas antes del escaneo completo           |
| Modo forzado        | Forzar estático o dinámico, en lugar de detección automática |

## 📄 Formato del Excel generado

| Columna       | Descripción                             |
| ------------- | --------------------------------------- |
| nombre        | Nombre del producto                     |
| sku           | Código o referencia                     |
| precio        | Precio actual                           |
| precio_oferta | Precio con descuento (si existe)        |
| categoria     | Categoría principal                     |
| descripcion   | Descripción del producto                |
| imagenes      | URLs de imágenes separadas por `;`      |
| variantes     | Variantes (talla/color) en formato JSON |
| stock         | Disponibilidad / cantidad               |
| url_origen    | URL original del producto               |

## ⚠️ Consideraciones legales y éticas

- Revisar el archivo `robots.txt` del sitio antes de escanearlo.
- Verificar los términos de servicio del sitio respecto al scraping.
- Usarlo idealmente solo en sitios propios o con autorización explícita del dueño, dado que el objetivo es una migración legítima de datos.
- Configurar límites de velocidad (rate limiting) para no sobrecargar el servidor objetivo.

## 🗺️ Roadmap

- [ ] Soporte para autenticación (sitios con login)
- [ ] Detección automática de selectores mediante heurísticas
- [ ] Exportación adicional a CSV y JSON
- [ ] Interfaz web simple para configurar y lanzar el escaneo sin línea de comandos
- [ ] Descarga local de imágenes (no solo URLs)

## 📌 Notas

Este README describe el proyecto a nivel funcional y de arquitectura. Aún falta implementar el código fuente; puede usarse como guía de desarrollo o como documento para alinear expectativas antes de construir la herramienta.
