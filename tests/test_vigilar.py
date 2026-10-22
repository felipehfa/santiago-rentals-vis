"""Reglas del vigilante: cuándo avisar sin mandar un correo por hora."""
import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import vigilar  # noqa: E402


def test_no_avisa_con_gold_fresco():
    for h in (0.2, 1.5, 2.9):
        assert not vigilar.debe_avisar(h)


def test_avisa_al_cruzar_3_12_y_24_horas_y_luego_cada_dia():
    avisa = [h for h in range(0, 100) if vigilar.debe_avisar(h + 0.5)]
    assert avisa == [3, 12, 24, 48, 72, 96]


def test_no_repite_el_aviso_durante_la_misma_hora():
    assert vigilar.debe_avisar(3.0) and vigilar.debe_avisar(3.9)
    assert not vigilar.debe_avisar(4.0)


def test_horas_desde():
    ahora = datetime(2026, 10, 21, 12, 0, tzinfo=UTC)
    assert vigilar.horas_desde(ahora - timedelta(hours=5, minutes=30), ahora) == 5.5


def test_calidad_avisa_solo_sobre_el_umbral_y_cada_6_horas():
    a_las = lambda h: datetime(2026, 10, 22, h, 50, tzinfo=UTC)  # noqa: E731
    assert vigilar.revisar_calidad(0, 17000, a_las(12)) is None              # normal: sin avisos sin precio
    assert vigilar.revisar_calidad(500, 17000, a_las(12)) is None            # 2,9 %: bajo el umbral
    assert "sin precio" in vigilar.revisar_calidad(2900, 17000, a_las(12))   # 17 %: el caso del 21-oct
    assert vigilar.revisar_calidad(2900, 17000, a_las(13)) is None           # fuera de las horas de revisión
