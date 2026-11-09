FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app

WORKDIR /app

COPY netlab/requirements.txt /app/netlab/requirements.txt
RUN pip install --no-cache-dir -r /app/netlab/requirements.txt

COPY . /app

EXPOSE 8010
CMD ["python", "-m", "netlab.server"]
