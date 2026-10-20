"""Exporta a data/avisos.json lo que muestra el mapa: avisos activos con su predicción vigente.

Solo salen avisos activos y **aptos** (sin ningún motivo de exclusión en Gold). Solo salen los campos que usa la vista (ubicación, datos del aviso, precio, etiqueta y el enlace a la publicación; nunca la
descripción). Lee gold.predicciones_vigentes, gold.aviso_entrenamiento y la url de silver.avisos.

Variable de entorno: BD_STRING_VIS (cadena de conexión con permiso de lectura sobre esas tablas). Si existe un `.env` en la
raíz del repo, se carga.

Uso:
    python scripts/exportar.py [salida.json]
"""
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

import psycopg2
from dotenv import load_dotenv

RAIZ = Path(__file__).resolve().parents[1]
SALIDA = RAIZ / "data" / "avisos.json"

SQL = """
SELECT g.id_aviso, s.url, s.titulo, g.comuna, g.barrio,
       g.latitud, g.longitud, g.dormitorios, g.banos, g.superficie_util_m2, g.superficie_total_m2,
       g.estacionamientos, g.amoblado, g.precio_clp, g.gastos_comunes, g.fecha_publicacion_aprox, g.ultima_vez_visto,
       p.costo_total_publicado_clp, p.costo_total_predicho_clp, p.banda_inferior_clp, p.banda_superior_clp,
       p.etiqueta, p.nivel_confianza, p.z_robusto
FROM gold.predicciones_vigentes p
JOIN gold.aviso_entrenamiento g USING (id_aviso)
JOIN silver.avisos s USING (id_aviso)
WHERE g.apto_entrenamiento
  AND g.estado_publicacion = 'activo'
  AND p.etiqueta IS NOT NULL
  AND g.latitud IS NOT NULL AND g.longitud IS NOT NULL
  AND s.url LIKE 'https://%%'
  AND p.costo_total_publicado_clp <= %s
"""
COSTO_TOTAL_MAX_CLP = 10_000_000  # el mismo tope del entrenamiento (santiago-rentals-ml/config.yaml); sobre eso son errores de precio


def num(x, dec=0):
    if x is None:
        return None
    x = round(float(x), dec)
    return int(x) if dec == 0 else x


def fila(r) -> dict:
    return {
        "id": r[0], "url": r[1], "t": r[2], "c": r[3], "b": r[4],
        "lat": num(r[5], 5), "lon": num(r[6], 5),
        "d": num(r[7]), "ba": num(r[8]), "su": num(r[9], 1), "st": num(r[10], 1), "e": num(r[11]),
        "am": bool(r[12]), "p": num(r[13]), "gc": num(r[14]),
        "pub": r[15].isoformat() if r[15] else None, "vis": r[16].isoformat() if r[16] else None,
        "ct": num(r[17]), "pr": num(r[18]), "bi": num(r[19]), "bs": num(r[20]),
        "et": r[21], "cf": r[22], "z": num(r[23], 2),
    }


def main() -> int:
    load_dotenv(RAIZ / ".env")
    cadena = os.environ.get("BD_STRING_VIS", "").strip()
    if not cadena.startswith("postgres"):
        print("Falta BD_STRING_VIS (o no empieza con postgresql://)")
        return 1
    try:
        con = psycopg2.connect(cadena, connect_timeout=15, sslmode="require")
        with con, con.cursor() as cur:
            cur.execute(SQL, (COSTO_TOTAL_MAX_CLP,))
            filas = [fila(r) for r in cur.fetchall()]
        con.close()
    except psycopg2.Error as e:
        print(f"No se pudo leer la base ({type(e).__name__})")  # el texto de la excepción puede traer la cadena
        return 1

    destino = Path(sys.argv[1]) if len(sys.argv) > 1 else SALIDA
    destino.parent.mkdir(parents=True, exist_ok=True)
    doc = {"generado": datetime.now(timezone.utc).isoformat(timespec="seconds"), "avisos": filas}
    destino.write_text(json.dumps(doc, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"{len(filas)} avisos -> {destino} ({destino.stat().st_size / 1e6:.1f} MB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
