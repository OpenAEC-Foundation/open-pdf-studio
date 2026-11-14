FROM python:3.12-slim-bookworm
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 \
    OPDS_DATABASE=/data/review.db OPDS_HOST=0.0.0.0 OPDS_PORT=8080
WORKDIR /app
COPY requirements.txt ./
RUN python -m pip install --no-cache-dir -r requirements.txt \
    && groupadd --gid 10001 review \
    && useradd --uid 10001 --gid review --no-create-home review \
    && mkdir /data && chown review:review /data
COPY opds_collaboration ./opds_collaboration
USER 10001:10001
VOLUME ["/data"]
EXPOSE 8080
ENTRYPOINT ["python", "-m", "opds_collaboration"]
CMD ["serve"]
