"""Exporta a data/modelo.json las cifras del modelo @champion que explica la pestaña "Cómo funciona".

Lee de MLflow (versión y run del champion): métricas, tamaños de los conjuntos, baselines, importancia de variables,
la referencia del etiquetado (deciles de costo y cortes de confianza) y la distribución de etiquetas en el test.

Variables de entorno (las de MLflow en la nube, las mismas del repo del modelo): MLFLOW_TRACKING_URI, MLFLOW_ARTIFACT_ROOT,
MLFLOW_S3_ENDPOINT_URL, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY y AWS_DEFAULT_REGION. Si existe `.env.nube` en la raíz de
este repo o en el repo hermano `santiago-rentals-ml`, se carga.

Uso:
    python scripts/exportar_modelo.py [salida.json]
"""
import json
import os
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

from dotenv import dotenv_values

RAIZ = Path(__file__).resolve().parents[1]
SALIDA = RAIZ / "data" / "modelo.json"
MODELO_REGISTRADO = "santiago_rentals_precio"  # se confirma abajo con config.yaml del repo del modelo si está al lado


def cargar_entorno() -> None:
    for ruta in (RAIZ / ".env.nube", RAIZ.parent / "santiago-rentals-ml" / ".env.nube"):
        if ruta.exists():
            for k, v in dotenv_values(ruta).items():
                if v:
                    os.environ.setdefault(k, v.strip())
            return


def nombre_modelo() -> str:
    cfg = RAIZ.parent / "santiago-rentals-ml" / "config.yaml"
    if cfg.exists():
        import yaml
        return yaml.safe_load(cfg.read_text(encoding="utf-8"))["mlflow"]["modelo_registrado"]
    return os.environ.get("MODELO_REGISTRADO", MODELO_REGISTRADO)


def main() -> int:
    os.environ.setdefault("MLFLOW_DISABLE_AGENT_HINT", "1")
    cargar_entorno()
    if not os.environ.get("MLFLOW_TRACKING_URI"):
        print("Falta MLFLOW_TRACKING_URI")
        return 1
    import mlflow
    from mlflow import MlflowClient

    mlflow.set_tracking_uri(os.environ["MLFLOW_TRACKING_URI"])
    cliente = MlflowClient()
    try:
        mv = cliente.get_model_version_by_alias(nombre_modelo(), "champion")
        run = cliente.get_run(mv.run_id)
        with tempfile.TemporaryDirectory() as tmp:
            def artefacto(nombre):
                return json.loads(Path(cliente.download_artifacts(mv.run_id, nombre, tmp)).read_text(encoding="utf-8"))
            shap, ref = artefacto("shap_importancia.json"), artefacto("referencia_etiquetas.json")
            etiquetas, variables = artefacto("etiquetas_test.json"), artefacto("variables.json")["variables"]
    except Exception as e:  # el texto de la excepción puede traer credenciales o hosts
        print(f"No se pudo leer MLflow ({type(e).__name__})")
        return 1

    m, p = run.data.metrics, run.data.params
    total = sum(shap.values())
    top = sorted(shap.items(), key=lambda kv: -kv[1])[:10]
    doc = {
        "generado": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "version": int(mv.version),
        "algoritmo": p.get("algoritmo"),
        "n_modelos": int(p.get("n_modelos_bagging", 0)),
        "n_variables": len(variables),
        "n_train": int(p["n_train"]), "n_val": int(p["n_val"]), "n_test": int(p["n_test"]),
        "ventana_dias": int(p["ventana_dias"]) if p.get("ventana_dias") else None,
        "metricas": {"mae": m["test_mae"], "mape": m["test_mape"], "mdape": m.get("test_mdape"), "r2": m["test_r2"],
                     "dentro_10": m.get("test_pct_dentro_10"), "mae_quintil_caro": m.get("test_mae_quintil_caro")},
        "baselines": {k: v for k, v in m.items() if k.startswith("baseline_") and k.endswith("_mae")},
        "importancia": [{"variable": k, "pct": round(100 * v / total, 1)} for k, v in top],
        "cortes_costo": ref["cortes_costo"],
        "cortes_cv": ref.get("cortes_cv"),
        "etiquetas_test": etiquetas,
    }
    destino = Path(sys.argv[1]) if len(sys.argv) > 1 else SALIDA
    destino.parent.mkdir(parents=True, exist_ok=True)
    destino.write_text(json.dumps(doc, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"champion v{doc['version']} ({doc['algoritmo']}) -> {destino}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
