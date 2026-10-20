"use strict";

// Mapa de arriendos de Santiago: cada punto es un aviso activo, coloreado por la etiqueta del modelo.
// Los datos salen de data/avisos.json (lo genera scripts/exportar.py).

const ETIQUETAS = {
  oportunidad: { texto: "Oportunidad", color: "#2e7d32" },
  precio_de_mercado: { texto: "Precio de mercado", color: "#5a6b7d" },
  caro: { texto: "Caro", color: "#c62828" },
};
// Los valores deben coincidir exactos con los que guarda el scoring (la baja confianza no sigue el orden de las otras dos).
const CONFIANZAS = {
  "alta confianza": { texto: "Alta", color: "#2e7d32" },
  "confianza media": { texto: "Media", color: "#b8860b" },
  "baja confianza": { texto: "Baja", color: "#8a8a8a" },
};
const NOMBRE_COMUNA = {
  "santiago": "Santiago", "nunoa": "Ñuñoa", "providencia": "Providencia", "estacion-central": "Estación Central",
  "san-miguel": "San Miguel", "independencia": "Independencia", "macul": "Macul", "la-florida": "La Florida",
  "recoleta": "Recoleta", "huechuraba": "Huechuraba", "quinta-normal": "Quinta Normal", "conchali": "Conchalí",
};
const comunaTexto = (slug) => NOMBRE_COMUNA[slug.replace(/-metropolitana$/, "")] ?? slug;
const BUCKETS = ["0", "1", "2", "3", "4+"];
const NOMBRE_BUCKET = { "0": "Sin especificar", "1": "1", "2": "2", "3": "3", "4+": "4+" };

// Fondo gris claro de Esri en dos capas (base y nombres). Esri usa {z}/{y}/{x}, no {z}/{x}/{y}.
const ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas";
const ESTILO = {
  version: 8,
  sources: {
    base: { type: "raster", tileSize: 256, maxzoom: 16, tiles: [`${ESRI}/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}`],
      attribution: "Esri, HERE, Garmin, © OpenStreetMap contributors" },
    nombres: { type: "raster", tileSize: 256, maxzoom: 16, tiles: [`${ESRI}/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}`] },
  },
  layers: [{ id: "base", type: "raster", source: "base" }, { id: "nombres", type: "raster", source: "nombres" }],
};

const $ = (id) => document.getElementById(id);
const clp = (n) => (n == null ? "—" : "$" + Math.round(n).toLocaleString("es-CL"));
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const bucket = (n) => (n == null || n <= 0 ? "0" : n >= 4 ? "4+" : String(n));
const costo = (a) => a.ct ?? (a.p != null ? a.p + (a.gc ?? 0) : null);

let AVISOS = [];
let mapa;
let seleccionado = null;
const filtros = {};
const controles = {};   // rangos y casillas, para poder reiniciarlos

// ------------------------------------------------------------------ rango doble

function crearRango(contenedor, { min, max, paso, formato, abiertoArriba }) {
  contenedor.innerHTML = `<div class="valores"><span></span><span></span></div>
    <div class="pista"><div class="tramo"></div><input type="range" aria-label="mínimo"><input type="range" aria-label="máximo"></div>`;
  const [vMin, vMax] = contenedor.querySelectorAll(".valores span");
  const [rMin, rMax] = contenedor.querySelectorAll("input");
  const tramo = contenedor.querySelector(".tramo");
  for (const r of [rMin, rMax]) { r.min = min; r.max = max; r.step = paso; }
  const estado = { min, max, lo: min, hi: max, alCambiar: () => {} };

  function pintar() {
    vMin.textContent = formato(estado.lo);
    vMax.textContent = formato(estado.hi) + (abiertoArriba && estado.hi === max ? " o más" : "");
    const span = max - min || 1;
    tramo.style.left = ((estado.lo - min) / span) * 100 + "%";
    tramo.style.right = (1 - (estado.hi - min) / span) * 100 + "%";
    rMin.value = estado.lo; rMax.value = estado.hi;
  }
  rMin.addEventListener("input", () => { estado.lo = Math.min(+rMin.value, estado.hi); pintar(); estado.alCambiar(); });
  rMax.addEventListener("input", () => { estado.hi = Math.max(+rMax.value, estado.lo); pintar(); estado.alCambiar(); });
  estado.reiniciar = () => { estado.lo = min; estado.hi = max; pintar(); };
  estado.completo = () => estado.lo === min && estado.hi === max;
  estado.admite = (v) => v >= estado.lo && (v <= estado.hi || (abiertoArriba && estado.hi === max));
  pintar();
  return estado;
}

// ------------------------------------------------------------------ filtros

function crearChips(id, opciones, conteos, clase) {
  const cont = $(id);
  cont.innerHTML = "";
  const marcados = new Set(opciones.map((o) => o.valor));
  for (const o of opciones) {
    const el = document.createElement("label");
    el.className = "chip " + (clase ? clase + o.valor : "");
    el.innerHTML = `<input type="checkbox" checked><span>${esc(o.texto)}</span><small>${conteos[o.valor] ?? 0}</small>`;
    el.querySelector("input").addEventListener("change", (e) => {
      e.target.checked ? marcados.add(o.valor) : marcados.delete(o.valor);
      aplicar();
    });
    cont.append(el);
  }
  return { marcados, todos: opciones.map((o) => o.valor), contenedor: cont };
}

function contar(fn) {
  const c = {};
  for (const a of AVISOS) { const k = fn(a); c[k] = (c[k] || 0) + 1; }
  return c;
}

function construirFiltros() {
  const costos = AVISOS.map(costo).filter((x) => x != null);
  const sups = AVISOS.map((a) => a.su).filter((x) => x != null);
  // Los extremos se redondean hacia afuera: con truncar, el aviso más caro quedaba fuera de su propio rango.
  // El tope del control es el percentil 99: unos pocos avisos con precios absurdos estiraban el rango. Con el control al
  // tope no hay límite superior, así que esos avisos siguen apareciendo.
  const p99 = (v) => [...v].sort((x, y) => x - y)[Math.floor(v.length * 0.99)];
  controles.costo = crearRango($("r-costo"), { min: Math.floor(Math.min(...costos) / 10000) * 10000,
    max: Math.ceil(p99(costos) / 10000) * 10000, paso: 10000, formato: clp, abiertoArriba: true });
  controles.sup = crearRango($("r-sup"), { min: Math.floor(Math.min(...sups)), max: Math.ceil(p99(sups)), paso: 1,
    formato: (n) => n + " m²", abiertoArriba: true });
  controles.costo.alCambiar = controles.sup.alCambiar = aplicar;

  const cd = contar((a) => bucket(a.d)), cb = contar((a) => bucket(a.ba));
  const buckets = (c) => BUCKETS.filter((b) => b !== "0" || c[b]).map((b) => ({ valor: b, texto: NOMBRE_BUCKET[b] }));
  controles.dorm = crearChips("f-dorm", buckets(cd), cd);
  controles.banos = crearChips("f-banos", buckets(cb), cb);

  const cc = contar((a) => a.c);
  const comunas = Object.keys(cc).sort((a, b) => comunaTexto(a).localeCompare(comunaTexto(b), "es"));
  const lista = $("f-comuna");
  lista.innerHTML = "";
  controles.comuna = { marcados: new Set(comunas), todos: comunas, contenedor: lista };
  for (const c of comunas) {
    const el = document.createElement("label");
    el.className = "check";
    el.innerHTML = `<input type="checkbox" checked><span>${esc(comunaTexto(c))}</span><small>${cc[c]}</small>`;
    el.querySelector("input").addEventListener("change", (e) => {
      e.target.checked ? controles.comuna.marcados.add(c) : controles.comuna.marcados.delete(c);
      aplicar();
    });
    lista.append(el);
  }
  document.querySelectorAll("[data-todas],[data-ninguna]").forEach((b) => b.addEventListener("click", () => {
    const marcar = "todas" in b.dataset;
    controles.comuna.marcados = new Set(marcar ? comunas : []);
    lista.querySelectorAll("input").forEach((i) => { i.checked = marcar; });
    aplicar();
  }));

  const ce = contar((a) => a.et), cf = contar((a) => a.cf);
  controles.etiqueta = crearChips("f-etiqueta", Object.entries(ETIQUETAS).map(([valor, e]) => ({ valor, texto: e.texto })), ce, "et-");
  controles.confianza = crearChips("f-confianza", Object.entries(CONFIANZAS).map(([valor, c]) => ({ valor, texto: c.texto })), cf);

  $("f-amoblado").addEventListener("change", aplicar);
  $("f-estac").addEventListener("change", aplicar);
  $("limpiar").addEventListener("click", reiniciar);
}

function reiniciar() {
  controles.costo.reiniciar(); controles.sup.reiniciar();
  for (const k of ["dorm", "banos", "comuna", "etiqueta", "confianza"]) {
    controles[k].marcados = new Set(controles[k].todos);
    controles[k].contenedor.querySelectorAll("input").forEach((i) => { i.checked = true; });
  }
  $("f-amoblado").checked = $("f-estac").checked = false;
  aplicar();
}

function pasa(a) {
  const c = costo(a);
  if (c != null && !controles.costo.admite(c)) return false;
  // Sin superficie informada el aviso solo se oculta si el usuario acotó el rango.
  if (a.su == null ? !controles.sup.completo() : !controles.sup.admite(a.su)) return false;
  if (!controles.dorm.marcados.has(bucket(a.d)) || !controles.banos.marcados.has(bucket(a.ba))) return false;
  if (!controles.comuna.marcados.has(a.c)) return false;
  if (!controles.etiqueta.marcados.has(a.et) || !controles.confianza.marcados.has(a.cf)) return false;
  if ($("f-amoblado").checked && !a.am) return false;
  if ($("f-estac").checked && !(a.e > 0)) return false;
  return true;
}

// ------------------------------------------------------------------ mapa

function geojson(lista) {
  return { type: "FeatureCollection", features: lista.map((a) => ({
    type: "Feature", geometry: { type: "Point", coordinates: [a.lon, a.lat] }, properties: { i: a.i, et: a.et } })) };
}

function aplicar() {
  const visibles = AVISOS.filter(pasa);
  $("resumen").textContent = `${visibles.length.toLocaleString("es-CL")} de ${AVISOS.length.toLocaleString("es-CL")} departamentos`;
  if (mapa.getSource("avisos")) mapa.getSource("avisos").setData(geojson(visibles));
  if (seleccionado != null && !visibles.some((a) => a.i === seleccionado)) cerrarTarjeta();
}

function hace(iso) {
  if (!iso) return null;
  const dias = Math.round((Date.now() - new Date(iso)) / 86400000);
  return dias <= 0 ? "hoy" : dias === 1 ? "hace 1 día" : `hace ${dias} días`;
}

function tarjeta(a) {
  const et = ETIQUETAS[a.et] || { texto: a.et, color: "#888" };
  const cf = CONFIANZAS[a.cf] || { texto: a.cf, color: "#888" };
  const ubic = a.b ? `${comunaTexto(a.c)} · ${a.b}` : comunaTexto(a.c);
  const sup = a.su != null ? `${Math.round(a.su)} m² útiles` + (a.st != null && Math.abs(a.st - a.su) > 1 ? ` (${Math.round(a.st)} totales)` : "") : "superficie no informada";
  const pub = hace(a.pub), vis = hace(a.vis);
  const mercado = a.bi != null && a.bs != null
    ? `<div class="t-mercado">Rango de precio de mercado estimado<br><b>${clp(a.bi)} – ${clp(a.bs)}</b> al mes</div>` : "";
  const enlace = a.url.startsWith("https://") ? `<a class="t-enlace" href="${esc(a.url)}" target="_blank" rel="noopener noreferrer">Ver publicación original →</a>` : "";
  return `
    <div class="insignias">
      <span class="insignia" style="background:${et.color}">${esc(et.texto)}</span>
      <span class="insignia" style="background:${cf.color}">Confianza ${esc(cf.texto.toLowerCase())}</span>
    </div>
    <p class="t-titulo">${esc(a.t)}</p>
    <p class="t-ubic">${esc(ubic)}</p>
    <p class="t-datos">🛏️ ${a.d ?? "—"} dorm. · 🚿 ${a.ba ?? "—"} baños · 📐 ${sup}</p>
    <p class="t-datos">🚗 ${a.e > 0 ? a.e + " estac." : "sin estacionamiento"} · 🛋️ ${a.am ? "amoblado" : "sin amoblar"}</p>
    <p class="t-precio">${clp(costo(a))}</p>
    <p class="t-sub">costo total mensual: arriendo ${clp(a.p)} + gastos comunes ${clp(a.gc)}</p>
    ${mercado}
    <p class="t-fecha">${pub ? "Publicado " + pub + " (aprox.)" : ""}${pub && vis ? " · " : ""}${vis ? "visto " + vis : ""}</p>
    ${enlace}`;
}

function abrirTarjeta(i) {
  seleccionado = i;
  $("tarjeta-contenido").innerHTML = tarjeta(AVISOS[i]);
  $("tarjeta").hidden = false;
  mapa.setFilter("seleccion", ["==", ["get", "i"], i]);
}

function cerrarTarjeta() {
  seleccionado = null;
  $("tarjeta").hidden = true;
  if (mapa.getLayer("seleccion")) mapa.setFilter("seleccion", ["==", ["get", "i"], -1]);
}

function alternarPanel(forzar) {
  const oculto = forzar ?? !document.body.classList.contains("sin-panel");
  document.body.classList.toggle("sin-panel", oculto);
  $("alternar").textContent = oculto ? "›" : "‹";
  $("alternar").setAttribute("aria-expanded", String(!oculto));
  $("alternar").setAttribute("aria-label", oculto ? "Mostrar filtros" : "Ocultar filtros");
  setTimeout(() => mapa.resize(), 280);
}

function iniciarMapa() {
  mapa = new maplibregl.Map({ container: "mapa", style: ESTILO, center: [-70.62, -33.46], zoom: 11, attributionControl: { compact: true } });
  mapa.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-left");
  const colores = ["match", ["get", "et"], ...Object.entries(ETIQUETAS).flatMap(([k, e]) => [k, e.color]), "#888888"];
  mapa.on("load", () => {
    mapa.addSource("avisos", { type: "geojson", data: geojson(AVISOS) });
    mapa.addLayer({ id: "puntos", type: "circle", source: "avisos", paint: {
      "circle-color": colores, "circle-stroke-color": "#ffffff", "circle-stroke-width": 1,
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 9, 3, 12, 5.5, 16, 10] } });
    mapa.addLayer({ id: "seleccion", type: "circle", source: "avisos", filter: ["==", ["get", "i"], -1], paint: {
      "circle-color": "rgba(0,0,0,0)", "circle-stroke-color": "#1a2b4c", "circle-stroke-width": 3,
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 9, 6, 12, 9, 16, 14] } });
    const lon = AVISOS.map((a) => a.lon), lat = AVISOS.map((a) => a.lat);
    const ordenar = (v) => [...v].sort((x, y) => x - y);
    const q = (v, p) => ordenar(v)[Math.floor(v.length * p)];   // ignora coordenadas atípicas al encuadrar
    mapa.fitBounds([[q(lon, 0.01), q(lat, 0.01)], [q(lon, 0.99), q(lat, 0.99)]], { padding: 40, animate: false });
    aplicar();

    mapa.on("click", "puntos", (e) => abrirTarjeta(e.features[0].properties.i));
    mapa.on("click", (e) => { if (!mapa.queryRenderedFeatures(e.point, { layers: ["puntos"] }).length) cerrarTarjeta(); });
    mapa.on("mouseenter", "puntos", () => { mapa.getCanvas().style.cursor = "pointer"; });
    mapa.on("mouseleave", "puntos", () => { mapa.getCanvas().style.cursor = ""; });
  });
}

// ------------------------------------------------------------------ pestaña "Cómo funciona"

// Nombres legibles de las variables que más pesan (las demás se muestran con su nombre interno).
const NOMBRE_VARIABLE = {
  superficie_total_m2: "Superficie total", log_sup_util: "Superficie útil", banos: "Número de baños",
  dormitorios: "Número de dormitorios", estacionamientos: "Número de estacionamientos",
  dist_centro_las_condes_km: "Distancia al centro de Las Condes (zona de precios altos)",
  precio_m2_sector: "Costo por m² de comparables cercanos", comuna_precio_m2: "Nivel de precio de la comuna",
  barrio_precio_m2: "Nivel de precio del barrio", tx_pred_log_m2: "Precio por m² estimado desde el texto del aviso",
  longitud: "Ubicación (este-oeste)", latitud: "Ubicación (norte-sur)", amoblado: "Amoblado", antiguedad_anos: "Antigüedad del edificio",
  rank_nac: "Vulnerabilidad del sector (ranking nacional)", dist_centro_providencia_km: "Distancia al centro de Providencia",
};

const fmtPct = (n, d = 1) => n.toLocaleString("es-CL", { minimumFractionDigits: d, maximumFractionDigits: d }) + " %";
const fmtN = (n) => Math.round(n).toLocaleString("es-CL");

function llenarExplicacion(m) {
  const base = m.baselines || {};
  const valores = {
    version: m.version, algoritmo: m.algoritmo, n_modelos: m.n_modelos, n_variables: m.n_variables,
    n_total: fmtN(m.n_train + m.n_val + m.n_test), n_train: fmtN(m.n_train), n_val: fmtN(m.n_val), n_test: fmtN(m.n_test),
    ventana_dias: m.ventana_dias ?? "—",
    mae: clp(m.metricas.mae), mape: fmtPct(m.metricas.mape), mdape: fmtPct(m.metricas.mdape),
    dentro_10: fmtPct(m.metricas.dentro_10), r2: fmtPct(m.metricas.r2 * 100), mae_caro: clp(m.metricas.mae_quintil_caro),
    b_media: clp(base.baseline_media_train_mae), b_m2: clp(base.baseline_mercado_m2_sector_mae),
  };
  document.querySelectorAll("[data-m]").forEach((el) => { if (el.dataset.m in valores) el.textContent = valores[el.dataset.m]; });

  const maximo = Math.max(...m.importancia.map((v) => v.pct));
  $("tabla-importancia").innerHTML = "<tr><th>#</th><th>Variable</th><th class='num'>% del total</th><th></th></tr>" +
    m.importancia.map((v, i) => `<tr><td>${i + 1}</td><td>${esc(NOMBRE_VARIABLE[v.variable] ?? v.variable)}</td>
      <td class="num">${fmtPct(v.pct)}</td><td><span class="barra-imp" style="width:${Math.round((v.pct / maximo) * 120)}px"></span></td></tr>`).join("");

  const c = m.cortes_costo.map((x) => clp(x));
  const tramos = [`< ${c[0]}`, ...c.slice(1).map((x, i) => `${c[i]} – ${x}`), `> ${c[c.length - 1]}`];
  $("bordes").innerHTML = tramos.map(esc).join(" &nbsp;·&nbsp; ");

  const e = m.etiquetas_test;
  $("reparto").textContent = `En los avisos de test, ${fmtPct(e.precio_de_mercado * 100, 0)} quedó como precio de mercado, ` +
    `${fmtPct(e.oportunidad * 100, 0)} como oportunidad y ${fmtPct(e.caro * 100, 0)} como caro.`;
  $("pie-modelo").textContent = `Cifras del modelo vigente (versión ${m.version}), actualizadas el ` +
    new Date(m.generado).toLocaleDateString("es-CL", { dateStyle: "long" }) + ".";
}

async function cargarExplicacion() {
  try {
    const r = await fetch("data/modelo.json", { cache: "no-cache" });
    if (!r.ok) throw new Error(r.status);
    llenarExplicacion(await r.json());
  } catch {
    $("pie-modelo").textContent = "No se pudieron cargar las cifras del modelo.";
  }
}

function mostrarVista(vista) {
  const explicacion = vista === "explicacion";
  document.body.classList.toggle("ver-explicacion", explicacion);
  $("vista-explicacion").hidden = !explicacion;
  document.querySelectorAll(".pestana").forEach((b) => b.classList.toggle("activa", b.dataset.vista === vista));
  history.replaceState(null, "", explicacion ? "#como-funciona" : location.pathname + location.search);
  if (!explicacion && mapa) setTimeout(() => mapa.resize(), 50);
}

// ------------------------------------------------------------------ arranque

async function iniciar() {
  $("alternar").addEventListener("click", () => alternarPanel());
  document.querySelectorAll(".pestana").forEach((b) => b.addEventListener("click", () => mostrarVista(b.dataset.vista)));
  cargarExplicacion();
  if (location.hash === "#como-funciona") mostrarVista("explicacion");
  $("cerrar").addEventListener("click", cerrarTarjeta);
  if (matchMedia("(max-width: 760px)").matches) document.body.classList.add("sin-panel");
  try {
    const r = await fetch("data/avisos.json", { cache: "no-cache" });
    if (!r.ok) throw new Error(r.status);
    const doc = await r.json();
    AVISOS = doc.avisos;
    AVISOS.forEach((a, i) => { a.i = i; });
    $("actualizado").textContent = "Actualizado " + new Date(doc.generado).toLocaleString("es-CL", { dateStyle: "short", timeStyle: "short" });
  } catch {
    $("resumen").textContent = "No se pudieron cargar los datos";
    return;
  }
  construirFiltros();
  iniciarMapa();
  if (document.body.classList.contains("sin-panel")) $("alternar").textContent = "›";
}

iniciar();
