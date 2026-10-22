"""Vigilante: revisa que el pipeline siga vivo y falla (rojo en GitHub, que manda correo) si algo se atrasó.

Corre en GitHub Actions cada hora (workflow `vigilante`), así que avisa aunque el notebook del ELT esté apagado.
Solo lee Gold con el mismo rol del mapa (BD_STRING_VIS).

Revisa:
  1. Gold fresco: Silver y Gold se reconstruyen cada hora desde el notebook. Si la última construcción tiene más de 3 horas,
     el orquestador está caído, el notebook apagado o la reconstrucción falla.
  2. Scoring al día: pocos avisos activos y aptos que se hayan visitado más de 3 horas después de su última predicción. El
     scoring corre cada 30 minutos, así que ese número debería ser casi cero. (No se mide "avisos sin predicción": el modelo
     deja fuera por diseño algunas comunas, el precio sospechoso y los costos sobre el tope.)
  3. Calidad de los datos: la fracción de avisos de Gold que quedó sin precio aunque se visitó su detalle (`sin_precio`).
     Normalmente es 0. El 21-oct subió al 16 % porque el portal sirvió páginas sin datos (bitácora P-25 del ELT) y nadie
     lo notó en 17 horas. Este aviso se revisa cada 6 horas (a las 0, 6, 12 y 18 UTC) para no mandar un correo por hora.

Para no mandar un correo por hora mientras dure un problema, solo falla cuando el atraso cruza 3, 12 y 24 horas, y luego
cada día completo (ver `debe_avisar`).

Uso:
    python scripts/vigilar.py
"""
import os
import sys
from datetime import UTC, datetime
from pathlib import Path

import psycopg2
from dotenv import load_dotenv

RAIZ = Path(__file__).resolve().parents[1]
UMBRAL_GOLD_HORAS = 3
UMBRAL_PREDICCION_ATRASADA = 0.05   # fracción de avisos con predicción visitados después de ella (normalmente ~0)
HORAS_PREDICCION_ATRASADA = 3
UMBRAL_SIN_PRECIO = 0.05   # fracción de avisos con motivo sin_precio (normalmente 0)
HORAS_REVISION_CALIDAD = (0, 6, 12, 18)   # UTC

SQL_GOLD = "SELECT max(construido_en) FROM gold.aviso_entrenamiento"
SQL_CALIDAD = """
SELECT count(*) FILTER (WHERE motivo_exclusion LIKE '%sin_precio%'), count(*)
FROM gold.aviso_entrenamiento
"""
SQL_SCORING = """
SELECT count(*) FILTER (WHERE g.ultima_vez_visto > p.predicho_en + make_interval(hours => %s)), count(*)
FROM gold.aviso_entrenamiento g
JOIN gold.predicciones_vigentes p USING (id_aviso)
WHERE g.apto_entrenamiento AND g.estado_publicacion = 'activo'
"""


def horas_desde(momento: datetime, ahora: datetime | None = None) -> float:
    ahora = ahora or datetime.now(UTC)
    return (ahora - momento).total_seconds() / 3600


def debe_avisar(horas: float) -> bool:
    """True solo en la hora en que el atraso cruza 3, 12 o 24 horas, y luego en cada múltiplo de 24 (la revisión es cada hora)."""
    if horas < UMBRAL_GOLD_HORAS:
        return False
    h = int(horas)
    return h in (UMBRAL_GOLD_HORAS, 12) or (h >= 24 and h % 24 == 0)


def revisar_calidad(sin_precio: int, total: int, ahora: datetime | None = None) -> str | None:
    """Texto de la alerta si la fracción sin precio pasa el umbral y es hora de revisarla; si no, None."""
    ahora = ahora or datetime.now(UTC)
    fraccion = sin_precio / total if total else 0
    if fraccion > UMBRAL_SIN_PRECIO and ahora.hour in HORAS_REVISION_CALIDAD:
        return (f"{fraccion:.0%} de los avisos de Gold quedó sin precio aunque se visitó su detalle ({sin_precio} de {total}): "
                "revisar que el scraper reciba páginas completas")
    return None


def main() -> int:
    load_dotenv(RAIZ / ".env")
    cadena = os.environ.get("BD_STRING_VIS", "").strip()
    if not cadena.startswith("postgres"):
        print("Falta BD_STRING_VIS (o no empieza con postgresql://)")
        return 1
    try:
        with psycopg2.connect(cadena, connect_timeout=15, sslmode="require") as con, con.cursor() as cur:
            cur.execute(SQL_GOLD)
            construido = cur.fetchone()[0]
            cur.execute(SQL_SCORING, (HORAS_PREDICCION_ATRASADA,))
            atrasadas, total = cur.fetchone()
            cur.execute(SQL_CALIDAD)
            sin_precio, total_gold = cur.fetchone()
    except psycopg2.Error as e:
        print(f"No se pudo leer la base ({type(e).__name__})")  # el texto de la excepción puede traer la cadena
        return 1

    problemas = []
    if construido is None:
        problemas.append("Gold no tiene ninguna construcción registrada")
    else:
        horas = horas_desde(construido)
        print(f"Gold construido hace {horas:.1f} h")
        if horas >= UMBRAL_GOLD_HORAS and debe_avisar(horas):
            problemas.append(
                f"Gold no se reconstruye hace {horas:.0f} h: revisar el orquestador (notebook apagado, caído o con error)")
    fraccion = atrasadas / total if total else 0
    print(f"{atrasadas} de {total} avisos con predicción se visitaron más de {HORAS_PREDICCION_ATRASADA} h después de ella "
          f"({fraccion:.1%})")
    if fraccion > UMBRAL_PREDICCION_ATRASADA:
        problemas.append(
            f"{fraccion:.0%} de las predicciones está atrasada respecto de las visitas: revisar el workflow scoring del repo ML")

    print(f"{sin_precio} de {total_gold} avisos de Gold sin precio ({sin_precio / total_gold if total_gold else 0:.1%})")
    alerta = revisar_calidad(sin_precio, total_gold)
    if alerta:
        problemas.append(alerta)

    for p in problemas:
        print("ALERTA:", p)
    return 1 if problemas else 0


if __name__ == "__main__":
    sys.exit(main())
