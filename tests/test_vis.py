"""Pruebas del mapa sin base de datos ni navegador: el exportador y los contratos entre app.js, index.html y el scoring."""
import json
import re
import sys
from datetime import date, datetime
from pathlib import Path

import pytest

RAIZ = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RAIZ / "scripts"))
import exportar  # noqa: E402

APP = (RAIZ / "app.js").read_text(encoding="utf-8")
INDEX = (RAIZ / "index.html").read_text(encoding="utf-8")

# Orden de las columnas de SQL_AVISOS
FILA = ("MLC-1", "https://www.portalinmobiliario.com/MLC-1", "Depto", "Santiago", "Barrio", -33.4512345678, -70.6543219876,
        0, 1, 35.04, None, 0, False, 250000, 0, date(2026, 8, 1), datetime(2026, 10, 21, 12, 0),
        250000, 392000.4, 357669, 427148, "oportunidad", -1.2345)


def test_fila_redondea_coordenadas_y_mapea_los_campos():
    f = exportar.fila(FILA)
    assert f["id"] == "MLC-1" and f["et"] == "oportunidad"
    assert f["lat"] == -33.45123 and f["lon"] == -70.65432          # 5 decimales: ~1 m
    assert f["su"] == 35.0 and f["st"] is None and f["z"] == -1.23
    assert f["pr"] == 392000 and f["am"] is False
    assert f["pub"] == "2026-08-01" and f["vis"].startswith("2026-10-21")


def test_num_maneja_nulos_y_decimales():
    assert exportar.num(None) is None
    assert exportar.num(3.6) == 4 and exportar.num(3.14159, 2) == 3.14


def test_consulta_solo_avisos_activos_aptos_y_con_enlace_seguro():
    sql = exportar.SQL_AVISOS.lower()
    assert "apto_entrenamiento" in sql and "estado_publicacion = 'activo'" in sql
    assert "url like 'https://%%'" in sql and "etiqueta is not null" in sql
    assert "costo_total_publicado_clp <= %s" in sql


def test_la_consulta_no_trae_descripcion_ni_contacto():
    """Privacidad acordada: el mapa solo publica los campos básicos del aviso."""
    sql = exportar.SQL_AVISOS.lower()
    assert "descripcion" not in sql and "telefono" not in sql and "vendedor" not in sql


def test_el_tope_de_costo_coincide_con_el_del_entrenamiento():
    assert exportar.COSTO_TOTAL_MAX_CLP == 10_000_000


def test_etiquetas_coinciden_con_los_valores_del_scoring():
    """Si el scoring cambia estos textos, el mapa dejaría de pintar las insignias."""
    for valor in ("oportunidad", "precio_de_mercado", "caro"):
        assert valor in APP


def test_cada_id_que_usa_app_js_existe_en_index_html():
    ids = set(re.findall(r'\$\("([a-z0-9-]+)"\)', APP))
    faltan = [i for i in sorted(ids) if f'id="{i}"' not in INDEX]
    assert not faltan, f"app.js usa ids que index.html no tiene: {faltan}"


def test_cada_dato_de_la_pestana_explicacion_tiene_su_valor():
    bloque = APP.split("const valores = {", 1)[1].split("};", 1)[0]
    definidos = set(re.findall(r"\b([a-z_0-9]+):", bloque))
    usados = set(re.findall(r'data-m="([a-z_0-9]+)"', INDEX))
    assert not usados - definidos, f"index.html pide cifras que app.js no calcula: {usados - definidos}"


def test_sin_indexacion_bloqueada_ni_rastreadores_ajenos():
    assert "noindex" not in INDEX.lower()
    for host in re.findall(r'src="https?://([^/"]+)', INDEX):
        assert host in ("gc.zgo.at", "unpkg.com"), f"script externo no esperado: {host}"


@pytest.mark.skipif(not (RAIZ / "data" / "avisos.json").exists(), reason="lo genera el workflow, no está en el repo")
def test_avisos_json_tiene_la_forma_esperada():
    doc = json.loads((RAIZ / "data" / "avisos.json").read_text(encoding="utf-8"))
    assert doc["avisos"] and "generado" in doc
    claves = set(exportar.fila(FILA))
    for a in doc["avisos"][:200]:
        assert set(a) == claves and a["url"].startswith("https://")


def test_el_titulo_no_publica_telefonos_ni_correos():
    assert exportar.sin_contacto("Depto 2D llamar +56 9 8765 4321 o dueno@mail.cl") == \
        "Depto 2D llamar [contacto oculto] o [contacto oculto]"
    assert exportar.sin_contacto("Arriendo 987654321 Ñuñoa") == "Arriendo [contacto oculto] Ñuñoa"
    assert exportar.sin_contacto("Fono 22 345 6789") == "Fono [contacto oculto]"
    # Los cuatro casos reales del 22-oct
    assert exportar.sin_contacto("Oportunidad +569 63937095  Nov") == "Oportunidad [contacto oculto]  Nov"
    assert exportar.sin_contacto("Metro Ecuador +56963937095") == "Metro Ecuador [contacto oculto]"
    assert exportar.sin_contacto("Balmaceda 2170 N° 963937095") == "Balmaceda 2170 N° [contacto oculto]"
    # Números del aviso que no son teléfonos quedan igual
    assert exportar.sin_contacto("Depto 55 m2, piso 12, $450.000") == "Depto 55 m2, piso 12, $450.000"
    assert exportar.sin_contacto(None) is None
