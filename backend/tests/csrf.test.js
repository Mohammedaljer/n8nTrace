/**
 * CSRF middleware tests.
 *
 * Tests origin/referer checking for mutation requests on /api/ paths.
 * Pure unit tests — no DB required.
 */
const express = require('express');
const request = require('supertest');

function buildCsrfApp(appUrl) {
  // Must set env BEFORE requiring the module (it reads config at load time)
  process.env.APP_URL = appUrl || '';

  // Reset Jest's module registry so csrfOriginRefererCheck re-reads config
  jest.resetModules();

  const { csrfOriginRefererCheck } = require('../src/middleware/csrf');

  const app = express();
  app.use(express.json());
  app.use(csrfOriginRefererCheck);

  // Dummy endpoints for testing
  app.get('/api/test', (req, res) => res.json({ ok: true }));
  app.post('/api/test', (req, res) => res.json({ ok: true }));
  app.put('/api/test', (req, res) => res.json({ ok: true }));
  app.patch('/api/test', (req, res) => res.json({ ok: true }));
  app.delete('/api/test', (req, res) => res.json({ ok: true }));
  app.post('/other', (req, res) => res.json({ ok: true }));

  return app;
}

describe('CSRF Origin/Referer Check', () => {
  describe('when APP_URL is configured', () => {
    let app;

    beforeAll(() => {
      app = buildCsrfApp('https://trace.example.com');
    });

    test('allows GET requests without Origin header', async () => {
      const res = await request(app).get('/api/test');
      expect(res.status).toBe(200);
    });

    test('rejects POST without Origin or Referer', async () => {
      const res = await request(app)
        .post('/api/test')
        .send({ foo: 1 });
      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/origin/i);
    });

    test('rejects PUT without Origin or Referer', async () => {
      const res = await request(app).put('/api/test').send({});
      expect(res.status).toBe(403);
    });

    test('rejects PATCH without Origin or Referer', async () => {
      const res = await request(app).patch('/api/test').send({});
      expect(res.status).toBe(403);
    });

    test('rejects DELETE without Origin or Referer', async () => {
      const res = await request(app).delete('/api/test');
      expect(res.status).toBe(403);
    });

    test('allows POST with matching Origin header', async () => {
      const res = await request(app)
        .post('/api/test')
        .set('Origin', 'https://trace.example.com')
        .send({ foo: 1 });
      expect(res.status).toBe(200);
    });

    test('rejects POST with mismatched Origin header', async () => {
      const res = await request(app)
        .post('/api/test')
        .set('Origin', 'https://evil.example.com')
        .send({});
      expect(res.status).toBe(403);
    });

    test('allows POST with matching Referer header (no Origin)', async () => {
      const res = await request(app)
        .post('/api/test')
        .set('Referer', 'https://trace.example.com/dashboard')
        .send({});
      expect(res.status).toBe(200);
    });

    test('rejects POST with mismatched Referer header', async () => {
      const res = await request(app)
        .post('/api/test')
        .set('Referer', 'https://evil.example.com/attack')
        .send({});
      expect(res.status).toBe(403);
    });

    test('does not protect non-/api/ paths', async () => {
      const res = await request(app).post('/other').send({});
      expect(res.status).toBe(200);
    });
  });

  describe('when APP_URL is not set', () => {
    let app;

    beforeAll(() => {
      app = buildCsrfApp('');
    });

    test('allows POST without any origin headers (dev mode)', async () => {
      const res = await request(app).post('/api/test').send({});
      expect(res.status).toBe(200);
    });
  });
});
