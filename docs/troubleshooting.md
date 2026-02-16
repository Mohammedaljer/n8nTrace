# Troubleshooting

Common issues and solutions.

## Database Not Ready

**Symptom**: Backend fails to start, logs show database connection errors.

**Solutions**:
1. Wait for PostgreSQL to be healthy:
   ```bash
   docker compose logs postgres
   # Look for "database system is ready to accept connections"
   ```
2. Check `DATABASE_URL` is correct
3. Ensure PostgreSQL container is running:
   ```bash
   docker compose ps
   ```

## Health Check Returns 503

**Symptom**: `/health` returns 503 or timeout.

**Causes**:
- Database not connected
- Backend still starting
- Migrations running

**Solutions**:
1. Check backend logs:
   ```bash
   docker compose logs backend
   ```
2. Verify database connection:
   ```bash
   docker exec n8n_pulse_backend curl -s http://localhost:8001/health
   ```

## Redirected to /setup When Users Exist

**Symptom**: App redirects to `/setup` even though users exist.

**Cause**: `/api/setup/status` returning `setupRequired: true` incorrectly.

**Solutions**:
1. Check database has users:
   ```bash
   docker exec n8n_pulse_postgres psql -U n8n_pulse -c "SELECT COUNT(*) FROM app_users;"
   ```
2. Check backend can query users (database connection)

## Login Fails with 401

**Symptom**: Correct credentials return 401.

**Causes**:
- Password mismatch (case-sensitive)
- User doesn't exist
- Token version mismatch (session invalidated)

**Solutions**:
1. Verify user exists:
   ```bash
   docker exec n8n_pulse_postgres psql -U n8n_pulse -c "SELECT email FROM app_users;"
   ```
2. Reset password via admin panel or forgot-password flow

## Cookies Not Being Set

**Symptom**: Login succeeds but subsequent requests fail (not authenticated).

**Causes**:
- `COOKIE_SECURE=true` but no HTTPS
- Cross-origin without proper CORS
- Browser blocking third-party cookies

**Solutions**:
1. For local dev without HTTPS:
   ```bash
   COOKIE_SECURE=false
   ```
2. Ensure `CORS_ORIGIN` matches frontend URL exactly
3. Ensure frontend and API are same origin (nginx proxy)

## CORS Errors

**Symptom**: Browser console shows CORS errors.

**Cause**: `CORS_ORIGIN` doesn't match the request origin.

**Solution**:
```bash
# Must match exactly
CORS_ORIGIN=https://pulse.example.com

# NOT
CORS_ORIGIN=https://pulse.example.com/  # trailing slash
CORS_ORIGIN=http://pulse.example.com    # wrong scheme
```

## Metrics Not Showing

**Symptom**: Metrics dashboard is empty.

**Causes**:
- `METRICS_ENABLED=false`
- No metrics data in database
- User lacks `metrics.read.full` permission

**Solutions**:
1. Enable metrics:
   ```bash
   METRICS_ENABLED=true
   ```
2. Verify n8n is inserting metrics data
3. Check user has Analyst or Admin role

## Migrations Failed

**Symptom**: Backend won't start, logs show migration errors.

**Solutions**:
1. Check migration logs:
   ```bash
   docker compose logs backend | grep -i migrat
   ```
2. Manually run migrations:
   ```bash
   docker exec n8n_pulse_backend npm run migrate up
   ```
3. Check database user has schema privileges

## Wrong Client IP in Audit Logs

**Symptom**: Audit logs show `127.0.0.1` or proxy IP instead of real client.

**Cause**: `TRUST_PROXY` not set correctly.

**Solution**:
```bash
# Single proxy (nginx)
TRUST_PROXY=1

# Multiple proxies (CDN + nginx)
TRUST_PROXY=2
```

See: [Security Guide - TRUST_PROXY](./security.md#trust_proxy-setting)

## Container Won't Start (Fail-fast)

**Symptom**: Backend exits immediately in production.

**Cause**: Production fail-fast checks failed.

**Check logs for**:
- `JWT_SECRET` too short or placeholder
- `COOKIE_SECURE=false` in production
- `CORS_ORIGIN=*`

**Solution**: Fix environment variables as indicated in error message.

## Retention Job Not Running

**Symptom**: Old data not being cleaned up.

**Causes**:
- `RETENTION_ENABLED=false` (default)
- `RETENTION_DAYS` set too high
- Job scheduled but hasn't run yet

**Solutions**:
1. Enable retention:
   ```bash
   RETENTION_ENABLED=true
   RETENTION_DAYS=90
   ```
2. Check retention status:
   ```bash
   curl -X GET http://localhost:8899/api/admin/retention/status
   ```
3. Manually trigger cleanup (requires admin auth):
   ```bash
   curl -X POST http://localhost:8899/api/admin/retention/run
   ```
4. Check backend logs for retention output:
   ```bash
   docker compose logs backend | grep -i retention
   ```

**Note**: The job runs at `RETENTION_RUN_AT` (default 03:30) in server/container time. Only finished executions are deleted—running executions are always preserved.

## Verification Commands

```bash
# Check all services
docker compose ps

# Backend health
curl http://localhost:8899/health

# Setup status
curl http://localhost:8899/api/setup/status

# View logs
docker compose logs -f backend
docker compose logs -f frontend
docker compose logs -f postgres
```
