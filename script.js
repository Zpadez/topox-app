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

        // Collapses runs of whitespace (including newlines/tabs that leak
        // in from raw textContent, e.g. "Producto X\n  " from a card with
        // nested elements) into single spaces, so the same product doesn't
        // end up as two different-looking entries just because of
        // formatting whitespace. Also strips literal HTML-tag-looking text
        // (e.g. some sites put a raw "<br>" directly inside an alt
        // attribute instead of an actual line break — since that's inside
        // an attribute value it's never parsed as markup, so it shows up
        // as literal "<br>" characters in the text and would otherwise
        // make that source look like a different name from the clean one).
        function cleanText(str) {
          return (str || "")
            .replace(/<\/?[a-z][a-z0-9]*\s*\/?>/gi, " ")
            .replace(/\s+/g, " ")
            .trim();
        }

        // Checks whether a candidate node has any "product" / "producto"
        // signal nearby: its own class/id/attributes, a few ancestor levels
        // up, or the href/src of its link/image.
        // Covers WooCommerce class patterns (woocommerce, wc-block-grid,
        // type-product, etc.) and schema.org itemtype attributes, in addition
        // to the generic "product"/"producto" keyword.
        const PRODUCT_INDICATOR_RE = /product|producto|woocommerce|wc-block/i;
        const PRODUCT_ATTR_RE = /^data-product/i; // data-product_id, data-productid, etc.

        function nodeHasProductAttr(el) {
          if (!el || !el.attributes) return false;
          for (const attr of el.attributes) {
            if (PRODUCT_ATTR_RE.test(attr.name)) return true;
          }
          if (
            el.getAttribute("itemtype") &&
            el.getAttribute("itemtype").includes("Product")
          )
            return true;
          return false;
        }

        function hasProductIndicator(node, link, img) {
          // Check the node itself
          if (PRODUCT_INDICATOR_RE.test(node.className || "")) return true;
          if (PRODUCT_INDICATOR_RE.test(node.id || "")) return true;
          if (nodeHasProductAttr(node)) return true;

          // Check its link
          if (link && PRODUCT_INDICATOR_RE.test(link.getAttribute("href") || ""))
            return true;

          // Check its image
          if (img) {
            if (PRODUCT_INDICATOR_RE.test(img.getAttribute("src") || "")) return true;
            if (PRODUCT_INDICATOR_RE.test(img.getAttribute("class") || "")) return true;
          }

          // Walk up the ancestor chain — 10 levels covers deeply nested
          // Elementor/WooCommerce markup without hitting the whole document.
          let el = node.parentElement;
          let depth = 0;
          while (el && el !== document.body && depth < 10) {
            if (PRODUCT_INDICATOR_RE.test(el.className || "")) return true;
            if (PRODUCT_INDICATOR_RE.test(el.id || "")) return true;
            if (nodeHasProductAttr(el)) return true;
            el = el.parentElement;
            depth++;
          }
          return false;
        }

        // Checks an <img> specifically: only treated as a product image if
        // it (or one of its ancestors) carries a product signal in class,
        // id, src, alt, or data-product attributes. Prevents unrelated
        // logos/icons/widget images from leaking into the "imagen" column.
        function imageHasProductIndicator(img) {
          if (!img) return false;
          if (PRODUCT_INDICATOR_RE.test(img.getAttribute("src") || "")) return true;
          if (PRODUCT_INDICATOR_RE.test(img.getAttribute("data-src") || "")) return true;
          if (PRODUCT_INDICATOR_RE.test(img.getAttribute("data-lazy-src") || "")) return true;
          if (PRODUCT_INDICATOR_RE.test(img.getAttribute("class") || "")) return true;
          if (PRODUCT_INDICATOR_RE.test(img.getAttribute("alt") || "")) return true;
          if (nodeHasProductAttr(img)) return true;
          let el = img.parentElement;
          let depth = 0;
          while (el && el !== document.body && depth < 10) {
            if (PRODUCT_INDICATOR_RE.test(el.className || "")) return true;
            if (PRODUCT_INDICATOR_RE.test(el.id || "")) return true;
            if (nodeHasProductAttr(el)) return true;
            el = el.parentElement;
            depth++;
          }
          return false;
        }

        // Signals that mark an element as filter/sorting UI rather than an
        // actual product — sidebars with checkboxes by category, price
        // range sliders, "ordenar por" selects, WooCommerce/Shopify facet
        // widgets, etc.
        //
        // Split into two tiers on purpose:
        // - WIDGET: unambiguous plugin/widget wrapper classnames that only
        //   ever appear on real filter widgets (checked across the full
        //   ancestor chain, since a filter checkbox can be several levels
        //   deep inside its widget wrapper).
        // - LOCAL: broader, more ambiguous words (e.g. "filter", "sorting")
        //   that are only trusted on the node itself or its closest
        //   ancestors — NOT walked all the way up, because generic layout
        //   wrapper classes like "right-sidebar" or "has-sidebar" are
        //   extremely common on the MAIN content wrapper in WordPress
        //   themes (Astra, GeneratePress, etc.) and would otherwise wipe
        //   out every real product on the page.
        const FILTER_WIDGET_RE =
          /widget_layered_nav|widget_price_filter|widget_product_categories|widget_rating_filter|widget_shipping|product_cat_filter|woocommerce-widget-layered-nav/i;
        const FILTER_LOCAL_RE =
          /filter|filtro|facet|orderby|order-by|ordenar[-_]?por|woocommerce-ordering|price-range|rango[-_]?de[-_]?precio|sorting|sort[-_]?by/i;

        // Tags that are almost always filter/sort controls, never a
        // product card, regardless of surrounding class names.
        const FILTER_TAG_RE = /^(SELECT|OPTION|FORM)$/;

        function nodeIsFilterElement(node) {
          if (!node) return false;
          if (FILTER_TAG_RE.test(node.tagName)) return true;
          if (
            node.tagName === "INPUT" &&
            /checkbox|radio|range/i.test(node.getAttribute("type") || "")
          )
            return true;
          if (
            FILTER_WIDGET_RE.test(node.className || "") ||
            FILTER_LOCAL_RE.test(node.className || "")
          )
            return true;
          if (
            FILTER_WIDGET_RE.test(node.id || "") ||
            FILTER_LOCAL_RE.test(node.id || "")
          )
            return true;

          let el = node.parentElement;
          let depth = 0;
          while (el && el !== document.body && depth < 10) {
            if (el.tagName === "ASIDE") return true;
            if (FILTER_WIDGET_RE.test(el.className || "")) return true;
            if (FILTER_WIDGET_RE.test(el.id || "")) return true;
            // Ambiguous keywords only count this close to the node itself,
            // to avoid a page-layout wrapper several levels up (which may
            // merely describe where the sidebar sits, not contain it)
            // from wiping out the real product grid.
            if (depth < 3) {
              if (FILTER_LOCAL_RE.test(el.className || "")) return true;
              if (FILTER_LOCAL_RE.test(el.id || "")) return true;
            }
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
                    let categoria = "";
                    if (typeof node.category === "string") {
                      categoria = node.category;
                    } else if (node.category && node.category.name) {
                      categoria = node.category.name;
                    } else if (Array.isArray(node.category)) {
                      categoria = node.category
                        .map((c) => (typeof c === "string" ? c : c && c.name) || "")
                        .filter(Boolean)
                        .join(" > ");
                    }

                    found.push({
                      nombre: cleanText(node.name || ""),
                      categoria: categoria,
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

        // Resolves the real image URL from an <img> element, trying —in
        // order of reliability— the standard "src", then common lazy-load
        // attributes plugins/themes use instead of "src" (which is often
        // left as a tiny placeholder until the browser's real JS runs),
        // then the first URL listed in "srcset". Falls back to "src" even
        // if it looks like a placeholder, rather than returning nothing.
        const LAZY_SRC_ATTRS = [
          "src",
          "data-src",
          "data-lazy-src",
          "data-original",
          "data-original-src",
          "data-image",
        ];
        function resolveImageUrl(img) {
          if (!img) return "";
          for (const attr of LAZY_SRC_ATTRS) {
            const val = (img.getAttribute(attr) || "").trim();
            if (val && !/^data:/i.test(val)) return val;
          }
          const srcset = img.getAttribute("srcset") || img.getAttribute("data-srcset");
          if (srcset) {
            const first = srcset.split(",")[0].trim().split(/\s+/)[0];
            if (first) return first;
          }
          // Last resort: return whatever "src" holds even if it's a
          // placeholder, since an empty cell is worse than a placeholder.
          return img.getAttribute("src") || "";
        }

        // Fallback for cards that show the product image via CSS
        // background-image instead of an <img> tag (common in some
        // carousel/lazy-load setups), checking the node itself and its
        // descendants for an inline background-image style or a
        // data-bg/data-background(-image) attribute used by lazy-load
        // plugins.
        function findBackgroundImageUrl(node) {
          const candidates = [node, ...Array.from(node.querySelectorAll("[style]"))];
          for (const el of candidates) {
            const style = el.getAttribute && el.getAttribute("style");
            if (style) {
              const match = style.match(/background-image\s*:\s*url\((['"]?)(.*?)\1\)/i);
              if (match && match[2]) return match[2];
            }
          }
          const dataAttrEl =
            node.querySelector("[data-bg],[data-background],[data-background-image]") ||
            (node.hasAttribute &&
              (node.hasAttribute("data-bg") ||
                node.hasAttribute("data-background") ||
                node.hasAttribute("data-background-image"))
              ? node
              : null);
          if (dataAttrEl) {
            const val =
              dataAttrEl.getAttribute("data-bg") ||
              dataAttrEl.getAttribute("data-background") ||
              dataAttrEl.getAttribute("data-background-image");
            if (val) return val;
          }
          return "";
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

        // Words that show up in breadcrumb/category-ish elements but don't
        // actually name a category (home links, generic "shop" labels, etc.)
        const GENERIC_CATEGORY_WORDS =
          /^(inicio|home|tienda|shop|productos?|products?|catálogo|catalogo|todos|all)$/i;

        // Slug segments that are structural, not real categories.
        const GENERIC_SLUG_WORDS =
          /^(producto|product|item|p|shop|tienda|catalogo|catálogo|category|categoria|categoría|collections?|collection)$/i;

        // Tries to find a category for a single product card/link using,
        // in order of reliability: an explicit category-ish element inside
        // the card, the site's breadcrumb trail (useful when scanning a
        // single category listing page), and finally the URL slug as a
        // last-resort fallback.
        function findCategoryForNode(doc, node, baseUrl, link) {
          const catEl = node.querySelector(
            '[class*="category"],[class*="categoria"],[rel="tag"],[class*="cat-link"]',
          );
          if (catEl) {
            const text = catEl.textContent.trim();
            if (text && text.length < 80 && !GENERIC_CATEGORY_WORDS.test(text)) {
              return text;
            }
          }

          const breadcrumb = doc.querySelector(
            '.breadcrumb, .breadcrumbs, [class*="breadcrumb"], nav[aria-label="breadcrumb"]',
          );
          if (breadcrumb) {
            const items = Array.from(
              breadcrumb.querySelectorAll("a, span, li"),
            )
              .map((el) => el.textContent.trim())
              .filter((t) => t && !GENERIC_CATEGORY_WORDS.test(t));
            // The last item is usually the current page/product itself,
            // so the category is typically the one right before it.
            if (items.length >= 2) return items[items.length - 2];
            if (items.length === 1) return items[0];
          }

          if (link) {
            try {
              const path = new URL(
                absoluteUrl(baseUrl, link.getAttribute("href")),
              ).pathname;
              const parts = path.split("/").filter(Boolean);
              if (parts.length >= 2) {
                const slug = parts[parts.length - 2];
                if (slug && !GENERIC_SLUG_WORDS.test(slug) && !/^\d+$/.test(slug)) {
                  return slug
                    .replace(/[-_]+/g, " ")
                    .replace(/\b\w/g, (c) => c.toUpperCase());
                }
              }
            } catch (e) {
              /* skip invalid url */
            }
          }

          return "";
        }

        // The matched node itself may already be the link (e.g. selector
        // "a[href*='/producto/']"), the link may be nested inside it, or —
        // common in WooCommerce card markup — the whole card can be wrapped
        // by an <a> as an ANCESTOR instead (e.g. <a class="...loop-
        // product__link"><img><h2>Title</h2></a>). Checking ancestors too
        // means a node that only wraps the name/price (no link inside it)
        // still resolves to the product's own URL instead of falling back
        // to the generic listing page.
        function resolveProductLink(node) {
          if (node.matches("a[href]")) return node;
          const inner = node.querySelector("a[href]");
          if (inner) return inner;
          let ancestor = node.parentElement;
          let depth = 0;
          while (ancestor && ancestor !== document.body && depth < 5) {
            if (ancestor.matches && ancestor.matches("a[href]")) return ancestor;
            ancestor = ancestor.parentElement;
            depth++;
          }
          return null;
        }

        // Builds a single product entry from a group of DOM nodes that all
        // resolve to the same product URL — trying every node in the group
        // for each signal (name, image, price) instead of assuming any one
        // of them has everything. This matters because a broad selector
        // often matches several elements belonging to the SAME product
        // (the card, its title element, its image) independently, and only
        // one of them typically has the clean heading text; the others
        // would otherwise fall back to worse sources (garbled alt text, a
        // URL-slug guess) and show up as extra "duplicate" rows with a
        // different-looking name for the same product.
        function buildProductEntry(doc, baseUrl, nodes) {
          const primary = nodes.reduce(
            (best, n) =>
              (n.textContent || "").length > (best.textContent || "").length
                ? n
                : best,
            nodes[0],
          );
          const link =
            resolveProductLink(primary) ||
            nodes.map(resolveProductLink).find(Boolean) ||
            null;

          let img = null;
          for (const n of nodes) {
            if (n.matches("img")) {
              if (imageHasProductIndicator(n)) {
                img = n;
                break;
              }
            } else {
              const candidate = Array.from(n.querySelectorAll("img")).find(
                (im) => imageHasProductIndicator(im),
              );
              if (candidate) {
                img = candidate;
                break;
              }
            }
          }

          const text = primary.textContent || "";
          const priceMatch = text.match(PRICE_REGEX);

          // Tier 1: an actual heading — the most reliable name source.
          // Check every node in the group, since only one of them might
          // actually contain it.
          let nombre = "";
          for (const n of nodes) {
            const h = n.querySelector("h1,h2,h3,h4");
            const t = h ? cleanText(h.textContent) : "";
            if (t) {
              nombre = t;
              break;
            }
          }
          // Tier 2: a broader class-matched title/name container.
          if (!nombre) {
            for (const n of nodes) {
              const c =
                n.querySelector('[class*="title"]') ||
                n.querySelector('[class*="name"]');
              const t = c ? cleanText(c.textContent) : "";
              if (t) {
                nombre = t;
                break;
              }
            }
          }
          if (nombre && priceMatch && nombre.includes(priceMatch[0])) {
            nombre = cleanText(
              nombre.slice(0, nombre.indexOf(priceMatch[0])),
            );
          }
          // Tier 3: image alt text.
          if (
            !nombre &&
            img &&
            img.alt &&
            !GENERIC_NAME_WORDS.test(img.alt.trim())
          ) {
            nombre = cleanText(img.alt);
          }
          // Tier 4: text-ish attributes — "title", "aria-label", "data-
          // title"/"data-name" (common in JS-driven catalogs).
          if (!nombre) {
            const attrCandidates = [];
            nodes.forEach((n) => {
              attrCandidates.push(
                n.getAttribute("title"),
                n.getAttribute("aria-label"),
                n.getAttribute("data-title"),
                n.getAttribute("data-name"),
                n.getAttribute("data-product-title"),
                n.getAttribute("data-product-name"),
              );
            });
            if (link)
              attrCandidates.push(
                link.getAttribute("title"),
                link.getAttribute("aria-label"),
              );
            for (const cand of attrCandidates) {
              const trimmed = (cand || "").trim();
              if (trimmed && !GENERIC_NAME_WORDS.test(trimmed)) {
                nombre = cleanText(trimmed);
                break;
              }
            }
          }
          // Tier 5: derive from the URL slug as a last resort.
          if (!nombre && link) {
            nombre = nameFromSlug(absoluteUrl(baseUrl, link.getAttribute("href")));
          }
          if (!nombre) return null; // no identifiable name anywhere in the group
          if (!nodes.some((n) => hasProductIndicator(n, link, img))) return null; // no "product"/"producto" signal anywhere in the group

          // Resolve the image URL, preferring an actual <img> tag (with
          // lazy-load-aware fallback), and falling back to a CSS
          // background-image if no node in the group uses <img> at all.
          let imagenUrl = "";
          if (img) {
            const resolved = resolveImageUrl(img);
            if (resolved) imagenUrl = absoluteUrl(baseUrl, resolved);
          }
          if (!imagenUrl) {
            for (const n of nodes) {
              const bg = findBackgroundImageUrl(n);
              if (bg) {
                imagenUrl = absoluteUrl(baseUrl, bg);
                break;
              }
            }
          }

          return {
            nombre: nombre.slice(0, 180),
            categoria: findCategoryForNode(doc, primary, baseUrl, link),
            precio: priceMatch ? priceMatch[0].trim() : "",
            sku: "",
            imagen: imagenUrl,
            url: link ? absoluteUrl(baseUrl, link.getAttribute("href")) : baseUrl,
          };
        }

        function extractFromSelector(doc, baseUrl, selector) {
          const rawNodes = Array.from(doc.querySelectorAll(selector)).filter(
            (node) => !nodeIsFilterElement(node),
          );

          // Group every matched node by the real product URL it resolves
          // to. A broad selector frequently matches several elements that
          // all belong to the SAME product (the card, its title element,
          // its image) — grouping them here means exactly one entry gets
          // built per product, using the best signal available from ANY
          // node in the group, instead of one entry per matched element.
          const groups = new Map(); // urlKey -> nodes[]
          const ungrouped = []; // nodes with no resolvable product URL

          rawNodes.forEach((node) => {
            const link = resolveProductLink(node);
            const urlKey = link
              ? normalizeUrlForKey(absoluteUrl(baseUrl, link.getAttribute("href")))
              : "";
            if (urlKey) {
              if (!groups.has(urlKey)) groups.set(urlKey, []);
              groups.get(urlKey).push(node);
            } else {
              ungrouped.push(node);
            }
          });

          const found = [];
          groups.forEach((groupNodes) => {
            const entry = buildProductEntry(doc, baseUrl, groupNodes);
            if (entry) found.push(entry);
          });
          ungrouped.forEach((node) => {
            const entry = buildProductEntry(doc, baseUrl, [node]);
            if (entry) found.push(entry);
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

        // Normalizes a product URL down to "host + path" for comparison
        // purposes — ignoring things that don't change WHICH product the
        // URL points to: http vs https, "www." vs no "www.", a trailing
        // slash, letter case, and query strings/hashes (which are often
        // just variant selectors, tracking params, or "#reviews"-style
        // anchors tacked onto an otherwise identical product URL). Without
        // this, the same product extracted once via JSON-LD and once from
        // the plain HTML card could end up with two URLs that differ only
        // in these cosmetic ways, and the old exact-match comparison would
        // treat them as two different products.
        function normalizeUrlForKey(rawUrl) {
          if (!rawUrl) return "";
          try {
            const u = new URL(rawUrl);
            const host = u.hostname.toLowerCase().replace(/^www\./, "");
            const path = u.pathname.replace(/\/$/, "").toLowerCase();
            return host + path;
          } catch (e) {
            return rawUrl.trim().toLowerCase().replace(/\/$/, "");
          }
        }

        function dedupe(list) {
          const seen = new Map();
          const order = [];

          // How "complete" an entry is — used to pick which one survives
          // when two rows share the same product name.
          function completeness(p) {
            let score = 0;
            if (p.imagen) score++;
            if (p.precio) score++;
            if (p.sku) score++;
            if (p.categoria) score++;
            return score;
          }

          list.forEach((p) => {
            const normName = cleanText(p.nombre).toLowerCase();
            const normUrl = normalizeUrlForKey(p.url);
            // The product title is the primary identity: it's what
            // actually distinguishes one product from another for
            // whoever reads the spreadsheet, and — unlike the URL — it
            // stays consistent no matter which representation of the
            // product a given pass happened to capture (JSON-LD vs plain
            // HTML card, a query string variant, a different permalink
            // path for the same item, etc.). Only fall back to the URL
            // when there's no usable name to key off of.
            const key = normName || normUrl;

            const existing = seen.get(key);
            if (!existing) {
              seen.set(key, p);
              order.push(key);
              return;
            }
            // Keep whichever version has more complete data (image,
            // price, sku, category); on a tie, prefer the shorter/cleaner
            // name, since the longer one is typically a wrapper container
            // that dragged in extra text (price, rating, etc.) alongside
            // the title.
            const existingScore = completeness(existing);
            const candidateScore = completeness(p);
            if (candidateScore > existingScore) {
              seen.set(key, p);
            } else if (candidateScore === existingScore) {
              const existingName = cleanText(existing.nombre);
              const candidateName = cleanText(p.nombre);
              if (
                candidateName &&
                (!existingName || candidateName.length < existingName.length)
              ) {
                seen.set(key, p);
              }
            }
          });
          return order.map((key) => seen.get(key));
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

        // Builds the URL for an arbitrary page number, mimicking the
        // pattern used by a real pagination link on the site when possible
        // (WordPress "/page/N/" segment, or "?paged=N"/"?page=N" query
        // params), falling back to the standard WordPress "/page/N/"
        // convention appended to the listing URL.
        function buildPageUrl(baseUrl, pageNum, sampleHref) {
          if (sampleHref) {
            if (/\/page\/\d+\/?/.test(sampleHref)) {
              return sampleHref.replace(/\/page\/\d+\/?/, "/page/" + pageNum + "/");
            }
            try {
              const u = new URL(sampleHref);
              if (u.searchParams.has("paged")) {
                u.searchParams.set("paged", pageNum);
                return u.href;
              }
              if (u.searchParams.has("page")) {
                u.searchParams.set("page", pageNum);
                return u.href;
              }
            } catch (e) {
              /* fall through to default pattern below */
            }
          }
          const cleanBase = baseUrl.replace(/\/page\/\d+\/?$/, "").replace(/\/$/, "");
          return cleanBase + "/page/" + pageNum + "/";
        }

        // Looks for the *highest* page number referenced anywhere in the
        // pagination UI (which WordPress/WooCommerce always shows, even
        // when the pages in between are hidden behind a "…" ellipsis), and
        // as a fallback parses a "Mostrando X–Y de Z resultados" / "Showing
        // X-Y of Z results" count to infer the total from the page size.
        // Returns every page URL from 2 up to the detected (and
        // maxPages-capped) total, so the scan doesn't depend on which page
        // numbers happen to be visible in the pagination widget.
        function detectPaginationRun(doc, baseUrl, maxPages) {
          const pageLinks = Array.from(
            doc.querySelectorAll(
              'a[class*="page-numbers"], nav[class*="pag"] a, [class*="pagination"] a, [class*="pager"] a',
            ),
          );
          let maxPage = 1;
          let sampleHref = "";
          pageLinks.forEach((a) => {
            const t = (a.textContent || "").trim();
            if (/^\d+$/.test(t)) {
              const n = parseInt(t, 10);
              if (n > maxPage) maxPage = n;
              const href = a.getAttribute("href");
              if (href && !sampleHref) sampleHref = absoluteUrl(baseUrl, href);
            }
          });

          if (maxPage <= 1) {
            const bodyText = doc.body ? doc.body.textContent : "";
            const match = bodyText.match(
              /(\d+)[\s\u2013\u2014-]+(\d+)\s+(?:de|of)\s+(\d[\d.,]*)\s+(?:resultados|results)/i,
            );
            if (match) {
              const perPage = parseInt(match[2], 10) - parseInt(match[1], 10) + 1;
              const total = parseInt(match[3].replace(/[.,]/g, ""), 10);
              if (perPage > 0 && total > 0) {
                maxPage = Math.ceil(total / perPage);
              }
            }
          }

          if (maxPage <= 1) return { urls: [], total: 0 };

          const cappedMax = Math.min(maxPage, maxPages);
          const urls = [];
          for (let n = 2; n <= cappedMax; n++) {
            urls.push(buildPageUrl(baseUrl, n, sampleHref));
          }
          return { urls, total: maxPage };
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
              // First try to detect the full run of pages directly from a
              // pagination pattern ("/page/N/", "?paged=N") or from a
              // "Mostrando X de Y resultados" count. This finds every page
              // even if the pagination widget only displays a truncated
              // "1 2 3 … 10" window and hides the numbers in between.
              if (pagesScanned === 1) {
                const run = detectPaginationRun(
                  result.doc,
                  nextUrl,
                  maxPages,
                );
                if (run.urls.length > 0) {
                  logLine(
                    '<span class="tag">[paginación]</span> ' +
                      run.total +
                      " página(s) total detectada(s) por numeración; se recorrerán directamente.",
                  );
                  run.urls.forEach((u) => {
                    const norm = normalizeUrl(u);
                    if (!visited.has(norm) && !queue.includes(u))
                      queue.push(u);
                  });
                }
              }

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

            const tdCategory = document.createElement("td");
            tdCategory.className = "cell-muted";
            tdCategory.textContent = p.categoria || "—";
            tdCategory.title = p.categoria || "";

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

            tr.append(tdImg, tdName, tdCategory, tdPrice, tdSku, tdUrl);
            resultsBody.appendChild(tr);
          });
        }

        // ---------- Export ----------

        function exportToExcel() {
          if (products.length === 0) return;

          const rows = products.map((p) => ({
            nombre: p.nombre || "",
            categoria: p.categoria || "",
            precio: p.precio || "",
            sku: p.sku || "",
            imagen: p.imagen || "",
            url_origen: p.url || "",
          }));

          const ws = XLSX.utils.json_to_sheet(rows);
          ws["!cols"] = [
            { wch: 38 },
            { wch: 20 },
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
