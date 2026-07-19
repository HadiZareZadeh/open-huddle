import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { resetDatabase } from '../src/db/index.js';
import { roomService } from '../src/services/roomService.js';
import meetingRoutes from '../src/routes/meetings.js';

const app = express();
app.use(express.json());
app.use('/api', meetingRoutes);

describe('Meeting API', () => {
  beforeEach(() => {
    resetDatabase();
    roomService.clearActiveSessions();
  });

  describe('POST /api/meetings', () => {
    it('creates an open meeting', async () => {
      const res = await request(app).post('/api/meetings').send({});
      expect(res.status).toBe(201);
      expect(res.body.id).toMatch(/^[0-9A-Za-z]{12}$/);
      expect(res.body.requiresApproval).toBe(false);
    });

    it('creates a meeting that requires host approval', async () => {
      const res = await request(app)
        .post('/api/meetings')
        .send({ requireApproval: true });
      expect(res.status).toBe(201);
      expect(res.body.requiresApproval).toBe(true);
    });
  });

  describe('GET /api/meetings/:id', () => {
    it('returns meeting info for valid id', async () => {
      const createRes = await request(app)
        .post('/api/meetings')
        .send({ requireApproval: true });
      const { id } = createRes.body;

      const res = await request(app).get(`/api/meetings/${id}`);
      expect(res.status).toBe(200);
      expect(res.body.id).toBe(id);
      expect(res.body.requiresApproval).toBe(true);
      expect(res.body.participantCount).toBe(0);
      expect(res.body.maxParticipants).toBe(8);
      expect(res.body.expiresAt).toBeTruthy();
    });

    it('returns 404 for invalid meeting id format', async () => {
      const res = await request(app).get('/api/meetings/invalid');
      expect(res.status).toBe(400);
    });

    it('returns 404 for non-existent meeting', async () => {
      const res = await request(app).get('/api/meetings/AAAAAAAAAAAA');
      expect(res.status).toBe(404);
    });
  });

  describe('GET /api/config/ice', () => {
    it('returns ICE server configuration', async () => {
      const res = await request(app).get('/api/config/ice');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.iceServers)).toBe(true);
    });
  });
});
