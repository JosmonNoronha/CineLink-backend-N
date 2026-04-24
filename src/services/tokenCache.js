const crypto = require('crypto');
const { logger } = require('../utils/logger');

/**
 * Redis-backed token cache service for distributed/horizontal scaling.
 * Tokens are stored with TTL matching JWT expiration to prevent stale caches.
 * Falls back to in-memory cache if Redis is unavailable.
 */

class TokenCacheService {
  constructor(redisClient) {
    this.redis = redisClient;
    this.inMemoryFallback = new Map();
    this.TOKEN_CACHE_PREFIX = 'auth:token:';
    this.TOKEN_REVOCATION_PREFIX = 'auth:revoked:';
    this.FALLBACK_TTL = 5 * 60 * 1000; // 5 minutes for in-memory fallback
  }

  /**
   * Hash token for secure storage
   */
  _hashToken(token) {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  /**
   * Get cached token payload from Redis or in-memory fallback
   */
  async getToken(token) {
    const tokenHash = this._hashToken(token);
    const cacheKey = `${this.TOKEN_CACHE_PREFIX}${tokenHash}`;

    try {
      if (this.redis && this.redis.isReady) {
        const cached = await this.redis.get(cacheKey);
        if (cached) {
          return JSON.parse(cached);
        }
      }
    } catch (error) {
      logger.warn(`Token cache Redis retrieval failed: ${error.message}`);
    }

    // Fallback to in-memory cache
    const fallbackEntry = this.inMemoryFallback.get(tokenHash);
    if (fallbackEntry && Date.now() - fallbackEntry.timestamp < this.FALLBACK_TTL) {
      return fallbackEntry.decoded;
    }

    return null;
  }

  /**
   * Cache token with TTL matching JWT expiration
   */
  async cacheToken(token, decoded) {
    const tokenHash = this._hashToken(token);
    const cacheKey = `${this.TOKEN_CACHE_PREFIX}${tokenHash}`;

    // Calculate TTL based on JWT exp claim
    const expiresIn = Math.max(1, decoded.exp - Math.floor(Date.now() / 1000));

    try {
      if (this.redis && this.redis.isReady) {
        await this.redis.setex(cacheKey, expiresIn, JSON.stringify(decoded));
      }
    } catch (error) {
      logger.warn(`Token cache Redis storage failed: ${error.message}`);
    }

    // Always backup to in-memory cache
    this.inMemoryFallback.set(tokenHash, { decoded, timestamp: Date.now() });

    // Cleanup stale in-memory entries if cache grows too large
    if (this.inMemoryFallback.size > 1000) {
      const now = Date.now();
      let deleted = 0;

      // First pass: delete expired entries
      for (const [key, entry] of this.inMemoryFallback) {
        if (now - entry.timestamp > this.FALLBACK_TTL) {
          this.inMemoryFallback.delete(key);
          deleted++;
        }
      }

      // Second pass: if still over limit, delete oldest entries (FIFO)
      if (this.inMemoryFallback.size > 1000) {
        const entriesToDelete = this.inMemoryFallback.size - 1000;
        const entries = Array.from(this.inMemoryFallback.entries())
          .sort((a, b) => a[1].timestamp - b[1].timestamp)
          .slice(0, entriesToDelete);

        for (const [key] of entries) {
          this.inMemoryFallback.delete(key);
        }
      }
    }
  }

  /**
   * Revoke a token immediately (e.g., on logout)
   */
  async revokeToken(token, decoded) {
    const tokenHash = this._hashToken(token);
    const revocationKey = `${this.TOKEN_REVOCATION_PREFIX}${tokenHash}`;

    // Calculate TTL based on JWT exp
    const expiresIn = Math.max(1, decoded.exp - Math.floor(Date.now() / 1000));

    try {
      if (this.redis && this.redis.isReady) {
        await this.redis.setex(revocationKey, expiresIn, '1');
      }
    } catch (error) {
      logger.warn(`Token revocation Redis storage failed: ${error.message}`);
    }

    // Remove from in-memory cache immediately
    this.inMemoryFallback.delete(tokenHash);
  }

  /**
   * Check if token is revoked
   */
  async isRevoked(token) {
    const tokenHash = this._hashToken(token);
    const revocationKey = `${this.TOKEN_REVOCATION_PREFIX}${tokenHash}`;

    try {
      if (this.redis && this.redis.isReady) {
        const revoked = await this.redis.get(revocationKey);
        return revoked === '1';
      }
    } catch (error) {
      logger.warn(`Token revocation check failed: ${error.message}`);
    }

    return false;
  }

  /**
   * Clear all caches (for testing or explicit cache flush)
   */
  async clear() {
    try {
      if (this.redis && this.redis.isReady) {
        const tokenKeys = await this.redis.keys(`${this.TOKEN_CACHE_PREFIX}*`);
        const revocationKeys = await this.redis.keys(`${this.TOKEN_REVOCATION_PREFIX}*`);
        const allKeys = [...tokenKeys, ...revocationKeys];
        if (allKeys.length > 0) {
          await this.redis.del(...allKeys);
        }
      }
    } catch (error) {
      logger.warn(`Token cache clear failed: ${error.message}`);
    }

    this.inMemoryFallback.clear();
  }

  /**
   * Get cache statistics (for monitoring)
   */
  async getStats() {
    let redisSize = 0;
    try {
      if (this.redis && this.redis.isReady) {
        const tokenKeys = await this.redis.keys(`${this.TOKEN_CACHE_PREFIX}*`);
        const revocationKeys = await this.redis.keys(`${this.TOKEN_REVOCATION_PREFIX}*`);
        redisSize = tokenKeys.length + revocationKeys.length;
      }
    } catch (error) {
      logger.debug(`Could not fetch Redis cache stats: ${error.message}`);
    }

    return {
      redis: {
        available: this.redis && this.redis.isReady,
        size: redisSize,
      },
      inMemory: {
        size: this.inMemoryFallback.size,
      },
    };
  }
}

module.exports = TokenCacheService;
