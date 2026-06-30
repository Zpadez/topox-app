      (function () {
        "use strict";

        // ---------- State ----------
        let products = [];
        let isScanning = false;

        // ---------- DOM refs ----------
        const urlInput = document.getElementById("urlInput");
        const scanBtn = document.getElementById("scanBtn");
        const scanBtnLabel = document.getElementById("scanBtnLabel");
        const sweep = document.getElementById("sweep");
        const logPanel = document.getElementById("logPanel");
        const statusText = document.getElementById("statusText");
        const optionsToggle = document.getElementById("optionsToggle");
        const optionsPanel = document.getElementById("optionsPanel");
        const modeSelect = document.getElementById("modeSelect");
        const proxyInput = document.getElementById("proxyInput");
        const selectorInput = document.getElementById("selectorInput");
        const limitInput = document.getElementById("limitInput");
        const maxPagesInput = document.getElementById("maxPagesInput");
        const resultsSection = document.getElementById("resultsSection");
        const resultsCount = document.getElementById("resultsCount");
        const resultsBody = document.getElementById("resultsBody");
        const exportBtn = document.getElementById("exportBtn");
        const emptyState = document.getElementById("emptyState");
        const toast = document.getElementById("toast");

        // ---------- UI helpers ----------

        optionsToggle.addEventListener("click", () => {
          optionsToggle.classList.toggle("open");
          optionsPanel.classList.toggle("open");
        });

        function showToast(message, type) {
          toast.textContent = message;
          toast.className = "toast visible" + (type ? " " + type : "");
          clearTimeout(showToast._t);
          showToast._t = setTimeout(() => {
            toast.classList.remove("visible");
          }, 3800);
        }

        function setStatus(text) {
          statusText.textContent = text;
        }

        function logLine(html) {
          const line = document.createElement("div");
          line.className = "log-line";
          line.innerHTML = html;
          logPanel.appendChild(line);
          logPanel.scrollTop = logPanel.scrollHeight;
        }

        function resetLog() {
          logPanel.innerHTML = "";
          logPanel.classList.add("visible");
        }

        function setScanning(active) {
          isScanning = active;
          scanBtn.disabled = active;
          sweep.classList.toggle("active", active);
          scanBtnLabel.textContent = active ? "Escaneando…" : "Escanear";
          setStatus(active ? "escaneando" : "listo");
        }

        // ---------- Fetch helpers ----------

        async function fetchHtml(targetUrl, proxy) {
          const fetchUrl = proxy
            ? proxy + encodeURIComponent(targetUrl)
            : targetUrl;
          const res = await fetch(fetchUrl, { credentials: "omit" });
          if (!res.ok) throw new Error("HTTP " + res.status);
          return await res.text();
        }

        // Renders the page inside a hidden iframe so its JS executes,
        // then returns the resulting DOM document. Works for same-origin
        // or pages that don't set restrictive frame/CSP headers.
        function fetchRenderedDoc(targetUrl, timeoutMs) {
          return new Promise((resolve, reject) => {
            const iframe = document.createElement("iframe");
            iframe.style.cssText =
              "position:fixed;width:1280px;height:900px;top:-9999px;left:-9999px;opacity:0;pointer-events:none;";
            iframe.setAttribute("sandbox", "allow-scripts allow-same-origin");

            let settled = false;
            const cleanup = () => {
              if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
            };

            const timer = setTimeout(() => {
              if (settled) return;
              settled = true;
              try {
                const doc = iframe.contentDocument;
                cleanup();
                if (doc) resolve(doc);
                else
                  reject(
                    new Error(
                      "No se pudo leer el contenido renderizado (posible bloqueo cross-origin).",
                    ),
                  );
              } catch (e) {
                cleanup();
                reject(e);
              }
            }, timeoutMs || 4000);

            iframe.addEventListener("error", () => {
              if (settled) return;
              settled = true;
              clearTimeout(timer);
              cleanup();
              reject(new Error("El iframe no pudo cargar la página."));
            });

            document.body.appendChild(iframe);
            iframe.src = targetUrl;
          });
        }

        // ---------- Extraction heuristics ----------

        const PRICE_REGEX =
          /(\$|€|£|USD|MXN|COP|ARS|CLP|S\/|Bs\.?)\s?\d[\d.,]*/;
        const CANDIDATE_SELECTORS = [
          '[class*="product-card"]',
          '[class*="product-item"]',
          '[class*="product-tile"]',
          '[class*="productCard"]',
          '[class*="product-grid"] > *',
          '[class*="grid-product"]',
          '[itemtype*="Product"]',
          '[class*="product"]',
          'li[class*="item"]',
          'a[href*="/producto/"]',
          'a[href*="/product/"]',
          'a[href*="/shop/"]',
          'a[href*="/tienda/"]',
          "article",
        ];

        function absoluteUrl(base, maybeRelative) {
          try {
            return new URL(maybeRelative, base).href;
          } catch (e) {
            return maybeRelative || "";
          }
        }

        // Checks whether a candidate node has any "product" / "producto"
        // signal nearby: its own class/id, a few ancestor levels up, or
        // the href/src of its link/image. Used to filter out generic
        // matches (e.g. a bare <article> or <li class="item">) that don't
        // actually look like product cards.
        const PRODUCT_INDICATOR_RE = /product|producto/i;

        function hasProductIndicator(node, link, img) {
          if (PRODUCT_INDICATOR_RE.test(node.className || "")) return true;
          if (PRODUCT_INDICATOR_RE.test(node.id || "")) return true;
          if (link && PRODUCT_INDICATOR_RE.test(link.getAttribute("href") || ""))
            return true;
          if (img) {
            if (PRODUCT_INDICATOR_RE.test(img.getAttribute("src") || "")) return true;
            if (PRODUCT_INDICATOR_RE.test(img.getAttribute("class") || "")) return true;
          }
          let el = node.parentElement;
          let depth = 0;
          while (el && depth < 5) {
            if (PRODUCT_INDICATOR_RE.test(el.className || "")) return true;
            if (PRODUCT_INDICATOR_RE.test(el.id || "")) return true;
            el = el.parentElement;
            depth++;
          }
          return false;
        }

        // Checks an <img> specifically: only treated as a product image if
        // it (or one of its ancestors, up to a few levels) carries a
        // "product"/"producto" signal in class, id, src or alt. WordPress
        // pages tend to sprinkle unrelated logos/icons/widget images near
        // product cards, so this keeps those out of the "imagen" column.
        function imageHasProductIndicator(img) {
          if (!img) return false;
          if (PRODUCT_INDICATOR_RE.test(img.getAttribute("src") || "")) return true;
          if (PRODUCT_INDICATOR_RE.test(img.getAttribute("class") || "")) return true;
          if (PRODUCT_INDICATOR_RE.test(img.getAttribute("alt") || "")) return true;
          let el = img.parentElement;
          let depth = 0;
          while (el && depth < 6) {
            if (PRODUCT_INDICATOR_RE.test(el.className || "")) return true;
            if (PRODUCT_INDICATOR_RE.test(el.id || "")) return true;
            el = el.parentElement;
            depth++;
          }
          return false;
        }

        function extractFromJsonLd(doc, baseUrl) {
          const found = [];
          const scripts = doc.querySelectorAll(
            'script[type="application/ld+json"]',
          );
          scripts.forEach((s) => {
            try {
              const data = JSON.parse(s.textContent);
              const items = Array.isArray(data) ? data : [data];
              items.forEach((item) => {
                const list = item["@graph"] ? item["@graph"] : [item];
                list.forEach((node) => {
                  if (
                    node &&
                    (node["@type"] === "Product" ||
                      (Array.isArray(node["@type"]) &&
                        node["@type"].includes("Product")))
                  ) {
                    const offer = Array.isArray(node.offers)
                      ? node.offers[0]
                      : node.offers;
                    found.push({
                      nombre: node.name || "",
                      precio: offer
                        ? offer.price
                          ? offer.priceCurrency
                            ? offer.priceCurrency + " " + offer.price
                            : offer.price
                          : ""
                        : "",
                      sku: node.sku || node.productID || "",
                      imagen: Array.isArray(node.image)
                        ? node.image[0]
                        : node.image || "",
                      url: node.url ? absoluteUrl(baseUrl, node.url) : baseUrl,
                    });
                  }
                });
              });
            } catch (e) {
              /* invalid json-ld, skip */
            }
          });
          return found;
        }

        // Generic words found in alt text / class names that don't actually
        // describe a product, so they shouldn't be used as the product name.
        const GENERIC_NAME_WORDS =
          /^(img|imagen|image|photo|foto|thumbnail|curso|product|item)[\s\-_]?\d*$/i;

        // Turns a URL slug like "el-arte-de-hornear-galletas" or
        // "masterclass-en-chantilly-producto" into a readable title.
        function nameFromSlug(url) {
          try {
            const path = new URL(url).pathname.replace(/\/+$/, "");
            let slug = path.split("/").filter(Boolean).pop() || "";
            slug = slug.replace(/-producto$/i, "");
            slug = slug.replace(/[-_]+/g, " ").trim();
            if (!slug) return "";
            return slug.charAt(0).toUpperCase() + slug.slice(1);
          } catch (e) {
            return "";
          }
        }

        function extractFromSelector(doc, baseUrl, selector) {
          const nodes = doc.querySelectorAll(selector);
          const found = [];
          nodes.forEach((node) => {
            const text = node.textContent || "";
            const priceMatch = text.match(PRICE_REGEX);
            // Only accept an image as the product image if it (or one of
            // its ancestors) carries a "product"/"producto" signal —
            // otherwise unrelated logos/icons/widget images get ignored.
            let img = null;
            if (node.matches("img")) {
              img = imageHasProductIndicator(node) ? node : null;
            } else {
              const candidateImgs = Array.from(node.querySelectorAll("img"));
              img = candidateImgs.find((im) => imageHasProductIndicator(im)) || null;
            }
            // The matched node itself may already be the link (e.g. selector
            // "a[href*='/producto/']"), or the link may be nested inside it.
            const link = node.matches("a[href]")
              ? node
              : node.querySelector("a[href]");
            const titleEl = node.querySelector(
              'h1,h2,h3,h4,[class*="title"],[class*="name"]',
            );

            let nombre = titleEl ? titleEl.textContent.trim() : "";
            if (
              !nombre &&
              img &&
              img.alt &&
              !GENERIC_NAME_WORDS.test(img.alt.trim())
            ) {
              nombre = img.alt.trim();
            }
            if (!nombre && link) {
              nombre = nameFromSlug(
                absoluteUrl(baseUrl, link.getAttribute("href")),
              );
            }
            if (!nombre) return; // skip nodes without any identifiable name
            if (!hasProductIndicator(node, link, img)) return; // skip nodes without a "product"/"producto" signal

            found.push({
              nombre: nombre.slice(0, 180),
              precio: priceMatch ? priceMatch[0].trim() : "",
              sku: "",
              imagen: img
                ? absoluteUrl(
                    baseUrl,
                    img.getAttribute("src") ||
                      img.getAttribute("data-src") ||
                      "",
                  )
                : "",
              url: link
                ? absoluteUrl(baseUrl, link.getAttribute("href"))
                : baseUrl,
            });
          });
          return found;
        }

        function autoDetectSelector(doc) {
          for (const sel of CANDIDATE_SELECTORS) {
            const nodes = doc.querySelectorAll(sel);
            if (nodes.length >= 3) return sel;
          }
          return null;
        }

        function dedupe(list) {
          const seen = new Set();
          return list.filter((p) => {
            const key = (p.nombre + "|" + p.url).toLowerCase();
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          });
        }

        const PAGINATION_SELECTORS = [
          '[rel="next"]',
          "a.next",
          'a[class*="next"]',
          'a[class*="page-numbers"]',
          'nav[class*="pag"] a',
          '[class*="pagination"] a',
          '[class*="pager"] a',
        ];

        function normalizeUrl(u) {
          try {
            const parsed = new URL(u);
            parsed.hash = "";
            return parsed.href.replace(/\/$/, "");
          } catch (e) {
            return u;
          }
        }

        function findPaginationLinks(doc, baseUrl, originHostname) {
          const links = new Set();
          PAGINATION_SELECTORS.forEach((sel) => {
            doc.querySelectorAll(sel).forEach((a) => {
              const href = a.getAttribute && a.getAttribute("href");
              if (!href) return;
              const abs = absoluteUrl(baseUrl, href);
              try {
                const u = new URL(abs);
                if (u.hostname === originHostname) links.add(abs);
              } catch (e) {
                /* skip invalid */
              }
            });
          });
          return Array.from(links);
        }

        // ---------- Main scan flow ----------

        // Scans a single URL (static first, dynamic fallback) and returns the
        // products found on that page plus the parsed document (for pagination
        // link discovery) and which mode actually worked.
        async function scanSinglePage(pageUrl, mode, proxy, manualSelector) {
          let doc = null;
          let usedMode = "";

          try {
            if (mode !== "dynamic") {
              const html = await fetchHtml(pageUrl, proxy);
              logLine(
                '<span class="tag">[diagnóstico]</span> HTML recibido: ' +
                  html.length +
                  " caracteres.",
              );
              const parser = new DOMParser();
              doc = parser.parseFromString(html, "text/html");
              usedMode = "static";
              if (manualSelector) {
                const rawMatches = doc.querySelectorAll(manualSelector).length;
                logLine(
                  '<span class="tag">[diagnóstico]</span> selector "' +
                    manualSelector +
                    '" coincide con ' +
                    rawMatches +
                    " elemento(s).",
                );
              }
            }
          } catch (e) {
            logLine('<span class="err">[estático]</span> falló: ' + e.message);
            doc = null;
          }

          let pageProducts = [];

          if (doc) {
            const staticSelector = manualSelector || autoDetectSelector(doc);
            const jsonLdItems = extractFromJsonLd(doc, pageUrl);
            const selectorItems = staticSelector
              ? extractFromSelector(doc, pageUrl, staticSelector)
              : [];
            pageProducts = dedupe([...jsonLdItems, ...selectorItems]);

            if (pageProducts.length > 0) {
              logLine(
                '<span class="ok">[estático]</span> ' +
                  pageProducts.length +
                  " producto(s) detectado(s).",
              );
            } else {
              logLine(
                '<span class="tag">[estático]</span> no se detectaron productos en el HTML crudo.',
              );
            }
          }

          if (pageProducts.length === 0 && mode !== "static") {
            try {
              logLine(
                '<span class="tag">[dinámico]</span> renderizando página (esperando JavaScript)…',
              );
              const renderedDoc = await fetchRenderedDoc(pageUrl, 4500);
              usedMode = "dynamic";
              const dynSelector =
                manualSelector || autoDetectSelector(renderedDoc);
              const jsonLdItems = extractFromJsonLd(renderedDoc, pageUrl);
              const selectorItems = dynSelector
                ? extractFromSelector(renderedDoc, pageUrl, dynSelector)
                : [];
              pageProducts = dedupe([...jsonLdItems, ...selectorItems]);
              doc = renderedDoc;

              if (pageProducts.length > 0) {
                logLine(
                  '<span class="ok">[dinámico]</span> ' +
                    pageProducts.length +
                    " producto(s) detectado(s).",
                );
              } else {
                logLine(
                  '<span class="err">[dinámico]</span> tampoco se detectaron productos.',
                );
              }
            } catch (e) {
              logLine(
                '<span class="err">[dinámico]</span> falló: ' + e.message,
              );
              logLine(
                '<span class="tag">[sugerencia]</span> si el sitio bloquea iframes o CORS, prueba con un proxy en opciones avanzadas.',
              );
            }
          }

          return { products: pageProducts, doc, usedMode };
        }

        async function runScan() {
          const targetUrl = urlInput.value.trim();
          if (!targetUrl) {
            showToast("Pega una URL para escanear.", "error");
            return;
          }
          let parsedUrl;
          try {
            parsedUrl = new URL(targetUrl);
          } catch (e) {
            showToast("La URL no es válida.", "error");
            return;
          }

          const mode = modeSelect.value;
          const proxy = proxyInput.value.trim();
          const manualSelector = selectorInput.value.trim();
          const limit = parseInt(limitInput.value, 10) || 0;
          const maxPages = Math.max(1, parseInt(maxPagesInput.value, 10) || 1);

          setScanning(true);
          resetLog();
          resultsSection.classList.remove("visible");
          emptyState.classList.remove("visible");
          products = [];

          logLine(
            '<span class="tag">[init]</span> objetivo: ' + parsedUrl.href,
          );
          if (maxPages > 1)
            logLine(
              '<span class="tag">[init]</span> paginación activada, hasta ' +
                maxPages +
                " página(s).",
            );

          const visited = new Set();
          const queue = [parsedUrl.href];
          let allProducts = [];
          let pagesScanned = 0;
          let lastUsedMode = "";

          while (queue.length > 0 && pagesScanned < maxPages) {
            const nextUrl = normalizeUrl(queue.shift());
            if (visited.has(nextUrl)) continue;
            visited.add(nextUrl);
            pagesScanned++;

            logLine(
              '<span class="tag">[página ' +
                pagesScanned +
                "]</span> " +
                nextUrl,
            );
            const result = await scanSinglePage(
              nextUrl,
              mode,
              proxy,
              manualSelector,
            );
            allProducts = allProducts.concat(result.products);
            if (result.usedMode) lastUsedMode = result.usedMode;

            if (result.doc && pagesScanned < maxPages) {
              const nextLinks = findPaginationLinks(
                result.doc,
                nextUrl,
                parsedUrl.hostname,
              );
              nextLinks.forEach((link) => {
                const norm = normalizeUrl(link);
                if (!visited.has(norm) && !queue.includes(link))
                  queue.push(link);
              });
              if (nextLinks.length > 0) {
                logLine(
                  '<span class="tag">[página ' +
                    pagesScanned +
                    "]</span> " +
                    nextLinks.length +
                    " enlace(s) de paginación encontrado(s).",
                );
              }
            }

            if (limit > 0 && dedupe(allProducts).length >= limit) break;
          }

          products = dedupe(allProducts);

          if (limit > 0 && products.length > limit) {
            products = products.slice(0, limit);
            logLine(
              '<span class="tag">[límite]</span> recortado a ' +
                limit +
                " producto(s).",
            );
          }

          logLine(
            '<span class="tag">[fin]</span> ' +
              pagesScanned +
              " página(s) escaneada(s), " +
              products.length +
              " producto(s) en total. modo: " +
              (lastUsedMode || "ninguno"),
          );

          renderResults();
          setScanning(false);
        }

        function renderResults() {
          resultsBody.innerHTML = "";

          if (products.length === 0) {
            resultsSection.classList.remove("visible");
            emptyState.classList.add("visible");
            exportBtn.disabled = true;
            return;
          }

          emptyState.classList.remove("visible");
          resultsSection.classList.add("visible");
          resultsCount.textContent =
            products.length +
            (products.length === 1 ? " producto" : " productos");
          exportBtn.disabled = false;

          products.forEach((p) => {
            const tr = document.createElement("tr");

            const tdImg = document.createElement("td");
            if (p.imagen) {
              const img = document.createElement("img");
              img.className = "cell-thumb";
              img.src = p.imagen;
              img.loading = "lazy";
              img.onerror = () => {
                img.style.visibility = "hidden";
              };
              tdImg.appendChild(img);
            } else {
              const placeholder = document.createElement("div");
              placeholder.className = "cell-thumb";
              tdImg.appendChild(placeholder);
            }

            const tdName = document.createElement("td");
            tdName.className = "cell-name";
            tdName.textContent = p.nombre || "—";
            tdName.title = p.nombre || "";

            const tdPrice = document.createElement("td");
            tdPrice.className = "cell-price";
            tdPrice.textContent = p.precio || "—";

            const tdSku = document.createElement("td");
            tdSku.className = "cell-muted";
            tdSku.textContent = p.sku || "—";

            const tdUrl = document.createElement("td");
            const link = document.createElement("a");
            link.className = "cell-link";
            link.href = p.url;
            link.target = "_blank";
            link.rel = "noopener noreferrer";
            link.textContent = (p.url || "")
              .replace(/^https?:\/\//, "")
              .slice(0, 40);
            tdUrl.appendChild(link);

            tr.append(tdImg, tdName, tdPrice, tdSku, tdUrl);
            resultsBody.appendChild(tr);
          });
        }

        // ---------- Export ----------

        function exportToExcel() {
          if (products.length === 0) return;

          const rows = products.map((p) => ({
            nombre: p.nombre || "",
            precio: p.precio || "",
            sku: p.sku || "",
            imagen: p.imagen || "",
            url_origen: p.url || "",
          }));

          const ws = XLSX.utils.json_to_sheet(rows);
          ws["!cols"] = [
            { wch: 38 },
            { wch: 14 },
            { wch: 16 },
            { wch: 42 },
            { wch: 42 },
          ];

          const wb = XLSX.utils.book_new();
          XLSX.utils.book_append_sheet(wb, ws, "Productos");

          const filename =
            "productos-" + new Date().toISOString().slice(0, 10) + ".xlsx";
          XLSX.writeFile(wb, filename);
          showToast("Excel descargado: " + filename, "success");
        }

        // ---------- Events ----------

        scanBtn.addEventListener("click", () => {
          if (!isScanning) runScan();
        });
        urlInput.addEventListener("keydown", (e) => {
          if (e.key === "Enter" && !isScanning) runScan();
        });
        exportBtn.addEventListener("click", exportToExcel);
      })();
