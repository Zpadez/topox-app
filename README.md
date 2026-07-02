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
- **Datos estructurados `JSON-LD`** (`schema.org/Product`), cuando el sitio los expone — la señal más confiable, ya trae nombre, precio, SKU, categoría e imagen.
- **Selectores CSS**, ya sea un selector manual indicado por el usuario o autodetección probando una lista de patrones comunes (`.product-card`, `.product-item`, `[itemtype*="Product"]`, `a[href*="/producto/"]`, `a[href*="/product/"]`, etc.).

Para cada producto se intenta obtener: nombre, categoría, precio, SKU, imagen y URL original. Si no hay texto de nombre visible (por ejemplo, cuando el nombre del producto está dibujado dentro de una imagen), Topox lo deriva de atributos de texto (`title`, `aria-label`, `data-title`, `data-name`) o, en último caso, del slug de la URL.

### Extracción de nombre "a prueba de HTML crudo"
El nombre de cada producto se busca en varios niveles de confiabilidad, en este orden:
1. Un encabezado real (`h1`–`h4`) dentro de la tarjeta del producto — la fuente más limpia.
2. Un contenedor con clase `title`/`name`, solo si no hay encabezado.
3. El `alt` de la imagen del producto.
4. Atributos de texto (`title`, `aria-label`, `data-title`, `data-name`, etc.) en la tarjeta o en su enlace.
5. Como último recurso, un nombre derivado del slug de la URL del producto.

Cualquier texto que se use como nombre pasa por una limpieza que colapsa saltos de línea/espacios repetidos **y elimina etiquetas HTML sueltas** (algunos sitios dejan literalmente `<br>` como texto plano dentro del `alt` de la imagen en vez de un salto de línea real) — así una misma tarjeta nunca genera dos nombres que "se ven distintos" solo por errores de marcado del sitio de origen.

### Extracción de imagen con soporte para *lazy loading*
Muchos sitios cargan la imagen real solo cuando el navegador la necesita, dejando el atributo `src` como un placeholder hasta entonces. Topox prueba, en orden: `src`, atributos de carga diferida (`data-src`, `data-lazy-src`, `data-original`, `data-original-src`, `data-image`), la primera URL listada en `srcset`, y como respaldo un `background-image` en CSS inline (para tarjetas que muestran la foto así en vez de con `<img>`).

### Extracción de categoría
La categoría de cada producto se busca, en orden de confiabilidad:
1. **JSON-LD** (`schema.org/Product` → `category`), si el sitio lo expone.
2. Un elemento con clase de categoría dentro de la tarjeta (`[class*="category"]`, `[class*="categoria"]`, `[rel="tag"]`, etc.).
3. El **breadcrumb** de la página (`.breadcrumb`, `nav[aria-label="breadcrumb"]`, etc.), tomando el ítem justo antes del actual.
4. Como último recurso, el **slug de la URL** del producto (ej. `/electronica/producto-x` → "Electronica"), descartando palabras genéricas como "producto" o "tienda".

### Un solo producto por tarjeta, sin duplicados
Un selector amplio (por ejemplo `[class*="product"]`) a veces coincide con **varios elementos de la misma tarjeta** a la vez —la tarjeta completa, su título, a veces hasta su imagen— porque todos comparten la palabra "product" en alguna clase. Antes de construir la tabla de resultados, Topox agrupa todos los elementos que resuelven al **mismo URL de producto real** (revisando el enlace propio, un enlace descendiente, o un enlace ancestro que envuelva toda la tarjeta) y arma **una sola fila por producto**, combinando la mejor señal disponible entre todos los elementos del grupo en vez de tratar cada uno como un producto aparte.

Como red de seguridad adicional, si dos filas terminan representando el mismo producto (por ejemplo, al combinar resultados de varias páginas), la deduplicación final las reconoce por su **nombre limpio** (ignorando mayúsculas y espacios) y se queda con la versión que tenga más datos completos (imagen, precio, SKU, categoría).

### Filtro de indicador "producto"
Para evitar falsos positivos —elementos genéricos como `<article>` o bloques que no son productos reales, frecuentes en sitios de WordPress con muchos widgets e imágenes decorativas— Topox descarta cualquier elemento candidato que no tenga una señal de producto en su clase, id, atributos, link asociado, o en alguno de sus ancestros (hasta 10 niveles, para cubrir el HTML profundamente anidado de Elementor y WooCommerce).

Las señales que reconoce son:
- Palabras clave `product`, `producto`, `woocommerce` o `wc-block` en cualquier clase o id.
- Atributos `data-product_id`, `data-productid` u otros que empiecen por `data-product` (que WooCommerce genera automáticamente en listados y elementos de carrito).
- El atributo `itemtype="https://schema.org/Product"` en el HTML (schema.org sin necesitar llegar al bloque `JSON-LD`).

Esta misma verificación aplica de forma independiente a las imágenes: solo se usa una imagen como "imagen del producto" si ella misma o su contenedor cercano tiene alguna de esas señales; de lo contrario la columna queda vacía en vez de tomar un logo o ícono no relacionado.

### Exclusión de filtros y controles de orden
Los sidebars de "filtrar por categoría", los selects de "ordenar por precio" y otros widgets similares suelen compartir clases con los productos reales (por ejemplo, un widget `widget_product_categories`). Topox los descarta antes de procesarlos, usando dos niveles de detección:
- Clases de **widgets de filtro inequívocas** (`widget_layered_nav`, `widget_price_filter`, `widget_product_categories`, etc.) — revisadas en toda la cadena de ancestros.
- Palabras **ambiguas** (`filter`, `sorting`, `orderby`, etc.) — solo cuentan si están en el propio elemento o muy cerca (2–3 niveles), para no descartar por error el contenido principal solo porque un tema de WordPress le puso una clase de layout como `right-sidebar` al contenedor central de la página.
- Cualquier elemento dentro de una etiqueta semántica `<aside>` se descarta directamente.

### Escaneo de múltiples páginas (paginación)
Topox puede recorrer automáticamente catálogos paginados. Si el campo **"Páginas a escanear (máx.)"** es mayor a 1, detecta el patrón de paginación y el total de páginas de dos formas:
- **Numeración completa**: busca el número de página más alto que aparezca en el widget de paginación (WordPress/WooCommerce siempre muestra el último número, aunque oculte los intermedios detrás de un "…") y genera directamente todas las URLs intermedias (`/page/2/`, `/page/3/`... o `?paged=N`), sin depender de que estén visibles en el menú.
- **Conteo de resultados**: si no hay números de página visibles, intenta leer un texto tipo *"Mostrando 1–12 de 176 resultados"* / *"Showing 1-24 of 176 results"* para calcular el total de páginas a partir del tamaño de página.
- Como respaldo adicional, también sigue cualquier enlace de paginación que encuentre en cada página visitada (`rel="next"`, `.page-numbers`, `.pagination a`, `.pager a`, clases con "next", etc.).

Los productos de todas las páginas se combinan y se deduplican antes de mostrarse.

### Proxy CORS configurable
Al ser una app 100% cliente, el navegador aplica la política de **CORS**, que puede bloquear la lectura de contenido de otros dominios. El campo **"Proxy CORS"** permite indicar la URL de un proxy intermedio que reenvíe el HTML al navegador. Está pensado para usarse con un **Worker propio de Cloudflare** (gratis, sin servidor que mantener) — el código de ejemplo está en `proxy-worker.js`. El campo viene vacío por defecto y se completa manualmente con la URL del proxy que se vaya a usar.

### Vista previa y exportación
Tabla en pantalla con miniatura, nombre, categoría, precio, SKU y link de origen de cada producto detectado, antes de exportar. El botón **"Exportar a Excel"** genera el `.xlsx` con SheetJS, sin pasar por ningún servidor — el archivo se descarga directo desde el navegador.

### Panel de diagnóstico en vivo
Mientras escanea, un log en tiempo real (estilo terminal) muestra cada paso: tamaño del HTML recibido, cuántos elementos coinciden con el selector, qué modo se usó, cuántas páginas totales se detectaron por numeración, cuántos enlaces de paginación se encontraron, etc. — pensado para depurar sitios con estructuras poco comunes sin tener que adivinar a ciegas.

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
| categoria   | Categoría del producto (cuando se detecta) |
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

### 🔜 Próximo a desarrollar: filtro de tipo de contenido a escanear
Hoy Topox siempre extrae el mismo set fijo de campos (nombre, categoría, precio, SKU, imagen, URL). La siguiente mejora es agregar, dentro de **"opciones avanzadas"**, un filtro para elegir **qué tipo de información se quiere escanear**, en vez de traer todo por defecto. Pensado como un grupo de checkboxes (o chips seleccionables) con opciones como:

- **Fotos** — solo extraer las imágenes de producto (URL de imagen + nombre, sin el resto de campos).
- **Información de entradas** — datos tipo "post"/ficha de producto: nombre, categoría, precio, SKU, descripción corta si está disponible.
- **Texto plano** — solo el contenido textual visible de cada tarjeta (nombre, precio como texto), sin resolver URLs de imagen ni categoría.

Esto permitiría escaneos más rápidos y enfocados cuando no se necesita el catálogo completo (por ejemplo, migrar solo las fotos de producto a un CDN, o solo levantar un listado de nombres y precios para una cotización). La selección del filtro debería:
- Ajustar qué columnas se generan en el Excel exportado (ocultando las que no aplican en vez de dejarlas vacías).
- Reflejarse también en la tabla de vista previa en pantalla.
- Convivir con el selector CSS manual y el resto de opciones avanzadas existentes, sin reemplazarlas.

De la mano con esto, se rediseñará visualmente el botón/toggle de **"opciones avanzadas"** — hoy es solo texto con una flecha (`▸ opciones avanzadas`) — para que se vea más como un control interactivo real (ej. con un fondo sutil, ícono propio, y una transición más marcada al abrir/cerrar) y no se sienta como una opción escondida o secundaria.

### Otras mejoras
- [ ] Extracción de datos adicionales visitando cada página de producto individual (descripción larga, variantes, stock), no solo la página de listado.
- [ ] Soporte para sitios con autenticación (catálogos privados).
- [ ] Exportación adicional a CSV y JSON.
- [ ] Guardar configuraciones de selectores por sitio para reutilizarlas en escaneos futuros.
