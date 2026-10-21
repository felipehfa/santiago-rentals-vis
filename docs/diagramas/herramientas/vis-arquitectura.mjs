import { fileURLToPath } from "node:url";

import { construir, nota } from "./lib.mjs";

const DESTINO = fileURLToPath(new URL("..", import.meta.url));  // docs/diagramas/

// Dos filas: arriba los avisos (tres tablas -> exportador -> JSON -> mapa) y abajo las cifras del modelo (MLflow -> JSON ->
// pestaña "Cómo funciona"). Columnas en x = 20, 420, 780 y 1140; GoatCounter queda a la derecha del mapa.
await construir({
  archivo: "vis-arquitectura",
  destino: DESTINO,
  pagina: "Arquitectura del mapa",
  nodos: [
    { key: "vigentes", shape: "cylinder", label: "gold.predicciones_vigentes", color: "Datos", x: 10, y: 20, w: 330, h: 100 },
    { key: "entren", shape: "cylinder", label: "gold.aviso_entrenamiento", color: "Datos", x: 10, y: 170, w: 330, h: 100 },
    { key: "silver", shape: "cylinder", label: "silver.avisos (url)", color: "Datos", x: 10, y: 320, w: 330, h: 100 },
    { key: "exportar", shape: "rect", label: "scripts/exportar.py", color: "Servicio", x: 450, y: 175, w: 290, h: 90 },
    { key: "avisos", shape: "rect", label: "data/avisos.json", color: "Almacén", x: 850, y: 175, w: 270, h: 90 },
    { key: "mapa", shape: "rect", label: "Mapa (MapLibre)", color: "Éxito", x: 1230, y: 175, w: 270, h: 90 },
    { key: "goat", shape: "rect", label: "GoatCounter", color: "Externo", x: 1230, y: 380, w: 270, h: 90 },
    { key: "mlflow", shape: "cylinder", label: "MLflow @champion", color: "Almacén", x: 10, y: 620, w: 330, h: 100 },
    { key: "expmod", shape: "rect", label: "scripts/exportar_modelo.py", color: "Servicio", x: 450, y: 625, w: 290, h: 90 },
    { key: "modelo", shape: "rect", label: "data/modelo.json", color: "Almacén", x: 850, y: 625, w: 270, h: 90 },
    { key: "pestana", shape: "rect", label: "Pestaña Cómo funciona", color: "Éxito", x: 1230, y: 625, w: 290, h: 90 },
    nota("n_fuentes", 10, 450, 330, 90, "Solo avisos activos y\naptos para entrenar"),
    nota("n_exportar", 440, 450, 330, 90, "GitHub Actions, cada 3 h;\ncosto total hasta 10 millones"),
    nota("n_mapa", 1190, 60, 350, 70, "Filtros en el navegador;\nclic: tarjeta y enlace"),
    nota("n_goat", 860, 390, 330, 90, "Visitas y clics, sin\ncookies ni datos personales"),
    nota("n_expmod", 430, 750, 330, 70, "A mano, tras promover\nun modelo nuevo"),
  ],
  aristas: [
    { from: "vigentes", to: "exportar", label: "etiqueta", fromSide: "e", toSide: "n" },
    { from: "entren", to: "exportar", label: "datos" },
    { from: "silver", to: "exportar", label: "url", fromSide: "e", toSide: "s" },
    { from: "exportar", to: "avisos", label: "escribe" },
    { from: "avisos", to: "mapa", label: "lee" },
    { from: "mapa", to: "goat", label: "visitas", fromSide: "s", toSide: "n" },
    { from: "mlflow", to: "expmod", label: "métricas" },
    { from: "expmod", to: "modelo", label: "escribe" },
    { from: "modelo", to: "pestana", label: "lee" },
  ],
  eventos: [],
  historias: [
    {
      nombre: "Publicación del mapa con avisos nuevos",
      pasos: [
        { ev: "envia", de: "vigentes", a: "exportar", espera: 0 },
        { ev: "envia", de: "entren", a: "exportar", espera: 100 },
        { ev: "envia", de: "silver", a: "exportar", espera: 100 },
        { ev: "procesa", nodo: "exportar", tras: [0, 1, 2] },
        { ev: "envia", de: "exportar", a: "avisos", tras: [0, 1, 2] },
        { ev: "envia", de: "avisos", a: "mapa", espera: 600, tras: [4] },
      ],
    },
    {
      nombre: "Un visitante abre el mapa",
      pasos: [
        { ev: "envia", de: "avisos", a: "mapa", espera: 0 },
        { ev: "procesa", nodo: "mapa", tras: [0] },
        { ev: "envia", de: "mapa", a: "goat", espera: 400, tras: [0] },
      ],
    },
    {
      nombre: "Las cifras del modelo llegan a la pestaña",
      pasos: [
        { ev: "envia", de: "mlflow", a: "expmod", espera: 0 },
        { ev: "procesa", nodo: "expmod", tras: [0] },
        { ev: "envia", de: "expmod", a: "modelo", tras: [0] },
        { ev: "envia", de: "modelo", a: "pestana", espera: 600, tras: [2] },
      ],
    },
  ],
});
