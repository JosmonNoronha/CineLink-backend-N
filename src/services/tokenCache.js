const crypto = require('crypto');
const { logger } = require('../utils/logger');

/**
 * Redis-backed token cache service for distributed/horizontal scaling.
 * Tokens are stored with TTL matching JWT expiration to prevent stale caches.
 * Falls back to in-memory cache if Redis is unavailable.
 */

class TokenCacheService {
  /**
   * @param redisClient a client, or (preferred) a function returning the current client.
   *   A function is called on every use, so a reconnect can never leave this holding a dead client.
   */
  constructor(redisClient) {
    this._redisSource = redisClient;
    this.inMemoryFallback = new Map();
    this.TOKEN_CACHE_PREFIX = 'auth:token:';
    this.TOKEN_REVOCATION_PREFIX = 'auth:revoked:';
    this.FALLBACK_TTL = 5 * 60 * 1000; // 5 minutes for in-memory fallback
    this.DELETED_USER_PREFIX = 'auth:deleted:';
    this.DELETED_TTL_SECONDS = 2 * 60 * 60; // longer than a Firebase ID token lives (1 hour)
    this.deletedUsers = new Map(); // uid -> expiry timestamp (ms)
  }

  /**
   * Remember that an account was deleted, so ID tokens issued before the deletion stop working
   * straight away instead of lasting until they expire.
   */
  async markUserDeleted(uid) {
    if (!uid) return;
    this.deletedUsers.set(uid, Date.now() + this.DELETED_TTL_SECONDS * 1000);
    try {
      if (this.redis && this.redis.isReady) {
        await this.redis.set(`${this.DELETED_USER_PREFIX}${uid}`, '1', { EX: this.DELETED_TTL_SECONDS });
      }
    } catch (error) {
      logger.warn(`Deleted-user marker Redis write failed: ${error.message}`);
    }
  }

  async isUserDeleted(uid) {
    if (!uid) return false;
    const until = this.deletedUsers.get(uid);
    if (until) {
      if (until > Date.now()) return true;
      this.deletedUsers.delete(uid);
    }
    try {
      if (this.redis && this.redis.isReady) {
        return (await this.redis.exists(`${this.DELETED_USER_PREFIX}${uid}`)) > 0;
      }
    } catch (error) {
      logger.warn(`Deleted-user marker Redis read failed: ${error.message}`);
    }
    return false;
  }

  get redis() {
    return typeof this._redisSource === 'function' ? this._redisSource() : this._redisSource;
  }

  set redis(value) {
    this._redisSource = value;
  }

  /** Every key under a prefix, using SCAN (KEYS blocks the server and is discouraged on hosted Redis). */
  async _keysWithPrefix(prefix) {
    const client = this.redis;
    const out = [];
    for await (const batch of client.scanIterator({ MATCH: `${prefix}*`, COUNT: 200 })) {
      if (Array.isArray(batch)) out.push(...batch);
      else out.push(batch);
    }
    return out;
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
        await this.redis.set(cacheKey, JSON.stringify(decoded), { EX: expiresIn });
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
        await this.redis.set(revocationKey, '1', { EX: expiresIn });
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
        const tokenKeys = await this._keysWithPrefix(this.TOKEN_CACHE_PREFIX);
        const revocationKeys = await this._keysWithPrefix(this.TOKEN_REVOCATION_PREFIX);
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
        const tokenKeys = await this._keysWithPrefix(this.TOKEN_CACHE_PREFIX);
        const revocationKeys = await this._keysWithPrefix(this.TOKEN_REVOCATION_PREFIX);
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
