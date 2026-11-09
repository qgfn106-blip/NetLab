FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app

WORKDIR /app

COPY netlab/requirements.txt /app/netlab/requirements.txt
RUN pip install --no-cache-dir -r /app/netlab/requirements.txt \
    && pip install --no-cache-dir pytest httpx sympy jsonschema PyYAML

COPY . /app

EXPOSE 8010
CMD ["python", "-m", "uvicorn", "netlab.server:app", "--host", "0.0.0.0", "--port", "8010"]
