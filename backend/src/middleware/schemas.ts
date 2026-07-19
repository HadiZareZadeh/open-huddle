import { z } from 'zod';

export const createMeetingSchema = z.object({
  requireApproval: z.boolean().optional(),
});

export const meetingIdParamSchema = z.object({
  id: z.string().regex(/^[0-9A-Za-z]{12}$/, 'Invalid meeting ID'),
});

export const chatMessageSchema = z.object({
  text: z.string().min(1).max(2000).trim(),
});

export type CreateMeetingBody = z.infer<typeof createMeetingSchema>;
export type ChatMessageBody = z.infer<typeof chatMessageSchema>;
