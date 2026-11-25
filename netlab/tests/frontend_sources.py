"""Shared readers for frontend static contract tests after the app.ts split."""

from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def read_frontend_ts() -> str:
    files = [ROOT / "frontend" / "app.ts", *sorted((ROOT / "frontend" / "app").glob("*.ts"))]
    return "\n".join(p.read_text(encoding="utf-8") for p in files if not p.name.endswith(".d.ts"))


def read_frontend_js() -> str:
    files = [ROOT / "frontend" / "app.js", *sorted((ROOT / "frontend" / "app").glob("*.js"))]
    return "\n".join(p.read_text(encoding="utf-8") for p in files if not p.name.endswith(".min.js"))
