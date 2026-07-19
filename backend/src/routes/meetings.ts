import { Router } from 'express';
import { roomService } from '../services/roomService.js';
import { getIceServers } from '../services/turnService.js';
import { createMeetingSchema, meetingIdParamSchema } from '../middleware/schemas.js';
import { validateBody, validateParams } from '../middleware/validation.js';

const router = Router();

router.post(
  '/meetings',
  validateBody(createMeetingSchema),
  (req, res, next) => {
    try {
      const { requireApproval } = req.body;

      const room = roomService.createRoom({ requireApproval: requireApproval ?? false });

      res.status(201).json({
        id: room.id,
        url: `/meeting/${room.id}`,
        requiresApproval: room.requireApproval,
      });
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  '/meetings/:id',
  validateParams(meetingIdParamSchema),
  (req, res) => {
    const info = roomService.getPublicInfo(String(req.params.id));
    if (!info) {
      res.status(404).json({ error: 'Meeting not found' });
      return;
    }
    res.json(info);
  },
);

router.get('/config/ice', (_req, res) => {
  res.json({ iceServers: getIceServers() });
});

router.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

export default router;
