import { fileURLToPath } from "node:url";

import { construir, nota } from "./lib.mjs";

const DESTINO = fileURLToPath(new URL("..", import.meta.url));  // docs/diagramas/

// Tres tablas de Gold a la izquierda, el exportador al centro y dos salidas (avisos y cifras del modelo) que alimentan el mapa y
// su pestaña "Cómo funciona". GoatCounter queda sobre el mapa. Columnas en x = 10, 450, 850 y 1230.
await construir({
  archivo: "vis-arquitectura",
  destino: DESTINO,
  pagina: "Arquitectura del mapa",
  nodos: [
    { key: "vigentes", shape: "cylinder", label: "gold.predicciones_vigentes", color: "Datos", x: 10, y: 20, w: 330, h: 100 },
    { key: "entren", shape: "cylinder", label: "gold.aviso_entrenamiento", color: "Datos", x: 10, y: 170, w: 330, h: 100 },
    { key: "modelov", shape: "cylinder", label: "gold.modelo_vigente", color: "Datos", x: 10, y: 320, w: 330, h: 100 },
    { key: "exportar", shape: "rect", label: "scripts/exportar.py", color: "Servicio", x: 450, y: 175, w: 290, h: 90 },
    { key: "avisos", shape: "rect", label: "data/avisos.json", color: "Almacén", x: 850, y: 175, w: 270, h: 90 },
    { key: "modelo", shape: "rect", label: "data/modelo.json", color: "Almacén", x: 850, y: 380, w: 270, h: 90 },
    { key: "mapa", shape: "rect", label: "Mapa (MapLibre)", color: "Éxito", x: 1230, y: 175, w: 270, h: 90 },
    { key: "pestana", shape: "rect", label: "Pestaña Cómo funciona", color: "Éxito", x: 1230, y: 380, w: 290, h: 90 },
    { key: "goat", shape: "rect", label: "GoatCounter", color: "Externo", x: 1230, y: 20, w: 270, h: 90 },
    nota("n_fuentes", 10, 450, 330, 90, "Solo avisos activos y\naptos para entrenar"),
    nota("n_exportar", 430, 470, 340, 110, "GitHub Actions, cada 30 min;\ncosto total hasta 10 millones"),
    nota("n_goat", 850, 20, 330, 90, "Visitas y clics, sin\ncookies ni datos personales"),
    nota("n_mapa", 1190, 280, 350, 70, "Filtros en el navegador;\nclic: tarjeta y enlace"),
    nota("n_modelo", 850, 490, 330, 90, "El scoring escribe la fila\nal promover un modelo"),
  ],
  aristas: [
    { from: "vigentes", to: "exportar", label: "etiqueta", fromSide: "e", toSide: "n" },
    { from: "entren", to: "exportar", label: "datos y url" },
    { from: "modelov", to: "exportar", label: "modelo", fromSide: "e", toSide: "s" },
    { from: "exportar", to: "avisos", label: "avisos" },
    { from: "exportar", to: "modelo", label: "cifras", fromSide: "e", toSide: "w" },
    { from: "avisos", to: "mapa", label: "lee" },
    { from: "modelo", to: "pestana", label: "lee" },
    { from: "mapa", to: "goat", label: "visitas", fromSide: "n", toSide: "s" },
  ],
  eventos: [],
  historias: [
    {
      nombre: "Publicación del mapa con avisos nuevos",
      pasos: [
        { ev: "envia", de: "vigentes", a: "exportar", espera: 0 },
        { ev: "envia", de: "entren", a: "exportar", espera: 100 },
        { ev: "procesa", nodo: "exportar", tras: [0, 1] },
        { ev: "envia", de: "exportar", a: "avisos", tras: [0, 1] },
        { ev: "envia", de: "avisos", a: "mapa", espera: 600, tras: [3] },
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
        { ev: "envia", de: "modelov", a: "exportar", espera: 0 },
        { ev: "procesa", nodo: "exportar", tras: [0] },
        { ev: "envia", de: "exportar", a: "modelo", tras: [0] },
        { ev: "envia", de: "modelo", a: "pestana", espera: 600, tras: [2] },
      ],
    },
  ],
});
