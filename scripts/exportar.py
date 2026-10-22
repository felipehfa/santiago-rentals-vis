"""Exporta a data/ lo que muestra el mapa: los avisos activos con su predicción vigente y las cifras del modelo.

- data/avisos.json: avisos activos y **aptos** (sin ningún motivo de exclusión en Gold) con etiqueta de mercado. Solo salen los
  campos que usa la vista; nunca la descripción. Las coordenadas van con 5 decimales (~1 m), tal como las entrega el portal:
  son departamentos en edificios, no casas, y la ubicación del edificio ya es pública en el aviso.
- data/modelo.json: las cifras del modelo vigente (versión más reciente de gold.modelo_vigente), para la pestaña "Cómo funciona".
  Si la tabla aún no existe o está vacía, no se escribe y la pestaña avisa que no hay cifras.

Lee gold.predicciones_vigentes, gold.aviso_entrenamiento (con la url de la publicación) y gold.modelo_vigente.

Variable de entorno: BD_STRING_VIS (cadena de conexión con permiso de lectura sobre esas tablas). Si existe un `.env` en la
raíz del repo, se carga.

Uso:
    python scripts/exportar.py [carpeta_de_salida]
"""
import json
import os
import re
import sys
from datetime import UTC, datetime
from pathlib import Path

import psycopg2
from dotenv import load_dotenv

RAIZ = Path(__file__).resolve().parents[1]
CARPETA = RAIZ / "data"
DECIMALES_COORDENADAS = 5   # ~1 m; solo se recortan los dígitos de más
# El mismo tope del entrenamiento (santiago-rentals-ml/config.yaml); sobre eso son errores de precio.
COSTO_TOTAL_MAX_CLP = 10_000_000

# Algunos avisos ponen un teléfono o un correo en el título. El mapa es público y no publica datos de contacto: se tapan.
RE_TELEFONO = re.compile(r"(?<!\d)(?:\+?\s?56[\s.-]?)?9(?:[\s.-]?\d){8}(?!\d)"
                         r"|(?<!\d)\d{2}[\s.-]?\d{3}[\s.-]?\d{4}(?!\d)")
RE_CORREO = re.compile(r"[\w.+-]+@[\w-]+\.[\w.]+")


def sin_contacto(texto):
    """Reemplaza teléfonos y correos del texto por "[contacto oculto]"."""
    if not texto:
        return texto
    return RE_CORREO.sub("[contacto oculto]", RE_TELEFONO.sub("[contacto oculto]", texto))


SQL_AVISOS = """
SELECT g.id_aviso, g.url, g.titulo, g.comuna, g.barrio,
       g.latitud, g.longitud, g.dormitorios, g.banos, g.superficie_util_m2, g.superficie_total_m2,
       g.estacionamientos, g.amoblado, g.precio_clp, g.gastos_comunes, g.fecha_publicacion_aprox, g.ultima_vez_visto,
       p.costo_total_publicado_clp, p.costo_total_predicho_clp, p.banda_inferior_clp, p.banda_superior_clp,
       p.etiqueta, p.z_robusto
FROM gold.predicciones_vigentes p
JOIN gold.aviso_entrenamiento g USING (id_aviso)
WHERE g.apto_entrenamiento
  AND g.estado_publicacion = 'activo'
  AND p.etiqueta IS NOT NULL
  AND g.latitud IS NOT NULL AND g.longitud IS NOT NULL
  AND g.url LIKE 'https://%%'
  AND p.costo_total_publicado_clp <= %s
"""

SQL_MODELO = "SELECT cifras FROM gold.modelo_vigente ORDER BY publicado_en DESC LIMIT 1"


def num(x, dec=0):
    if x is None:
        return None
    x = round(float(x), dec)
    return int(x) if dec == 0 else x


def fila(r) -> dict:
    return {
        "id": r[0], "url": r[1], "t": sin_contacto(r[2]), "c": r[3], "b": r[4],
        "lat": num(r[5], DECIMALES_COORDENADAS), "lon": num(r[6], DECIMALES_COORDENADAS),
        "d": num(r[7]), "ba": num(r[8]), "su": num(r[9], 1), "st": num(r[10], 1), "e": num(r[11]),
        "am": bool(r[12]), "p": num(r[13]), "gc": num(r[14]),
        "pub": r[15].isoformat() if r[15] else None, "vis": r[16].isoformat() if r[16] else None,
        "ct": num(r[17]), "pr": num(r[18]), "bi": num(r[19]), "bs": num(r[20]),
        "et": r[21], "z": num(r[22], 2),
    }


def escribir(ruta: Path, doc: dict) -> None:
    ruta.parent.mkdir(parents=True, exist_ok=True)
    ruta.write_text(json.dumps(doc, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


def main() -> int:
    load_dotenv(RAIZ / ".env")
    cadena = os.environ.get("BD_STRING_VIS", "").strip()
    if not cadena.startswith("postgres"):
        print("Falta BD_STRING_VIS (o no empieza con postgresql://)")
        return 1
    carpeta = Path(sys.argv[1]) if len(sys.argv) > 1 else CARPETA
    try:
        con = psycopg2.connect(cadena, connect_timeout=15, sslmode="require")
        with con, con.cursor() as cur:
            cur.execute(SQL_AVISOS, (COSTO_TOTAL_MAX_CLP,))
            filas = [fila(r) for r in cur.fetchall()]
        modelo = None
        try:  # la tabla la crea la reconstrucción de Gold; si falta o no hay fila, el mapa sigue sin las cifras
            with con, con.cursor() as cur:
                cur.execute(SQL_MODELO)
                r = cur.fetchone()
                modelo = r[0] if r else None
        except psycopg2.Error as e:
            con.rollback()
            print(f"Sin cifras del modelo ({type(e).__name__})")
        con.close()
    except psycopg2.Error as e:
        print(f"No se pudo leer la base ({type(e).__name__})")  # el texto de la excepción puede traer la cadena
        return 1

    ahora = datetime.now(UTC).isoformat(timespec="seconds")
    escribir(carpeta / "avisos.json", {"generado": ahora, "avisos": filas})
    tam = (carpeta / "avisos.json").stat().st_size / 1e6
    print(f"{len(filas)} avisos -> {carpeta / 'avisos.json'} ({tam:.1f} MB)")
    if modelo:
        escribir(carpeta / "modelo.json", modelo)
        print(f"modelo v{modelo.get('version')} -> {carpeta / 'modelo.json'}")
    else:
        (carpeta / "modelo.json").unlink(missing_ok=True)
        print("Sin cifras del modelo: la pestaña 'Cómo funciona' mostrará un aviso")
    return 0


if __name__ == "__main__":
    sys.exit(main())
