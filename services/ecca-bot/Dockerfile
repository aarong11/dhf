FROM python:3.12-slim

WORKDIR /app

# Install build deps for chromadb
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY bot.py .

# Docs will be mounted at /app/docs
VOLUME /app/docs
VOLUME /app/chroma_db

CMD ["python", "bot.py"]
