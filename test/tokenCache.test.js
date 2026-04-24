const TokenCacheService = require('../src/services/tokenCache');

describe('TokenCacheService', () => {
  const mockToken =
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1aWQiOiJ1c2VyMTIzIiwibmFtZSI6IkpvaG4iLCJleHAiOjk5OTk5OTk5OTl9.sig';

  const mockDecoded = {
    uid: 'user123',
    email: 'user@example.com',
    name: 'John Doe',
    picture: 'https://example.com/pic.jpg',
    exp: Math.floor(Date.now() / 1000) + 3600, // 1 hour from now
  };

  describe('with mock Redis client', () => {
    let mockRedisClient;
    let service;

    beforeEach(() => {
      mockRedisClient = {
        isReady: true,
        get: jest.fn(),
        setex: jest.fn(),
        del: jest.fn(),
        keys: jest.fn(),
      };

      service = new TokenCacheService(mockRedisClient);
    });

    it('caches token with TTL matching JWT expiration', async () => {
      mockRedisClient.setex.mockResolvedValue('OK');

      await service.cacheToken(mockToken, mockDecoded);

      expect(mockRedisClient.setex).toHaveBeenCalled();
      const [key, ttl, value] = mockRedisClient.setex.mock.calls[0];
      expect(key).toContain('auth:token:');
      expect(Number(ttl)).toBeGreaterThan(0);
      expect(JSON.parse(value)).toEqual(mockDecoded);
    });

    it('retrieves cached token from Redis', async () => {
      const cachedValue = JSON.stringify(mockDecoded);
      mockRedisClient.get.mockResolvedValue(cachedValue);

      const result = await service.getToken(mockToken);

      expect(mockRedisClient.get).toHaveBeenCalled();
      expect(result).toEqual(mockDecoded);
    });

    it('returns null for non-existent token', async () => {
      mockRedisClient.get.mockResolvedValue(null);

      const result = await service.getToken('nonexistent');

      expect(result).toBeNull();
    });

    it('revokes token by adding to revocation set', async () => {
      mockRedisClient.setex.mockResolvedValue('OK');

      await service.revokeToken(mockToken, mockDecoded);

      expect(mockRedisClient.setex).toHaveBeenCalled();
      const [key, ttl] = mockRedisClient.setex.mock.calls[0];
      expect(key).toContain('auth:revoked:');
      expect(Number(ttl)).toBeGreaterThan(0);
    });

    it('detects revoked tokens', async () => {
      // Mock Redis get to return '1' when checking revocation key
      mockRedisClient.get.mockResolvedValue('1');

      const isRevoked = await service.isRevoked(mockToken);

      expect(isRevoked).toBe(true);
      expect(mockRedisClient.get).toHaveBeenCalledWith(expect.stringContaining('auth:revoked:'));
    });

    it('falls back to in-memory cache on Redis failure', async () => {
      mockRedisClient.get.mockRejectedValue(new Error('Redis timeout'));

      await service.cacheToken(mockToken, mockDecoded);
      const result = await service.getToken(mockToken);

      expect(result).toEqual(mockDecoded);
    });

    it('clears all caches', async () => {
      mockRedisClient.keys.mockResolvedValueOnce(['key1']).mockResolvedValueOnce(['key2']);
      mockRedisClient.del.mockResolvedValue(2);

      await service.clear();

      expect(mockRedisClient.del).toHaveBeenCalled();
    });

    it('returns cache statistics', async () => {
      mockRedisClient.keys.mockResolvedValueOnce(['key1', 'key2']).mockResolvedValueOnce(['key3']);

      const stats = await service.getStats();

      expect(stats.redis.available).toBe(true);
      expect(stats.redis.size).toBe(3);
      expect(typeof stats.inMemory.size).toBe('number');
    });
  });

  describe('with no Redis client (fallback mode)', () => {
    let service;

    beforeEach(() => {
      service = new TokenCacheService(null);
    });

    it('uses in-memory cache when Redis is unavailable', async () => {
      await service.cacheToken(mockToken, mockDecoded);
      const result = await service.getToken(mockToken);

      expect(result).toEqual(mockDecoded);
    });

    it('clears in-memory cache', async () => {
      await service.cacheToken(mockToken, mockDecoded);
      await service.clear();
      const result = await service.getToken(mockToken);

      expect(result).toBeNull();
    });

    it('respects in-memory TTL', async () => {
      await service.cacheToken(mockToken, mockDecoded);

      // Simulate time passing beyond fallback TTL
      jest.useFakeTimers();
      jest.advanceTimersByTime(6 * 60 * 1000); // 6 minutes

      const result = await service.getToken(mockToken);

      expect(result).toBeNull();
      jest.useRealTimers();
    });

    it('revokes token from in-memory cache', async () => {
      await service.cacheToken(mockToken, mockDecoded);
      await service.revokeToken(mockToken, mockDecoded);

      const result = await service.getToken(mockToken);
      expect(result).toBeNull();
    });
  });

  describe('with Redis client that becomes unavailable', () => {
    let mockRedisClient;
    let service;

    beforeEach(() => {
      mockRedisClient = {
        isReady: false,
        get: jest.fn(),
        setex: jest.fn(),
      };

      service = new TokenCacheService(mockRedisClient);
    });

    it('falls back to in-memory cache', async () => {
      await service.cacheToken(mockToken, mockDecoded);
      const result = await service.getToken(mockToken);

      expect(result).toEqual(mockDecoded);
      expect(mockRedisClient.setex).not.toHaveBeenCalled();
    });
  });

  describe('token hash consistency', () => {
    let service;

    beforeEach(() => {
      service = new TokenCacheService(null);
    });

    it('generates consistent hash for same token', () => {
      const hash1 = service._hashToken(mockToken);
      const hash2 = service._hashToken(mockToken);

      expect(hash1).toBe(hash2);
    });

    it('generates different hashes for different tokens', () => {
      const hash1 = service._hashToken(mockToken);
      const hash2 = service._hashToken('differenttoken');

      expect(hash1).not.toBe(hash2);
    });
  });

  describe('in-memory cache size limits', () => {
    let service;

    beforeEach(() => {
      service = new TokenCacheService(null);
    });

    it('limits in-memory cache to 1000 entries with FIFO cleanup', async () => {
      // Add 1001 tokens
      for (let i = 0; i < 1001; i++) {
        const token = `token${i}`;
        const decoded = { ...mockDecoded, uid: `user${i}` };
        await service.cacheToken(token, decoded);
      }

      // Cache should be cleaned up to <= 1000 entries
      expect(service.inMemoryFallback.size).toBeLessThanOrEqual(1000);

      // Verify oldest entries were removed (first added token should be gone)
      const firstTokenHash = service._hashToken('token0');
      expect(service.inMemoryFallback.has(firstTokenHash)).toBe(false);
    });
  });
});
