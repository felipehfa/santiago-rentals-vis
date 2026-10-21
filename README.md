# santiago-rentals-vis

Mapa de los departamentos en arriendo de Santiago, con la etiqueta del modelo (**oportunidad**, **precio de mercado** o
**caro**) y su nivel de confianza. Es HTML y JavaScript sin build ni framework: el mapa ocupa toda la pantalla y los filtros
están en una barra a la izquierda que se puede ocultar. Versión para Santiago del buscador que se hizo para el Gran Concepción.

Repo hermano de `santiago-rentals-elt` (datos) y `santiago-rentals-ml` (modelo). Este repo solo **lee**: nunca escribe en la base.

## Qué muestra

- Un punto por aviso **activo y apto** (sin ningún motivo de exclusión en Gold: precio, superficie o conteos sospechosos, sin
  coordenadas, proyectos, etc.), coloreado por etiqueta (verde oportunidad, gris precio de mercado, rojo caro). Los pausados,
  finalizados y eliminados no se muestran.
- Al hacer clic: etiqueta y confianza, comuna y barrio, dormitorios, baños, superficie, estacionamiento, amoblado, costo total
  mensual (arriendo más gastos comunes), el **rango de precio de mercado** que estima el modelo, fechas y el **enlace a la
  publicación original**. No se exporta la descripción del aviso.
- Filtros: costo total, superficie, dormitorios, baños (con la opción "Sin especificar"), comuna, etiqueta, confianza, amoblado
  y estacionamiento. El contador de arriba dice cuántos avisos pasan los filtros.
- Los controles de costo y superficie llegan hasta el percentil 99; al dejarlos al tope no hay límite superior.
- **Pestaña "Cómo funciona"** (como la de Concepción, con las cifras de este modelo): qué es, datos usados, variables que más pesan,
  precisión frente a dos estimaciones ingenuas, estratos de costo, cuándo es oportunidad o caro, qué es la confianza y advertencias.
  Las cifras salen de `data/modelo.json`, no están escritas a mano en la página.

## Cómo funciona

```
gold.predicciones_vigentes ─┐
gold.aviso_entrenamiento ───┼─> scripts/exportar.py ─> data/avisos.json ─> index.html + app.js (MapLibre GL)
silver.avisos (url) ────────┘
```

- `scripts/exportar.py` lee las tres tablas y escribe `data/avisos.json` con los campos que usa el mapa. Solo exporta avisos
  con `apto_entrenamiento` (los mismos que usa el entrenamiento) y, por si acaso, con costo total de hasta 10 millones (el tope
  del entrenamiento).
- `app.js` dibuja el mapa con [MapLibre GL JS](https://maplibre.org) sobre el fondo gris claro de Esri (los tiles usan el orden
  `{z}/{y}/{x}`), filtra en el navegador y arma la tarjeta.
- `data/avisos.json` **no está en git**: se genera en cada publicación.
- `scripts/exportar_modelo.py` lee el `@champion` de MLflow (métricas, tamaños de los conjuntos, baselines, importancia de
  variables, deciles de costo y reparto de etiquetas) y escribe `data/modelo.json`, que **sí está en git**. Se corre a mano
  después de que un modelo nuevo sea promovido (usa las variables de MLflow del `.env.nube` del repo del modelo) y se sube el
  archivo; mientras no cambie el champion, no hace falta.

## Ejecutar en local

```bash
pip install -r requirements.txt
# BD_STRING_VIS en .env (o en el entorno): cadena de conexión con lectura sobre esas tablas
python scripts/exportar.py
python -m http.server 8765        # abrir http://localhost:8765
```

## Publicación (GitHub Pages)

`.github/workflows/publicar.yml` regenera el JSON y publica el sitio cada 3 horas (20 minutos después del scoring) y a mano.
Requisitos, una sola vez:

1. En Settings > Pages, fuente **GitHub Actions**.
2. Secret `BD_STRING_VIS` con un rol de solo lectura sobre `gold.predicciones_vigentes`, `gold.aviso_entrenamiento` y, de `silver.avisos`, solo las columnas `id_aviso` y `url`.

El sitio publicado es **público**, igual que el repo: cualquiera ve los avisos exportados (ubicación, precio, etiqueta y enlace).

## Contador de visitas

La página cuenta visitas con [GoatCounter](https://www.goatcounter.com) (sin cookies ni datos personales; el panel está en
`https://santiago-rentals.goatcounter.com`). Además de las visitas, registra tres eventos: `pestana-mapa`, `pestana-explicacion`
y `clic-publicacion-original`. En local (`localhost`) no cuenta. La pestaña "Cómo funciona" lo avisa al pie.

## Pendiente

- Automatizar `data/modelo.json` (hoy es manual tras cada promoción): por ejemplo que el entrenamiento del repo ML lo publique al promover.
- Crear el rol de lectura para la publicación y cargar el secret (hoy el JSON se genera con una cuenta local).
- Excluir del scoring los avisos con precio sospechoso (`scoring.motivos_predecibles` en el repo ML): hoy reciben una etiqueta sin sentido, aunque ya no llegan al mapa.
- Agrupar puntos (clusters) si el mapa se satura al alejar el zoom.
