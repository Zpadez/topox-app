# Topox — Escanea catálogos, exporta a Excel

Aplicación **HTML + CSS + JavaScript vanilla** (sin backend obligatorio, sin frameworks, sin build) para escanear sitios web de productos —tanto estáticos como con mucho JavaScript— y extraer la información en un archivo Excel, facilitando migraciones de catálogo entre plataformas.

## 🎯 Objetivo

Cuando se migra una tienda online de una plataforma a otra (de Wix a Shopify, de WooCommerce a una plataforma propia, etc.), uno de los trabajos más tediosos es volver a cargar manualmente cada producto. Topox automatiza ese proceso:

1. Escanea una o varias páginas de un catálogo, sin importar si el contenido se genera en el servidor o con JavaScript.
2. Extrae los datos relevantes de cada producto.
3. Genera un archivo `.xlsx` listo para descargar, directamente desde el navegador.

## 🧱 Estructura del proyecto

```
topox/
├── index.html     # Estructura de la interfaz (formulario, panel de escaneo, tabla de resultados)
├── styles.css      # Estilos: paneles, tabla, animación de escaneo, estados vacíos/error
├── script.js       # Toda la lógica: fetch, parseo, heurísticas de extracción, paginación, export
├── img/
│   └── fav-icon.png
└── README.md
```

Es un proyecto sin dependencias de instalación: se abre `index.html` directamente en el navegador y funciona. La única librería externa es **SheetJS**, cargada vía CDN en el `<head>` del HTML.

## ⚙️ Tecnologías

- **HTML5 + CSS3 + JavaScript vanilla**, sin frameworks ni bundler.
- **SheetJS (xlsx)** vía CDN para generar el archivo Excel directamente en el navegador.
- **Fetch API** + **DOMParser** para el modo estático.
- **`<iframe>` oculto** (sandboxed) para el modo dinámico, dejando que el JavaScript del sitio objetivo se ejecute antes de leer el DOM resultante.
- **Cloudflare Workers** (opcional, externo) como proxy CORS propio para sitios que bloquean peticiones cross-origin.

## ✨ Funcionalidades

### Detección automática del tipo de sitio
Topox intenta primero una extracción rápida en modo estático (`fetch` + `DOMParser`). Si no encuentra productos en el HTML crudo, cambia automáticamente a modo dinámico, renderizando la página en un `<iframe>` oculto para dejar correr su JavaScript antes de leer el DOM. También se puede forzar uno de los dos modos manualmente.

### Extracción de productos
La detección combina dos fuentes, de la más a la menos confiable:
- **Datos estructurados `JSON-LD`** (`schema.org/Product`), cuando el sitio los expone — la señal más confiable, ya trae nombre, precio, SKU e imagen.
- **Selectores CSS**, ya sea un selector manual indicado por el usuario o autodetección probando una lista de patrones comunes (`.product-card`, `.product-item`, `[itemtype*="Product"]`, `a[href*="/producto/"]`, `a[href*="/product/"]`, etc.).

Para cada producto se intenta obtener: nombre, precio, SKU, imagen y URL original. Si no hay texto de nombre visible (por ejemplo, cuando el nombre del producto está dibujado dentro de una imagen), Topox lo deriva del slug de la URL como respaldo.

### Filtro de indicador "producto"
Para evitar falsos positivos —elementos genéricos como `<article>` o bloques que no son productos reales, frecuentes en sitios de WordPress con muchos widgets e imágenes decorativas— Topox descarta cualquier elemento candidato que no tenga la palabra `product` / `producto` en su clase, id, link asociado, o en alguno de sus ancestros cercanos. Esta misma verificación aplica de forma independiente a las imágenes: solo se usa una imagen como "imagen del producto" si ella misma (o su contenedor cercano) tiene esa señal; de lo contrario la columna queda vacía en vez de tomar un logo o ícono no relacionado.

### Escaneo de múltiples páginas (paginación)
Topox puede recorrer automáticamente catálogos paginados. Si el campo **"Páginas a escanear (máx.)"** es mayor a 1, detecta enlaces de paginación en cada página visitada (`rel="next"`, `.page-numbers`, `.pagination a`, `.pager a`, clases con "next", etc.) y los va encolando hasta alcanzar el máximo indicado o quedarse sin enlaces nuevos. Los productos de todas las páginas se combinan y se deduplican antes de mostrarse.

### Proxy CORS configurable
Al ser una app 100% cliente, el navegador aplica la política de **CORS**, que puede bloquear la lectura de contenido de otros dominios. El campo **"Proxy CORS"** permite indicar la URL de un proxy intermedio que reenvíe el HTML al navegador. Está pensado para usarse con un **Worker propio de Cloudflare** (gratis, sin servidor que mantener) — el código de ejemplo está en `proxy-worker.js`. El campo viene vacío por defecto y se completa manualmente con la URL del proxy que se vaya a usar.

### Vista previa y exportación
Tabla en pantalla con miniatura, nombre, precio, SKU y link de origen de cada producto detectado, antes de exportar. El botón **"Exportar a Excel"** genera el `.xlsx` con SheetJS, sin pasar por ningún servidor — el archivo se descarga directo desde el navegador.

### Panel de diagnóstico en vivo
Mientras escanea, un log en tiempo real (estilo terminal) muestra cada paso: tamaño del HTML recibido, cuántos elementos coinciden con el selector, qué modo se usó, cuántos enlaces de paginación se encontraron, etc. — pensado para depurar sitios con estructuras poco comunes sin tener que adivinar a ciegas.

## ⚠️ Limitación técnica importante: CORS

Esta es la restricción más relevante al ser una app puramente cliente:

- **Sitios sin restricciones CORS**: funcionan directamente con `fetch`, sin necesidad de proxy.
- **Sitios con CORS restrictivo**: requieren pasar las peticiones por un proxy intermedio (el campo "Proxy CORS").
- **Modo dinámico vía `<iframe>`**: no funciona en sitios que bloquean ser embebidos (cabeceras `X-Frame-Options` o `Content-Security-Policy`), algo común en WordPress y otras plataformas. En esos casos también puede ser necesario usar el proxy.
- Algunos sitios bloquean tráfico proveniente de proveedores cloud/datacenter (incluyendo Cloudflare Workers) mediante plugins de seguridad tipo Wordfence, lo que puede devolver una respuesta de bloqueo en vez del HTML real aunque el proxy esté bien configurado.

## 🚀 Uso

1. Abrir `index.html` en el navegador (no requiere instalación ni servidor).
2. Pegar la URL del listado de productos del sitio a migrar.
3. (Opcional) Abrir "opciones avanzadas" para:
   - Forzar modo estático o dinámico en vez de automático.
   - Indicar la URL de un proxy CORS.
   - Definir un selector CSS manual.
   - Poner un límite de productos (útil para pruebas).
   - Indicar cuántas páginas de paginación seguir.
4. Presionar **"Escanear"** y revisar el log en vivo.
5. Revisar la vista previa de productos detectados.
6. Presionar **"Exportar a Excel"** para descargar el `.xlsx`.

### Parámetros configurables en la UI

| Parámetro                  | Descripción                                                                 |
|-----------------------------|------------------------------------------------------------------------------|
| URL del sitio                | Página de listado de productos a escanear                                  |
| Modo de escaneo               | Automático (recomendado), forzar estático, o forzar dinámico               |
| Proxy CORS                    | URL de un proxy propio (ej. Cloudflare Worker) para sitios con CORS restrictivo |
| Selector de producto           | Selector CSS manual, si la autodetección no encuentra el patrón correcto    |
| Límite de productos            | Corta el escaneo al alcanzar este número                                   |
| Páginas a escanear (máx.)      | Sigue automáticamente la paginación del catálogo hasta este límite          |

## 📄 Formato del Excel generado

| Columna     | Descripción                          |
|-------------|----------------------------------------|
| nombre      | Nombre del producto                    |
| precio      | Precio detectado (texto tal cual se encontró) |
| sku         | Código o referencia (cuando hay `JSON-LD`) |
| imagen      | URL de la imagen del producto          |
| url_origen  | URL original del producto              |

## 🔌 Configurar el proxy CORS propio (Cloudflare Workers)

1. Crear cuenta gratis en [workers.cloudflare.com](https://workers.cloudflare.com).
2. Dashboard → **Workers & Pages** → **Create application** → elegir una plantilla simple ("Hello World") y darle **Deploy**.
3. Entrar al Worker recién creado y buscar el botón **"Edit code"** (o "Quick edit").
4. Pegar el contenido de `proxy-worker.js`, y darle **Save and deploy**.
5. Copiar la URL que da Cloudflare (tipo `https://nombre.usuario.workers.dev`) y pegarla en el campo "Proxy CORS" de Topox, agregando `/?url=` al final.

El Worker es de uso gratuito hasta 100,000 peticiones/día e incluye, comentado en el propio código, una opción para restringir su uso solo a los dominios que se vayan a migrar.

## ⚠️ Consideraciones legales y éticas

- Revisar el archivo `robots.txt` del sitio antes de escanearlo.
- Verificar los términos de servicio del sitio respecto al scraping.
- Usarlo idealmente solo en sitios propios o con autorización explícita del dueño, dado que el objetivo es una migración legítima de datos.
- Evitar escaneos masivos y rápidos que puedan sobrecargar el servidor objetivo.

## 🗺️ Posibles mejoras futuras

- [ ] Extracción de datos adicionales visitando cada página de producto individual (descripción larga, variantes, stock), no solo la página de listado.
- [ ] Soporte para sitios con autenticación (catálogos privados).
- [ ] Exportación adicional a CSV y JSON.
- [ ] Guardar configuraciones de selectores por sitio para reutilizarlas en escaneos futuros.
