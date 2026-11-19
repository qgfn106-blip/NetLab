FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app

WORKDIR /app

COPY netlab/requirements.txt /app/netlab/requirements.txt
RUN pip install --no-cache-dir -r /app/netlab/requirements.txt \
    && pip install --no-cache-dir pytest httpx sympy jsonschema PyYAML

COPY . /app
# PlotKit 是必需插件；CI 在构建上下文预置 .plotkit-src，存在时安装。
RUN if [ -d /app/.plotkit-src ]; then pip install --no-cache-dir /app/.plotkit-src; fi
COPY netlab/tests/fixtures/projects /app/MyProject/

EXPOSE 8010
CMD ["python", "-m", "uvicorn", "netlab.server:app", "--host", "0.0.0.0", "--port", "8010"]
