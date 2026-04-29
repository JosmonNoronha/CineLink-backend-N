# Monitoring (Prometheus + Grafana)

Quick steps to run Prometheus and Grafana locally to monitor the CineLink backend metrics exposed at `/api/metrics`.

1. Start services (from `CineLink-backend-N`):

```powershell
docker compose -f docker-compose.monitoring.yml up -d
```

2. Open UIs:

- Prometheus: http://localhost:9090
- Grafana: http://localhost:3001 (login `admin` / `admin` or the password in the compose file)

3. Grafana data source:

- Add a Prometheus data source pointing to `http://prometheus:9090` (if using compose) or `http://localhost:9090`.

4. Useful queries:

- Request rate: `sum(rate(http_requests_total{job="cinelink-backend"}[5m]))`
- 95th latency: `histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket{job="cinelink-backend"}[5m])) by (le))`
- Cache hit ratio: `(sum(rate(cache_hits_total{job="cinelink-backend"}[5m]))) / (sum(rate(cache_hits_total{job="cinelink-backend"}[5m])) + sum(rate(cache_misses_total{job="cinelink-backend"}[5m])))`

5. If Prometheus shows the target as `DOWN`:

- Ensure backend is reachable at the address in `prometheus.yml` (try `curl http://localhost:5001/api/metrics`).
- If Prometheus runs in Docker and backend runs on host, use `host.docker.internal:5001` in `prometheus.yml` (already present).
