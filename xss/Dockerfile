# FROM python:3.9-slim 

# ENV PYTHONDONTWRITEBYTECODE=1
# ENV PYTHONUNBUFFERED=1

# WORKDIR /app

# RUN apt-get update && apt-get install -y gcc software-properties-common && rm -rf /var/lib/apt/lists/*

# COPY requirements.txt .
# RUN add-apt-repository ppa:vbernat/haproxy-1.8
# RUN pip install --no-cache-dir -r requirements.txt

# COPY . .

# COPY docker-entrypoint.sh /docker-entrypoint.sh
# RUN chmod +x /docker-entrypoint.sh

# EXPOSE 8000

# ENTRYPOINT ["/docker-entrypoint.sh"]
FROM python:3.9-slim
 
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
 
WORKDIR /app
 
# gcc para compilar deps de Python que lo necesiten
# haproxy desde los repos oficiales de Debian (versión 1.8.x disponible en buster/bullseye)
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        gcc \
        haproxy \
    && rm -rf /var/lib/apt/lists/*
 
COPY ./xss/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
 
COPY ./xss .
 
COPY ./xss/docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh
 
EXPOSE 8000
 
ENTRYPOINT ["/docker-entrypoint.sh"]
