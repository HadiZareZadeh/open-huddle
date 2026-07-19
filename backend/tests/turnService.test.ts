import { describe, it, expect, vi, afterEach } from 'vitest';
import crypto from 'crypto';
import { generateTurnCredentials, getIceServers } from '../src/services/turnService.js';

describe('turnService', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('generateTurnCredentials', () => {
    it('generates coturn-compatible time-limited credentials', () => {
      vi.stubEnv('TURN_SECRET', 'test-secret');

      const now = 1_700_000_000;
      vi.spyOn(Date, 'now').mockReturnValue(now * 1000);

      const ttl = 3600;
      const { username, credential } = generateTurnCredentials('test-secret', 'video-call', ttl);

      expect(username).toBe(`${now + ttl}:video-call`);

      const expected = crypto
        .createHmac('sha1', 'test-secret')
        .update(username)
        .digest('base64');
      expect(credential).toBe(expected);
    });
  });

  describe('getIceServers', () => {
    it('builds STUN and TURN entries from TURN_* settings', () => {
      vi.stubEnv('TURN_SECRET', 'test-secret');
      vi.stubEnv('TURN_HOST', 'turn.example.com');
      vi.stubEnv('TURN_PORT', '3478');
      vi.stubEnv('TURN_USERNAME', 'video-call');

      const servers = getIceServers();

      expect(servers).toHaveLength(2);
      expect(servers[0]).toEqual({ urls: 'stun:turn.example.com:3478' });
      expect(servers[1]?.urls).toBe('turn:turn.example.com:3478');
      expect(servers[1]?.username).toMatch(/^\d+:video-call$/);
      expect(servers[1]?.credential).toBeTruthy();
    });

    it('returns empty list when TURN is not configured', () => {
      vi.stubEnv('TURN_SECRET', '');

      expect(getIceServers()).toEqual([]);
    });

    it('uses ICE_SERVERS override when set', () => {
      vi.stubEnv('TURN_SECRET', 'test-secret');
      vi.stubEnv(
        'ICE_SERVERS',
        '[{"urls":"stun:custom.example.com:3478"}]',
      );

      expect(getIceServers()).toEqual([{ urls: 'stun:custom.example.com:3478' }]);
    });
  });
});
