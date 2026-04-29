# Monitoring setup — Prometheus + Grafana

This document explains how to complete the monitoring setup after creating `prometheus.yml` and `docker-compose.monitoring.yml` (files are in the repository root and `monitoring/`). It assumes the backend is running on the host at port `5001` and exposes metrics at `/api/metrics`.

Prerequisites

- Docker Desktop installed and running (WSL2 backend on Windows recommended).
- `docker` and `docker compose` available in your shell.
- Backend service running locally on port `5001` (see `src/config/environment.js` for `PORT` default).

1. Start Prometheus + Grafana

From the repo root (`CineLink-backend-N`) run:

```powershell
# Fetch images and start services in detached mode
docker compose -f docker-compose.monitoring.yml pull
docker compose -f docker-compose.monitoring.yml up -d
```

Notes:

- If image pulls fail due to network/proxy/TLS issues, try pulling images manually with `docker pull` to inspect errors:

```powershell
docker pull prom/prometheus:latest
docker pull grafana/grafana:latest
```

- If Prometheus runs in Docker and your backend runs on the host (Windows/macOS), `prometheus.yml` already includes `host.docker.internal:5001` as a target. If you use a different host or container network, update `prometheus.yml` accordingly.

2. Verify containers are running

```powershell
docker compose -f docker-compose.monitoring.yml ps
docker compose -f docker-compose.monitoring.yml logs -f prometheus
docker compose -f docker-compose.monitoring.yml logs -f grafana
```

3. Confirm backend metrics endpoint

From the host machine:

```powershell
curl http://localhost:5001/api/metrics
```

Expected: a plain-text response with Prometheus metric families (lines starting with `# HELP` and `# TYPE`). If you get an error, start the backend and verify `PORT` and `API_PREFIX` configuration in `src/config/environment.js`.

4. Confirm Prometheus is scraping the backend

- Open Prometheus UI: `http://localhost:9090` → Status → Targets. Confirm `cinelink-backend` job shows `UP` and the target URL matches your backend address.
- If target shows `DOWN`:
  - Ensure the target address in `prometheus.yml` is reachable from Prometheus container (use `host.docker.internal:5001` for host → container on Windows).
  - Check Docker Desktop proxy/no-proxy settings: add `host.docker.internal,localhost,127.0.0.1` to `No Proxy` if behind a corporate proxy.

5. Add Prometheus data source in Grafana

- Open Grafana: `http://localhost:3001`
- Login (default `admin` / `admin` unless changed in `docker-compose.monitoring.yml`).
- Configuration → Data Sources → Add data source → Prometheus.
- URL: `http://prometheus:9090` (when Grafana runs in the same compose stack). Alternatively use `http://localhost:9090`.

6. Create panels / dashboard (example queries)

- Request rate (per-second):

```
sum(rate(http_requests_total{job="cinelink-backend"}[5m]))
```

- 95th percentile latency:

```
histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket{job="cinelink-backend"}[5m])) by (le))
```

- Cache hit ratio:

```
(sum(rate(cache_hits_total{job="cinelink-backend"}[5m]))) / (sum(rate(cache_hits_total{job="cinelink-backend"}[5m])) + sum(rate(cache_misses_total{job="cinelink-backend"}[5m])))
```

- Requests by status code:

```
sum(rate(http_requests_total{job="cinelink-backend"}[5m])) by (status)
```

7. Troubleshooting common issues

- Image pull failures:
  - Check `docker pull <image>` to see detailed error. If you see HTTP→HTTPS errors or 401/403, your environment may require proxy or authenticated registry access.
  - Add `host.docker.internal,localhost,127.0.0.1` to Docker Desktop's **Resources → Proxies → No Proxy** and restart Docker if you're behind a proxy.

- Prometheus shows `DOWN`:
  - Verify `curl http://<target-host>:<port>/api/metrics` from the machine where Prometheus runs. From inside the Prometheus container you can run:
    ```powershell
    docker compose -f docker-compose.monitoring.yml exec prometheus /bin/sh -c "apk add --no-cache curl >/dev/null 2>&1 || true; curl -fsS --max-time 5 http://host.docker.internal:5001/api/metrics || true"
    ```

- Grafana can't connect to Prometheus:
  - Use `http://prometheus:9090` as the URL if Grafana runs in the same Docker Compose network. If Grafana on host, use `http://localhost:9090`.

8. Stopping and cleaning up

```powershell
docker compose -f docker-compose.monitoring.yml down
docker compose -f docker-compose.monitoring.yml rm -f
```

9. Optional next steps

- Add an importable Grafana dashboard JSON to `monitoring/` (I can generate one for the key metrics).
- Secure metrics endpoint (basic auth or network ACL) in production — `/api/metrics` currently is public on the API host.
- Add Prometheus alerting rules and Alertmanager configuration for SLO/alerts.

If you want, I will:

- add a ready-to-import Grafana dashboard JSON to `monitoring/`, or
- add a small verification script that checks Prometheus targets and a couple of metric series and returns pass/fail.

--

10. Deployment notes — Render (production)

This repository's `prom-client` metrics endpoint (`/api/metrics`) is designed for scraping by Prometheus. When you deploy the backend to Render (or any managed host), you will need to adapt how Prometheus scrapes the service and harden the metrics endpoint. Below are recommended options, configuration snippets, and security considerations.

- Make metrics reachable to your Prometheus instance
  - Public scrape: If you run Prometheus externally (self-hosted or hosted) and want it to scrape your Render service, ensure the public URL is reachable and use the fully-qualified domain in `prometheus.yml`.
    Example `prometheus.yml` entry (HTTPS):

    ```yaml
    scrape_configs:
      - job_name: 'cinelink-backend'
        scheme: https
        metrics_path: '/api/metrics'
        static_configs:
          - targets: ['your-service-name.onrender.com']
        scrape_interval: 15s
        scrape_timeout: 10s
    ```

  - Private scrape: If you cannot expose `/api/metrics` publicly, run Prometheus in the same private network/VPC as your Render service (or use Render private services) so scraping does not traverse the public internet.

- Secure the metrics endpoint
  - Don't leave `/api/metrics` open in production without controls. Options:
    - Restrict access at the network/firewall level to only the Prometheus IP(s).
    - Require a bearer token or basic auth for the endpoint and configure Prometheus to send credentials (see `bearer_token`/`basic_auth` below).
    - Only allow metrics from internal/private subnets (use Render private services if available).

  - Example: require a bearer token and configure Prometheus to send it
    1. Set an environment variable in Render (e.g., `METRICS_BEARER_TOKEN=long-secret`).
    2. In your application, require that requests to `/api/metrics` include `Authorization: Bearer <token>` (you can add a small middleware that checks `process.env.METRICS_BEARER_TOKEN`).
    3. Update `prometheus.yml` to use the token (either via `bearer_token` file or `bearer_token` literal):
    ```yaml
    scrape_configs:
      - job_name: 'cinelink-backend'
        scheme: https
        metrics_path: '/api/metrics'
        static_configs:
          - targets: ['your-service-name.onrender.com']
        bearer_token: 'REPLACE_WITH_TOKEN' # or use bearer_token_file: /etc/prom/bearer
    ```

- TLS and host verification
  - Use `scheme: https` in `scrape_configs` for Render's HTTPS endpoints. If you must skip certificate verification (not recommended), configure `tls_config: { insecure_skip_verify: true }` for that target.

- When you deploy multiple replicas
  - Use a single scrape target that resolves to a load balancer (e.g., `your-service-name.onrender.com`). Prometheus will scrape the load balancer and observe metrics aggregated across instances if the endpoint exposes per-instance labels (like `instance` or `pod`). If you need per-instance metrics add identifying labels in your instrumentation.

- Alternative: Push metrics to hosted/managed collectors
  - If you cannot open `/api/metrics` for scraping, consider sending metrics to a hosted service (Grafana Cloud, MetricFire, VictoriaMetrics) via remote_write, or use a Pushgateway for ephemeral jobs. `prom-client` does not implement `remote_write` by itself; you'd typically run a bridge (e.g., Prometheus remote_write exporters) or use an agent.

- Alerts and production dashboards
  - Add alerting rules (Prometheus `rules:`) for key SLOs (high P95 latency, error rate, cache hit rate below threshold). Configure Alertmanager and a notification channel (email, Slack, PagerDuty).

Deployment checklist (summary)

- Ensure `/api/metrics` is reachable from your Prometheus (public target or private network).
- Protect the endpoint (bearer token / firewall / private services).
- Update `prometheus.yml` scrape target(s) to `your-service-name.onrender.com` and add `scheme: https`.
- If using bearer token, store it in Render environment variables and configure Prometheus to use it.
- Import the Grafana dashboard JSON into your production Grafana instance and adapt datasource to the production Prometheus.

If you'd like, I can:

- add a small middleware example that enforces `METRICS_BEARER_TOKEN`, and
- append example `prometheus.yml` and `alerting` rule files for a production setup.

--

## Path A — Grafana Cloud (Recommended for Render)

This is the recommended approach for monitoring your backend deployed on Render. Grafana Cloud offers a free tier and requires zero infrastructure — metrics are pushed from your Node app to hosted collectors.

### Step 1 — Sign up for Grafana Cloud

- Go to https://grafana.com → **Start for free** → create an account.
- You get a free stack with Prometheus remote write and hosted Grafana dashboards.

### Step 2 — Get Prometheus remote write credentials

- In Grafana Cloud, navigate: **Home → Connections → Add new connection → Prometheus**.
- Copy these three credentials:
  - **Remote Write URL**: looks like `https://prometheus-prod-XX.grafana.net/api/prom/push`
  - **Username**: a numeric ID (e.g., `12345`)
  - **API Key**: generate one in your Grafana Cloud account

### Step 3 — Deploy to Render

Your app has been updated to support pushing metrics to Grafana Cloud. No new dependencies to install — `prom-client` is already included.

In your Render service → **Environment** tab, add:

```
GRAFANA_REMOTE_WRITE_URL=https://prometheus-prod-XX.grafana.net/api/prom/push
GRAFANA_USERNAME=12345
GRAFANA_API_KEY=your_api_key_here
GRAFANA_PUSH_INTERVAL_MS=15000
METRICS_SECRET=your_random_secret_string_here
NODE_ENV=production
```

**Note on METRICS_SECRET:**

- In production, the `/api/metrics` endpoint is secured with a token check. If `METRICS_SECRET` is not set, the endpoint remains open (logs a warning).
- Set this to a strong random value (e.g., `$(openssl rand -hex 32)` or a secure password generator).
- Only Grafana Cloud (via bearer token in env vars) will access this endpoint; you don't need to manually pass the token.

### Step 4 — How it works

- Every `GRAFANA_PUSH_INTERVAL_MS` milliseconds (default 15 seconds), your app pushes collected metrics to Grafana Cloud via the remote write endpoint.
- The `/api/metrics` endpoint still exists locally for dev/debugging but is secured in production.
- Metrics arrive in Grafana Cloud within seconds; dashboards auto-populate from these metrics.
- No separate Prometheus instance needed.

### Step 5 — Create dashboards in Grafana Cloud

- In your Grafana Cloud portal, go to **Dashboards → Import**.
- Use dashboard ID **11159** (Node.js app) or **14171** (Express server) from grafana.com/dashboards.
- Select your auto-created Prometheus data source.
- Your metrics will appear within 1-2 minutes of deploying.

Alternatively, import the JSON dashboard from `monitoring/grafana_cinelink_dashboard.json` if you prefer custom queries tailored to CineLink's metrics.

### Step 6 — Verify metrics are flowing

- In Grafana Cloud → **Explore**, select your Prometheus data source.
- Query one of your metrics (e.g., `http_requests_total{job="cinelink-backend"}`).
- You should see data points appearing.

If no data:

- Check app logs on Render for any errors during push (search for `[metrics] Push to Grafana`).
- Confirm `GRAFANA_REMOTE_WRITE_URL`, `GRAFANA_USERNAME`, and `GRAFANA_API_KEY` are correct.
- Ensure your app is handling traffic so metrics are being recorded.

### Step 7 — Secure the metrics endpoint (optional but recommended)

In production, only allow requests with the `METRICS_SECRET`:

```bash
curl -H "X-Metrics-Token: your_random_secret_string_here" https://your-render-service.onrender.com/api/metrics
```

This is already enforced in the code if `METRICS_SECRET` is set and `NODE_ENV=production`.

### Comparison with local Prometheus setup

| Feature        | Local Docker Compose   | Grafana Cloud                |
| -------------- | ---------------------- | ---------------------------- |
| Infrastructure | Docker on your machine | Hosted (managed)             |
| Costs          | Free (local)           | Free tier with limits        |
| Scalability    | Single instance        | Scales automatically         |
| Alerts         | Manual config          | Built-in alerting            |
| Data retention | Limited by disk        | 15 days (free) / longer paid |
| Access         | localhost:9090         | Web dashboard (secure)       |
| Setup time     | ~5 min (docker)        | ~10 min (sign-up + config)   |
