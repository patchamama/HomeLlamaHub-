# HomeLlamaHub

> Plataforma autohospedada para exponer **Ollama** corriendo en un **Mac mini M1** a Internet de forma segura, con panel de administración, gestión de tokens, cola de consultas, Wake-on-LAN (WOL), enrutado por path sin puertos visibles y soporte multi-máquina (worker remoto en un MacBook M1 Max).

---

## 1. Objetivo del proyecto

Construir un servicio de inferencia LLM **personal y compartible**:

- Hardware principal: **Mac mini M1 / 16 GB RAM** (cableado por Ethernet a un **FRITZ!Box 6660 Cable**).
- Hardware secundario opcional: **MacBook Pro M1 Max / 64 GB RAM** (worker remoto en la LAN, accesible vía WOL).
- Acceso a modelos **pequeños y medianos** (1.5B–14B en M1, hasta ~70B Q4 en M1 Max) desde:
  - **LAN** (cualquier dispositivo de la red local).
  - **Internet** (mediante DynDNS + reverse proxy con HTTPS y autenticación por token).
- Panel web de administración con:
  - Registro/login (registro **desactivado por defecto**, solo el admin lo habilita).
  - Gestión de **tokens de API** por usuario.
  - **Consola de pruebas** integrada (basada en `ai-console.html`).
  - **WOL** desde dentro y desde fuera de la red.
  - Configuración de **workers remotos** (otros Macs en la LAN).
  - **Estadísticas** de uso, modelos disponibles por host y estado de cada nodo.
- **Cola de consultas** con concurrencia configurable (por defecto: 1 simultánea) y **timeout configurable** (por defecto: 5 min).
- **URLs sin puerto visible** desde el exterior: `https://midominio.dyndns.org/ollama/...` se traduce internamente al puerto correspondiente.
- Reaprovecha código del repo base: [`patchamama/LocalForge_Ollama-Local-SSL`](https://github.com/patchamama/LocalForge_Ollama-Local-SSL) — en particular `wol-proxy.py` y `ai-console.html`.

> ⚠ **Premisa crítica**: el Mac mini queda **expuesto a Internet**. La seguridad es el eje del diseño — sin excepciones.

---

## 2. Arquitectura general

```
                      Internet
                         │
                         ▼
                ┌─────────────────┐
                │  DynDNS (FQDN)  │   midominio.dyndns.org
                └────────┬────────┘
                         │  (443/TCP)
                         ▼
              ┌──────────────────────┐
              │  FRITZ!Box 6660      │
              │  Port forward 443    │──── 7 (UDP) WOL desde Internet
              │  → 192.168.178.X:443 │
              └──────────┬───────────┘
                         │ LAN cable (Ethernet)
                         ▼
   ┌──────────────────────────────────────────────────┐
   │  Mac mini M1  (192.168.178.X)                    │
   │ ┌──────────────────────────────────────────────┐ │
   │ │ Caddy (reverse proxy, TLS, path routing)     │ │  :443
   │ │   /api/admin/  → FastAPI                     │ │
   │ │   /api/auth/   → FastAPI                     │ │
   │ │   /ollama/*    → FastAPI gateway → Ollama    │ │
   │ │   /panel/      → React SPA                   │ │
   │ │   /wol/        → wol-proxy.py                │ │
   │ └──────────┬───────────────────────────────────┘ │
   │            │                                     │
   │ ┌──────────▼───────────┐  ┌──────────────────┐   │
   │ │ FastAPI backend      │  │ Ollama 127.0.0.1 │   │
   │ │ - auth JWT           │──▶  :11434          │   │
   │ │ - cola + semaforo    │  └──────────────────┘   │
   │ │ - tokens             │                         │
   │ │ - timeout            │  ┌──────────────────┐   │
   │ │ - audit log          │  │ wol-proxy.py     │   │
   │ │ - router multi-host  │──▶  :8765           │   │
   │ └──────────┬───────────┘  └──────────────────┘   │
   │            │                                     │
   │ ┌──────────▼───────────┐                         │
   │ │ SQLite / Postgres    │  usuarios, tokens,      │
   │ │                      │  jobs, audit            │
   │ └──────────────────────┘                         │
   └──────────────┬───────────────────────────────────┘
                  │ LAN (mTLS + WOL)
                  ▼
        ┌──────────────────────┐
        │ MacBook M1 Max (64GB)│   worker remoto
        │ Ollama :11434        │   (despierta por WOL)
        └──────────────────────┘
```

### Componentes clave

| Capa            | Tecnología                                  | Función                                                              |
| --------------- | ------------------------------------------- | -------------------------------------------------------------------- |
| DNS dinámico    | MyFRITZ! o `ddclient` con DuckDNS / No-IP   | FQDN estable apuntando a la IP pública del router                    |
| Edge / TLS      | **Caddy 2**                                 | HTTPS automático (Let's Encrypt), path routing, headers, rate limit  |
| Gateway / API   | **FastAPI** (Python 3.12)                   | Auth, cola, timeouts, audit, multi-host routing                      |
| Inferencia      | **Ollama** (nativo en macOS, Metal)         | Inferencia LLM                                                       |
| WOL             | `wol-proxy.py` adaptado del repo base       | Magic packet directo + FRITZ!Box TR-064                              |
| Frontend admin  | **React + Vite** + Tailwind (+ AI Console)  | Panel admin, login, tokens, consola, estadísticas                    |
| Base de datos   | **SQLite** (fase 1) → opcional Postgres     | Usuarios, tokens, jobs, audit                                        |
| Observabilidad  | Loki + Promtail + Grafana (Docker)          | Logs centralizados, dashboards, alertas                              |
| Seguridad red   | `pf` (macOS) + Fail2ban-equivalente custom  | Firewall, bloqueo de IPs maliciosas                                  |
| Monitoreo seg.  | `osquery` + audit logs propios              | Detección de anomalías                                               |

---

## 3. Restricciones y decisiones de diseño

1. **WOL en Apple Silicon solo desde *sleep*, no desde *shutdown***. Documentado por Apple y validado por la comunidad: los Mac M1+ no soportan wake desde apagado total. ⇒ El Mac mini **nunca se apaga**, solo se duerme (`pmset womp 1`).
2. **Ollama no tiene autenticación nativa**. ⇒ Toda autenticación se delega a Caddy + FastAPI. Ollama escucha **únicamente en `127.0.0.1:11434`**.
3. **Una consulta por defecto** (configurable). El M1 con 16 GB no soporta paralelismo serio en modelos medianos sin swap agresivo. Las consultas extra entran en cola FIFO.
4. **Timeout configurable** (por defecto 300 s). Si una consulta excede el límite, se cancela el stream y se libera el slot.
5. **URLs sin puertos visibles** desde Internet — solo `443/TCP` abierto en el FRITZ!Box. Todo el ruteo interno lo hace Caddy por path.
6. **Worker remoto opcional**: el Mac mini actúa como **puente/proxy** hacia el M1 Max (y futuros nodos). El usuario externo nunca conecta directo al worker.
7. **Registro desactivado por defecto**. Solo el admin habilita registro o crea cuentas/tokens manualmente.
8. **Idioma del proyecto**: documentación en castellano; código, identificadores, comentarios y strings de UI en inglés (estándar de mantenibilidad).

---

## 4. Roadmap por fases

Cada fase es **autocontenida**, deja un estado funcional verificable, y no rompe lo anterior. Las fases se entregan en este orden estricto.

### Fase 0 — Preparación e inventario (½ día)

**Objetivo**: dejar el hardware y la red listos antes de tocar código.

- [ ] Asignar **IP fija** al Mac mini en el FRITZ!Box (DHCP reservation por MAC).
- [ ] Verificar conexión cableada del Mac mini y del MacBook M1 Max al FRITZ!Box.
- [ ] Activar en el Mac mini: `Preferencias del Sistema → Energía → Activar para acceso a la red`.
- [ ] Validar con `pmset -g | grep womp` → debe mostrar `womp 1`. Si no, `sudo pmset -a womp 1`.
- [ ] Documentar MAC + IP de ambos Macs en `infra/hosts.yml`.
- [ ] Decidir nombre de subdominio dyndns (`midominio.dyndns.org`).

**Entregable**: `docs/01-inventario.md` con MACs, IPs, puertos y diagramas.

---

### Fase 1 — Red y DynDNS (½ día)

**Objetivo**: FQDN público estable apuntando al router.

- [ ] Activar **MyFRITZ!** o configurar `ddclient` en el Mac mini si se usa otro proveedor (DuckDNS, No-IP, Cloudflare DNS API).
- [ ] Validar resolución externa: `dig +short midominio.dyndns.org` desde una red 4G.
- [ ] **NO** abrir puertos todavía. Primero el proxy y la app deben estar listos.

**Entregable**: `docs/02-dyndns.md` con el método elegido y comandos de verificación.

---

### Fase 2 — Ollama nativo en macOS (½ día)

**Objetivo**: Ollama estable, escuchando solo en localhost, con autoarranque.

- [ ] Instalar Ollama nativo (no Docker — usa Metal en M1).
- [ ] Configurar variables:
  ```
  OLLAMA_HOST=127.0.0.1:11434
  OLLAMA_KEEP_ALIVE=10m
  OLLAMA_NUM_PARALLEL=1
  OLLAMA_MAX_QUEUE=64
  ```
- [ ] Crear `LaunchAgent` (`~/Library/LaunchAgents/ai.ollama.plist`) para autoarranque al login.
- [ ] Descargar modelos base: `llama3.1:8b`, `qwen2.5:7b`, `mistral:7b`, `nomic-embed-text`.
- [ ] Probar inferencia local: `ollama run llama3.1:8b "test"`.

**Entregable**: `services/ollama/` con plist + script de bootstrap.

---

### Fase 3 — Reverse proxy con Caddy + TLS (1 día)

**Objetivo**: HTTPS público con certificado válido, sin exponer puertos extras, con ruteo por path.

- [ ] Instalar Caddy 2 nativo (Homebrew).
- [ ] Crear `Caddyfile`:
  ```caddy
  midominio.dyndns.org {
      encode zstd gzip

      # Panel SPA
      handle_path /panel/* {
          root * /opt/ollama-hub/frontend/dist
          file_server
      }

      # API administrativa y de auth
      handle /api/* {
          reverse_proxy 127.0.0.1:8000
      }

      # Gateway Ollama (con cola, auth, timeout)
      handle /ollama/* {
          reverse_proxy 127.0.0.1:8000 {
              flush_interval -1
              transport http {
                  compression off
                  response_header_timeout 10m
              }
          }
      }

      # WOL micro-servicio
      handle /wol/* {
          reverse_proxy 127.0.0.1:8765
      }

      # Headers de seguridad
      header {
          Strict-Transport-Security "max-age=63072000; includeSubDomains; preload"
          X-Content-Type-Options "nosniff"
          X-Frame-Options "DENY"
          Referrer-Policy "no-referrer"
          Permissions-Policy "interest-cohort=()"
      }

      # Rate limit por IP (plugin caddy-ratelimit)
      rate_limit {
          zone external {
              key {remote_host}
              events 60
              window 1m
          }
      }
  }
  ```
- [ ] Abrir **solo** el puerto **443/TCP** en el FRITZ!Box (`Internet → Filtros → Liberaciones de puertos`) hacia la IP del Mac mini.
- [ ] Validar HTTPS desde Internet: `curl -I https://midominio.dyndns.org/`.

**Entregable**: `services/caddy/Caddyfile` versionado + `docs/03-tls.md`.

---

### Fase 4 — Backend FastAPI: auth, tokens, cola, timeout (3–4 días)

**Objetivo**: gateway que protege Ollama con autenticación, cola serializada y timeout.

#### 4.1 Modelo de datos (SQLite + SQLModel)

```python
class User:        id, email, password_hash, role(admin|user), is_active, created_at
class ApiToken:    id, user_id, name, token_hash, scopes[], expires_at, last_used_at, is_revoked
class Job:         id, user_id, token_id, host_id, model, status, prompt_hash,
                   started_at, finished_at, duration_ms, tokens_in, tokens_out, error
class Host:        id, name, base_url, mac, ip, is_local, requires_wol, is_enabled, models_cache
class Setting:     key, value    # registro_abierto, max_concurrency, timeout_s, ...
class AuditEvent:  id, ts, ip, user_id, action, target, success, details(jsonb)
```

#### 4.2 Endpoints clave

| Método | Path                              | Auth   | Descripción                                  |
| ------ | --------------------------------- | ------ | -------------------------------------------- |
| POST   | `/api/auth/login`                 | —      | Email + password → JWT corto (15 min)        |
| POST   | `/api/auth/refresh`               | refresh| Renueva access token                         |
| POST   | `/api/auth/register`              | —      | Solo si `Setting.registro_abierto=true`      |
| GET    | `/api/me`                         | JWT    | Datos del usuario                            |
| GET    | `/api/admin/users`                | admin  | Listado y gestión                            |
| POST   | `/api/admin/users/:id/activate`   | admin  | Activar/desactivar cuenta                    |
| POST   | `/api/admin/settings`             | admin  | Editar concurrency, timeout, registro abierto|
| GET    | `/api/admin/hosts`                | admin  | Listar workers configurados                  |
| POST   | `/api/admin/hosts`                | admin  | Añadir worker (M1 Max, etc.)                 |
| POST   | `/api/admin/hosts/:id/wake`       | admin  | WOL manual                                   |
| POST   | `/api/admin/hosts/:id/test`       | admin  | Ping + listar modelos                        |
| GET    | `/api/admin/stats`                | admin  | Métricas agregadas                           |
| POST   | `/api/tokens`                     | JWT    | Crear token de API                           |
| GET    | `/api/tokens`                     | JWT    | Listar tokens propios                        |
| DELETE | `/api/tokens/:id`                 | JWT    | Revocar                                      |
| GET    | `/api/models`                     | token  | Modelos disponibles (agregado de todos hosts)|
| POST   | `/ollama/v1/chat/completions`     | token  | Inferencia (entra a la cola)                 |
| GET    | `/ollama/api/tags`                | token  | Modelos del host activo                      |
| GET    | `/health`                         | —      | Liveness (sin info sensible)                 |

#### 4.3 Cola y concurrencia

```python
# core/queue.py
import asyncio
from contextlib import asynccontextmanager

class InferenceQueue:
    def __init__(self, max_concurrent: int = 1):
        self.sem = asyncio.Semaphore(max_concurrent)
        self.waiting = 0

    @asynccontextmanager
    async def slot(self, timeout: float):
        self.waiting += 1
        try:
            await asyncio.wait_for(self.sem.acquire(), timeout=timeout)
        finally:
            self.waiting -= 1
        try:
            yield
        finally:
            self.sem.release()
```

- El parámetro `max_concurrent` se lee desde `Setting.max_concurrency` en caliente.
- Timeout total por request gestionado con `asyncio.wait_for` envolviendo el stream a Ollama.
- Cuando expira, se cierra el stream HTTP al cliente con `{"error": "timeout", "elapsed_s": ...}`.

#### 4.4 Selección de host (router multi-nodo)

Estrategia por defecto: **least-busy disponible que tenga el modelo**.

```
seleccionar_host(model):
  candidatos = hosts where is_enabled and model in models_cache
  ordenar por carga actual (jobs activos) ASC
  para cada h en candidatos:
      si h.is_local: return h
      si h disponible (TCP probe) : return h
      si h.requires_wol:
          enviar WOL, esperar hasta READY_TIMEOUT (~60s)
          si OK return h
  -> 503 No backend available
```

#### 4.5 Audit log

- Cada request autenticado se registra con: timestamp, IP (desde `X-Forwarded-For` con allowlist Caddy), user_id, token_id, ruta, status, latencia, host elegido.
- Eventos especiales: login fallido, token inválido, rate limit excedido, WOL disparado, timeout, error de backend.
- Rotación diaria con compresión.

**Entregable**: `backend/` con tests unitarios mínimos (auth, cola, timeout, router).

---

### Fase 5 — Servicio WOL integrado (½ día)

**Objetivo**: reutilizar `wol-proxy.py` del repo base, encapsularlo y exponerlo solo internamente.

- [ ] Copiar `wol-proxy.py` a `services/wol/wol-proxy.py`.
- [ ] Crear `LaunchAgent` que lo arranque en `127.0.0.1:8765`.
- [ ] Añadir auth simple por header `X-Internal-Token` (compartido solo con el backend FastAPI).
- [ ] El backend llama:
  - `POST /wol/wake` con MAC del worker.
  - `POST /wol/fritzbox` cuando se necesita WOL desde fuera (vía TR-064).
- [ ] Documentar credenciales FRITZ!Box TR-064 en `.env` cifrado.

**Entregable**: `services/wol/` + tests de magic packet en LAN aislada.

---

### Fase 6 — Frontend: panel admin + consola (3–4 días)

**Objetivo**: SPA en React que cubre todos los flujos.

#### 6.1 Pantallas

| Ruta              | Acceso  | Contenido                                              |
| ----------------- | ------- | ------------------------------------------------------ |
| `/panel/login`    | público | Login + (opcional) registro si está habilitado         |
| `/panel/`         | user    | Dashboard: estado nodos, jobs propios, modelos         |
| `/panel/tokens`   | user    | CRUD tokens, scopes, copiar al crear (solo una vez)    |
| `/panel/console`  | user    | AI Console adaptada de `ai-console.html`               |
| `/panel/admin`    | admin   | Usuarios, settings globales, hosts                     |
| `/panel/admin/hosts` | admin| Añadir/editar workers, probar conexión, WOL manual     |
| `/panel/admin/stats` | admin| Gráficos: jobs/día, latencia media, top modelos, errores |
| `/panel/admin/audit` | admin| Auditoría con filtros (IP, user, acción, rango fechas) |

#### 6.2 Reutilización de `ai-console.html`

La consola se **integra** dentro del panel, no se reescribe:

- Migrar la UI a un componente React (`<AiConsole />`) preservando: Marked, Highlight.js, historial en `localStorage`, detección de razonamiento (`<think>`), métricas de latencia/VRAM.
- Reemplazar el campo "API Key" por **selector de token propio** (el panel ya conoce los del usuario).
- Añadir selector de **host** (auto, mac-mini, m1-max).

#### 6.3 Hardening cliente

- Cookies de sesión `HttpOnly; Secure; SameSite=Strict` para el JWT del panel.
- Tokens de API **nunca** se guardan en `localStorage` del panel — se muestran una sola vez.
- CSP estricta servida por Caddy:
  ```
  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self';
  ```

**Entregable**: `frontend/` build estático servido por Caddy.

---

### Fase 7 — Worker remoto: MacBook M1 Max (1 día)

**Objetivo**: el M1 Max actúa como nodo opcional al que el Mac mini delega cuando está disponible.

- [ ] Instalar Ollama en el M1 Max con la misma config (bind a `0.0.0.0:11434` **solo si la LAN es de confianza**; preferible bind a la IP LAN concreta).
- [ ] Generar par de **certificados mTLS** (CA propia con `step-ca` o `mkcert`). El M1 Max requiere certificado de cliente del Mac mini.
- [ ] Configurar Caddy en el M1 Max **solo escuchando en la IP LAN**, con `client_auth` mTLS hacia el Mac mini.
- [ ] El backend del Mac mini guarda el certificado de cliente en el secret store y lo presenta cuando rutea a `host=m1-max`.
- [ ] Configurar WOL del M1 Max (MAC + `pmset womp 1`).
- [ ] El backend mantiene un `models_cache` por host, refrescado cada N min con `/api/tags`.

**Entregable**: `services/worker-template/` con guía de onboarding de cualquier nodo nuevo.

---

### Fase 8 — Seguridad endurecida (2 días)

**Objetivo**: reducir superficie y detectar anomalías.

#### 8.1 Firewall (macOS `pf`)

- Bloquear todo entrante salvo `tcp/443` desde Internet y `tcp/22` desde la LAN (si se necesita SSH).
- Limitar conexiones concurrentes por IP origen: `max-src-conn 30, max-src-conn-rate 100/10`.
- Plantilla `services/firewall/pf.conf`.

#### 8.2 Bloqueo de IPs maliciosas

- Script `auditor.py` que tail-ea los logs de Caddy + FastAPI y banea IPs con:
  - Más de N (default 5) fallos de auth en M (default 10) min → ban temporal con `pfctl -t blocklist -T add`.
  - Más de X peticiones a `/api/auth/*` por minuto.
  - Path traversal patterns, `..%2f`, payloads SQLi/XSS conocidos.
- Whitelist de IPs propias persistente en `services/firewall/whitelist.yml`.

#### 8.3 Gestión de secretos

- Todos los secretos en `.env` cifrado con `sops` + edad/key.
- Rotación periódica documentada: `docs/sec-rotation.md`.
- Tokens de API guardados como **hash bcrypt(cost=12)** + prefijo visible para identificación (`olh_xxxxxx...`).
- JWT firmado con clave RS256 rotable cada 90 días.

#### 8.4 Hardening del SO

- `sudo systemsetup -setremotelogin off` salvo durante mantenimiento.
- FileVault activo.
- Cuenta de admin separada de la cuenta que corre el servicio (`ollamasvc`, sin shell).
- Permisos restrictivos en `/opt/ollama-hub` (owner `ollamasvc:_ollamasvc`, mode `0750`).

#### 8.5 Hardening HTTP

- HSTS con preload.
- CSP estricta + Trusted Types en panel.
- Cookies `Secure; HttpOnly; SameSite=Strict`.
- CSRF con doble submit token.
- Rate limit en Caddy + segundo nivel en FastAPI con `slowapi`.
- Timeouts agresivos por endpoint (no infinito).

**Entregable**: `services/security/` + checklist `docs/04-seguridad.md`.

---

### Fase 9 — Observabilidad y logging (1 día)

**Objetivo**: trazabilidad completa para análisis forense post-incidente.

- [ ] Docker Compose con **Loki + Promtail + Grafana**.
- [ ] Promtail recoge:
  - Logs de Caddy (acceso + errores).
  - Logs estructurados de FastAPI (JSON).
  - Logs de `auditor.py`.
  - `wol-proxy.py`.
- [ ] Dashboards de Grafana:
  - Tráfico por path, status code, geo-IP.
  - Jobs/min, latencia p50/p95/p99, errores, timeouts.
  - Top tokens, top usuarios, top modelos.
  - Intentos de auth fallidos, IPs baneadas, eventos de seguridad.
- [ ] Alertas:
  - Pico de 4xx/5xx.
  - Más de N bans en X minutos.
  - Disco lleno, CPU/RAM sostenidas > 90 %.
  - Ollama caído o no responde > 60 s.
- [ ] Retención: 30 días en disco, export semanal a almacenamiento frío.

**Entregable**: `observability/` con compose + dashboards versionados.

---

### Fase 10 — Tests de seguridad y validación (1 día por iteración)

**Objetivo**: probar que la exposición real es segura **antes** y **después** de cada cambio mayor.

- [ ] Escaneo de puertos externo:
  ```
  nmap -Pn -sS -sV -p- midominio.dyndns.org
  ```
  Solo debe responder `443/tcp`.
- [ ] **SSL Labs**: A+ requerido (HSTS, TLS 1.2+, no protocolos viejos).
- [ ] **testssl.sh** local: sin RSA <2048, sin SHA1, OCSP stapling activo.
- [ ] **OWASP ZAP** en modo baseline contra `https://midominio.dyndns.org/panel/`.
- [ ] **Nikto**: identificar misconfiguraciones HTTP.
- [ ] Pentest manual de la API: tokens revocados, expirados, scopes, IDOR en `/api/admin/users/:id`.
- [ ] Fuzz del endpoint `/ollama/*` con payloads de prompt injection y verificar que **no exfiltra** tokens internos.
- [ ] Verificación de logs: cada intento debe quedar en audit.

**Entregable**: `tests/security/` con scripts y reportes datados.

---

### Fase 11 — Despliegue, backup y mantenimiento (½ día)

- [ ] Script idempotente `bootstrap.sh` que instala todo en un Mac mini limpio.
- [ ] Backup diario cifrado de la SQLite + audit logs a un destino externo (rclone a B2 o S3).
- [ ] Verificación de DynDNS automatizada (alerta si la IP pública cambia y el DNS no se actualiza en < 5 min).
- [ ] Documento de **respuesta a incidentes**: pasos para aislar, rotar secretos, revocar todos los tokens, analizar logs (`docs/05-incidentes.md`).
- [ ] Documento de **runbook** operativo: encender/dormir Macs, actualizar Ollama, añadir modelo, añadir usuario, añadir host (`docs/06-runbook.md`).

---

## 5. Estructura del repositorio (objetivo)

```
HomeLlamaHub/
├── README.md                       ← este archivo
├── docs/
│   ├── 01-inventario.md
│   ├── 02-dyndns.md
│   ├── 03-tls.md
│   ├── 04-seguridad.md
│   ├── 05-incidentes.md
│   ├── 06-runbook.md
│   └── arquitectura.md
├── backend/
│   ├── app/
│   │   ├── main.py
│   │   ├── api/                    (routers: auth, admin, ollama, wol, tokens)
│   │   ├── core/                   (config, security, queue, audit)
│   │   ├── models/                 (SQLModel)
│   │   ├── services/               (host_router, wol_client, ollama_client)
│   │   └── schemas/
│   ├── tests/
│   └── pyproject.toml
├── frontend/
│   ├── src/
│   │   ├── pages/                  (Login, Dashboard, Tokens, Console, Admin/*)
│   │   ├── components/             (AiConsole adaptada)
│   │   └── lib/
│   └── package.json
├── services/
│   ├── caddy/Caddyfile
│   ├── ollama/ai.ollama.plist
│   ├── wol/wol-proxy.py
│   ├── worker-template/
│   ├── firewall/pf.conf
│   └── security/auditor.py
├── observability/
│   ├── docker-compose.yml
│   ├── promtail-config.yml
│   └── dashboards/
├── tests/
│   └── security/
│       ├── nmap.sh
│       ├── zap-baseline.sh
│       └── testssl.sh
├── infra/
│   ├── hosts.yml
│   └── secrets.sops.yaml
└── scripts/
    ├── bootstrap.sh
    └── backup.sh
```

---

## 6. Variables de entorno principales

```env
# Backend
APP_ENV=production
DATABASE_URL=sqlite:///data/hub.db
JWT_PRIVATE_KEY_PATH=/opt/ollama-hub/secrets/jwt.pem
JWT_PUBLIC_KEY_PATH=/opt/ollama-hub/secrets/jwt.pub
JWT_ACCESS_TTL_S=900
JWT_REFRESH_TTL_S=2592000
OLLAMA_LOCAL_URL=http://127.0.0.1:11434
WOL_PROXY_URL=http://127.0.0.1:8765
WOL_PROXY_TOKEN=...
DEFAULT_MAX_CONCURRENCY=1
DEFAULT_REQUEST_TIMEOUT_S=300
RATE_LIMIT_PER_MIN=60
REGISTRATION_OPEN=false

# FRITZ!Box TR-064
FRITZBOX_HOST=fritz.box
FRITZBOX_USER=...
FRITZBOX_PASSWORD=...

# DynDNS
DYNDNS_FQDN=midominio.dyndns.org
```

Todo este fichero debe vivir cifrado con `sops`; nunca en claro en el repo.

---

## 7. Modelo de amenazas (resumen)

| Amenaza                              | Mitigación                                                                 |
| ------------------------------------ | -------------------------------------------------------------------------- |
| Escaneo masivo / fuerza bruta auth   | Caddy rate limit + `auditor.py` con ban automático                         |
| Robo de token                        | Tokens con scopes, expiración, rotación, revocación inmediata por admin    |
| Compromiso del Mac mini              | FileVault, cuenta de servicio separada, secretos cifrados, backup externo  |
| Exfiltración por prompt injection    | Backend nunca incluye secretos en el prompt; logs separados del flujo LLM  |
| MITM en LAN hacia worker             | mTLS obligatorio entre Mac mini y M1 Max                                   |
| DoS por consulta larga               | Timeout duro + cola limitada + rate limit por token e IP                   |
| WOL abuso (paquetes mágicos)         | `/wol/*` solo accesible vía `127.0.0.1` o con token interno + auth admin   |
| DNS poisoning / IP cambia            | Verificación periódica + alerta + HSTS para evitar downgrade               |
| Ollama actualizado con vuln          | Pin de versión + revisión de changelog antes de actualizar                 |

---

## 9. Guía de operación

Comandos concretos para levantar, verificar y diagnosticar cada componente. Ejecutar **en orden** en un Mac mini limpio; en un sistema ya configurado usarlos como referencia de diagnóstico.

> Ruta base asumida: `/opt/ollama-hub/` — ajustar si se usa otra.

---

### 9.1 Backend FastAPI

#### Requisitos
```bash
brew install python@3.12
pip install uv
cd backend && uv sync
```

#### Configuración
```bash
cp .env.example .env          # completar con valores reales
# Variables mínimas obligatorias:
#   SECRET_KEY, DATABASE_URL, PUBLIC_FQDN, WOL_PROXY_TOKEN
```

#### Arrancar (desarrollo)
```bash
cd backend
uv run uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```

#### Arrancar (producción — LaunchAgent)
```bash
# El plist debe apuntar a uvicorn con --workers 2 y sin --reload
launchctl load ~/Library/LaunchAgents/ai.homellamahub.plist
launchctl list | grep homellamahub   # debe aparecer con PID
```

#### Verificar
```bash
curl http://127.0.0.1:8000/health
# {"status":"ok","queue_active":0,"queue_waiting":0}

# Login y obtener JWT:
curl -s -X POST http://127.0.0.1:8000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@localhost","password":"<tu-password"}' | python3 -m json.tool
```

#### Tests unitarios
```bash
cd backend
uv run pytest -v                      # todos los tests
uv run pytest tests/test_auth.py -v   # solo auth
uv run pytest tests/test_queue.py -v  # solo cola
```

---

### 9.2 Frontend React

#### Requisitos
```bash
brew install node           # Node 20+
cd frontend && npm install
```

#### Desarrollo
```bash
cd frontend
npm run dev                 # Vite dev server en http://localhost:5173
```

#### Build de producción
```bash
cd frontend
npm run build               # genera frontend/dist/
# Caddy sirve frontend/dist/ en /panel/*
```

#### Verificar build
```bash
ls -lh frontend/dist/       # debe existir index.html + assets/
# Verificar que el hash de los assets cambió respecto al build anterior
```

---

### 9.3 WOL Proxy

#### Instalación
```bash
# Copiar el servicio
cp -r services/wol/ /opt/ollama-hub/services/wol/

# Generar token (guardar en .env y en el plist)
python3 -c "import secrets; print(secrets.token_hex(32))"

# Editar el plist con el token y credenciales FRITZ!Box
nano services/wol/ai.wol-proxy.plist   # reemplazar los REPLACE_WITH_* 

# Instalar LaunchAgent
cp services/wol/ai.wol-proxy.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/ai.wol-proxy.plist
```

#### Verificar
```bash
# Health check
curl http://127.0.0.1:8765/health
# {"ok": true}

# Smoke test completo (requiere MAC y token)
./services/wol/test-magic-packet.sh AA:BB:CC:DD:EE:FF <token>
```

#### Diagnóstico
```bash
launchctl list | grep wol-proxy        # verificar que corre
tail -f /tmp/wol-proxy.log             # logs en tiempo real
tail -f /tmp/wol-proxy.err             # errores

# Verificar que solo escucha en localhost:
lsof -nP -iTCP:8765 | grep LISTEN
# Debe mostrar 127.0.0.1:8765, nunca 0.0.0.0 o *
```

---

### 9.4 Firewall (pf)

#### Instalación
```bash
# Preparar archivos de tablas vacíos
sudo touch /etc/pf.blocklist /etc/pf.whitelist
sudo chmod 600 /etc/pf.blocklist /etc/pf.whitelist

# Copiar configuración
sudo cp services/firewall/pf.conf /etc/pf.conf

# Cargar tu whitelist (editar services/firewall/whitelist.yml primero)
sudo ./services/firewall/load-whitelist.sh

# Activar pf
sudo pfctl -ef /etc/pf.conf
```

#### Verificar
```bash
sudo pfctl -s info                      # Status: Enabled
sudo pfctl -s rules                     # listar reglas activas
sudo pfctl -t blocklist -T show         # IPs baneadas
sudo pfctl -t whitelist -T show         # IPs en whitelist

# Test desde red externa (solo 443 debe responder):
nmap -Pn -p 22,443,8000,8765,11434 <tu-fqdn>
```

#### Operaciones comunes
```bash
# Añadir IP a whitelist manualmente (temporal, sin editar el yml):
sudo pfctl -t whitelist -T add 1.2.3.4

# Banear IP manualmente:
sudo pfctl -t blocklist -T add 1.2.3.4

# Desbanear IP:
sudo pfctl -t blocklist -T delete 1.2.3.4

# Recargar reglas sin perder el estado:
sudo pfctl -f /etc/pf.conf

# Ver estadísticas de tráfico:
sudo pfctl -s info | grep -A5 "State Table"
```

---

### 9.5 Auditor de seguridad

#### Instalación
```bash
# El auditor corre como root (necesita pfctl)
sudo cp services/security/ai.auditor.plist /Library/LaunchDaemons/
sudo launchctl load /Library/LaunchDaemons/ai.auditor.plist
```

#### Verificar
```bash
sudo launchctl list | grep auditor      # debe aparecer con PID
tail -f /var/log/auditor.log            # actividad en tiempo real

# Simular 5 fallos de auth para probar el ban:
for i in $(seq 1 6); do
  curl -s -X POST http://127.0.0.1:8000/api/auth/login \
    -H "Content-Type: application/json" \
    -d '{"email":"x@x.com","password":"wrong"}' > /dev/null
done
# Verificar que la IP quedó baneada:
sudo pfctl -t blocklist -T show
```

#### Diagnóstico
```bash
tail -f /var/log/auditor.err            # errores del proceso
sudo launchctl start ai.auditor         # forzar restart
grep "BANNING" /var/log/auditor.log     # historial de bans
grep "attack-pattern" /var/log/auditor.log  # ataques detectados
```

#### Variables de configuración (env en el plist)
| Variable | Default | Descripción |
|---|---|---|
| `AUTH_FAIL_THRESHOLD` | 5 | Fallos de auth antes de banear |
| `AUTH_FAIL_WINDOW_S` | 600 | Ventana de tiempo en segundos |
| `AUTH_RATE_THRESHOLD` | 20 | Req/min a `/api/auth/*` antes de banear |
| `SCAN_404_THRESHOLD` | 30 | 404s/min antes de banear (scanner) |
| `BAN_DURATION_S` | 3600 | Duración del ban en segundos |

---

### 9.6 Worker remoto (M1 Max)

#### Setup completo (ejecutar en el hub)
```bash
# Paso 1 — generar certificados mTLS (en el Mac mini hub)
chmod +x services/worker-template/setup-mtls.sh
./services/worker-template/setup-mtls.sh 192.168.178.20   # IP del M1 Max

# Paso 2 — copiar archivos al worker
scp -r services/worker-template/ usuario@192.168.178.20:~/worker-template/

# Paso 3 — ejecutar setup en el worker (SSH al M1 Max)
ssh usuario@192.168.178.20
chmod +x ~/worker-template/setup-worker.sh
~/worker-template/setup-worker.sh --ip 192.168.178.20 --hub-ip 192.168.178.10
```

#### Registrar el worker en la API
```bash
# Obtener JWT admin primero
ADMIN_JWT=$(curl -s -X POST http://127.0.0.1:8000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@localhost","password":"<password>"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")

# Registrar el host
curl -X POST http://127.0.0.1:8000/api/admin/hosts \
  -H "Authorization: Bearer $ADMIN_JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "m1-max",
    "base_url": "https://192.168.178.20:11435",
    "ip": "192.168.178.20",
    "mac": "AA:BB:CC:DD:EE:FF",
    "is_local": false,
    "requires_wol": true,
    "is_enabled": true
  }'
```

#### Verificar conectividad mTLS
```bash
CERTS=/opt/ollama-hub/secrets/mtls
curl --cacert $CERTS/ca/root_ca.crt \
     --cert $CERTS/hub-client/client.crt \
     --key $CERTS/hub-client/client.key \
     https://192.168.178.20:11435/api/tags
# Debe devolver la lista de modelos del worker

# Test WOL manual:
ADMIN_JWT=<token>
curl -X POST http://127.0.0.1:8000/api/admin/hosts/<id>/wake \
  -H "Authorization: Bearer $ADMIN_JWT"
```

---

### 9.7 Observabilidad (Loki + Promtail + Grafana)

#### Requisitos
```bash
brew install docker           # Docker Desktop o OrbStack
```

#### Arrancar
```bash
cd observability
cp .env.example .env          # cambiar GRAFANA_PASSWORD
docker compose up -d
docker compose ps             # verificar que los 3 servicios están healthy
```

#### Acceder a Grafana
```bash
# Opción A — túnel SSH (desarrollo):
ssh -L 3000:127.0.0.1:3000 usuario@mac-mini
# Abrir http://localhost:3000  (admin / <GRAFANA_PASSWORD>)

# Opción B — vía Caddy (producción, añadir al Caddyfile):
# handle_path /grafana/* {
#     reverse_proxy 127.0.0.1:3000
# }
```

#### Verificar ingesta de logs
```bash
# Caddy debe estar escribiendo logs JSON:
ls -lh /var/log/caddy/access.log

# Verificar que Promtail está enviando:
curl http://127.0.0.1:9080/metrics | grep promtail_sent_entries

# Query directa a Loki (últimas 10 líneas de Caddy):
curl -G http://127.0.0.1:3100/loki/api/v1/query \
  --data-urlencode 'query={job="caddy"}' \
  --data-urlencode 'limit=10' | python3 -m json.tool
```

#### Operaciones comunes
```bash
# Ver logs en tiempo real (sin Grafana):
docker compose logs -f promtail

# Reiniciar un servicio:
docker compose restart grafana

# Ver espacio usado por Loki:
docker volume inspect observability_loki_data

# Detener todo (datos persisten en volúmenes):
docker compose down

# Borrar todo incluyendo datos:
docker compose down -v         # ⚠ irreversible
```

---

### 9.8 Chequeos de estado global

Comandos para una revisión rápida de que todo el stack está saludable:

```bash
#!/usr/bin/env bash
# Ejecutar periódicamente o ante cualquier duda
echo "=== Backend ==="
curl -sf http://127.0.0.1:8000/health | python3 -m json.tool

echo "=== WOL Proxy ==="
curl -sf http://127.0.0.1:8765/health | python3 -m json.tool

echo "=== Ollama ==="
curl -sf http://127.0.0.1:11434/api/version | python3 -m json.tool

echo "=== pf ==="
sudo pfctl -s info | grep Status
sudo pfctl -t blocklist -T show | wc -l | xargs echo "IPs baneadas:"

echo "=== Servicios LaunchAgent/Daemon ==="
launchctl list | grep -E "wol-proxy|homellamahub"
sudo launchctl list | grep -E "auditor"

echo "=== Observabilidad ==="
docker compose -f /opt/ollama-hub/observability/docker-compose.yml ps
```

---

## 8. Referencias técnicas

- [Ollama detrás de un reverse proxy con Caddy o Nginx](https://www.glukhov.org/llm-hosting/ollama/ollama-behind-reverse-proxy/)
- [Securely Exposing Ollama Service to the Public Internet](https://medium.com/@jaegercode/securely-exposing-ollama-service-to-the-public-internet-complete-deployment-and-remote-management-ad10724a5e53)
- [Exposed Ollama Servers — Security Boulevard](https://securityboulevard.com/2026/03/exposed-ollama-servers-security-risks-of-publicly-accessible-llm-infrastructure/)
- [Caddy — Path-based reverse proxy](https://dev.to/vizalo/path-based-reverse-proxying-with-caddy-3gjm)
- [Caddyfile `reverse_proxy` directive](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy)
- [FRITZ!Box 6660 — Port forwarding](https://fritz.com/en/apps/knowledge-base/FRITZ-Box-6660-Cable/34_setting-up-port-sharing-in-the-fritz-box)
- [FRITZ!Box — Wake on LAN desde Internet](https://en.avm.de/service/knowledge-base/dok/FRITZ-Box-7590/36_Starting-network-devices-over-the-internet-Wake-on-LAN/)
- [Wake on LAN en macOS (`pmset womp`)](https://iboysoft.com/wiki/wake-for-network-access.html)
- [Apple Silicon: limitaciones de WOL desde apagado](https://discussions.apple.com/thread/254348496)
- [FastAPI — concurrencia con semáforos](https://medium.com/@reesel/build-faster-more-reliable-fastapi-apps-with-concurrency-e726784a0299)
- [Ollama FAQ — `OLLAMA_NUM_PARALLEL` y `OLLAMA_MAX_QUEUE`](https://docs.ollama.com/faq)
- [Repo base: `patchamama/LocalForge_Ollama-Local-SSL`](https://github.com/patchamama/LocalForge_Ollama-Local-SSL)

---

## 9. Estado actual

- [x] Idea y diseño general — este README.
- [ ] Fase 0 — Inventario.
- [ ] Fase 1 — DynDNS.
- [ ] Fase 2 — Ollama nativo.
- [ ] Fase 3 — Caddy + TLS.
- [ ] Fase 4 — Backend FastAPI.
- [ ] Fase 5 — WOL integrado.
- [ ] Fase 6 — Frontend.
- [ ] Fase 7 — Worker M1 Max.
- [ ] Fase 8 — Hardening.
- [ ] Fase 9 — Observabilidad.
- [ ] Fase 10 — Tests de seguridad.
- [ ] Fase 11 — Despliegue y mantenimiento.

---

## 10. Próximo paso recomendado

Empezar por **Fase 0 (inventario)** y **Fase 2 (Ollama nativo)** en paralelo — ambas son no-destructivas y bloquean al resto.  
Antes de abrir el puerto 443 en el FRITZ!Box, **Fase 3 + Fase 4 + Fase 8** deben estar verificadas en local con un dominio interno.

> Regla de oro: **el puerto 443 no se abre al mundo hasta que las fases 3, 4 y 8 estén cerradas y los tests de la Fase 10 pasen contra el servicio en LAN.**
