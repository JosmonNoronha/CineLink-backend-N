const createMockReq = (authorization) => ({
  headers: authorization ? { authorization } : {},
  path: '/api/user/profile',
});

const createNext = () => jest.fn();

const mockVerifyIdToken = jest.fn();
const mockGetAuth = jest.fn(() => ({ verifyIdToken: mockVerifyIdToken }));
const mockGetRedisClient = jest.fn(() => null);
const mockTokenCache = {
  getToken: jest.fn(),
  isRevoked: jest.fn(),
  cacheToken: jest.fn(),
  revokeToken: jest.fn(),
};

jest.mock('../src/config/firebase', () => ({
  getAuth: () => mockGetAuth(),
}));

jest.mock('../src/config/redis', () => ({
  getRedisClient: () => mockGetRedisClient(),
}));

jest.mock('../src/services/tokenCache', () => jest.fn().mockImplementation(() => mockTokenCache));

const { authMiddleware, optionalAuth } = require('../src/middleware/auth');

describe('authMiddleware', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockTokenCache.getToken.mockReset();
    mockTokenCache.isRevoked.mockReset();
    mockTokenCache.cacheToken.mockReset();
    mockVerifyIdToken.mockReset();
  });

  it('rejects missing bearer token', async () => {
    const req = createMockReq();
    const next = createNext();

    await authMiddleware(req, {}, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0]).toMatchObject({
      statusCode: 401,
      code: 'UNAUTHORIZED',
    });
  });

  it('uses cached token when available', async () => {
    const cachedClaims = {
      uid: 'user-1',
      email: 'user@example.com',
      name: 'User One',
      admin: true,
    };
    mockTokenCache.getToken.mockResolvedValue(cachedClaims);
    mockTokenCache.isRevoked.mockResolvedValue(false);

    const req = createMockReq('Bearer cached-token');
    const next = createNext();

    await authMiddleware(req, {}, next);

    expect(mockTokenCache.getToken).toHaveBeenCalledWith('cached-token');
    expect(mockTokenCache.isRevoked).toHaveBeenCalledWith('cached-token');
    expect(mockVerifyIdToken).not.toHaveBeenCalled();
    expect(req.user).toMatchObject({
      uid: 'user-1',
      email: 'user@example.com',
      roles: ['admin'],
    });
    expect(req.user.permissions).toEqual(expect.arrayContaining(['admin:all', 'content:moderate']));
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('re-verifies revoked cached token', async () => {
    mockTokenCache.getToken.mockResolvedValue({ uid: 'user-1', admin: false });
    mockTokenCache.isRevoked.mockResolvedValue(true);
    mockVerifyIdToken.mockResolvedValue({
      uid: 'user-2',
      email: 'fresh@example.com',
      moderator: true,
    });

    const req = createMockReq('Bearer fresh-token');
    const next = createNext();

    await authMiddleware(req, {}, next);

    expect(mockTokenCache.getToken).toHaveBeenCalledWith('fresh-token');
    expect(mockTokenCache.isRevoked).toHaveBeenCalledWith('fresh-token');
    expect(mockVerifyIdToken).toHaveBeenCalledWith('fresh-token');
    expect(mockTokenCache.cacheToken).toHaveBeenCalledWith('fresh-token', {
      uid: 'user-2',
      email: 'fresh@example.com',
      moderator: true,
    });
    expect(req.user.roles).toEqual(['moderator']);
    expect(req.user.permissions).toEqual(expect.arrayContaining(['content:moderate']));
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('maps Firebase config errors to AUTH_CONFIG_ERROR', async () => {
    mockTokenCache.getToken.mockResolvedValue(null);
    mockVerifyIdToken.mockRejectedValue(new Error('app/invalid-credential'));

    const req = createMockReq('Bearer broken-token');
    const next = createNext();

    await authMiddleware(req, {}, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0]).toMatchObject({
      statusCode: 500,
      code: 'AUTH_CONFIG_ERROR',
    });
  });

  it('maps Firebase verification failures to UNAUTHORIZED', async () => {
    mockTokenCache.getToken.mockResolvedValue(null);
    mockVerifyIdToken.mockRejectedValue(new Error('Invalid signature'));

    const req = createMockReq('Bearer invalid-token');
    const next = createNext();

    await authMiddleware(req, {}, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0]).toMatchObject({
      statusCode: 401,
      code: 'UNAUTHORIZED',
    });
  });
});

describe('optionalAuth', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockTokenCache.getToken.mockReset();
    mockTokenCache.isRevoked.mockReset();
    mockTokenCache.cacheToken.mockReset();
    mockVerifyIdToken.mockReset();
  });

  it('allows requests without token', async () => {
    const req = createMockReq();
    const next = createNext();

    await optionalAuth(req, {}, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.user).toBeUndefined();
  });

  it('hydrates user from verified token', async () => {
    mockTokenCache.getToken.mockResolvedValue(null);
    mockVerifyIdToken.mockResolvedValue({
      uid: 'user-3',
      email: 'optional@example.com',
      admin: true,
    });

    const req = createMockReq('Bearer optional-token');
    const next = createNext();

    await optionalAuth(req, {}, next);

    expect(mockVerifyIdToken).toHaveBeenCalledWith('optional-token');
    expect(mockTokenCache.cacheToken).toHaveBeenCalledWith('optional-token', {
      uid: 'user-3',
      email: 'optional@example.com',
      admin: true,
    });
    expect(req.user.roles).toEqual(['admin']);
    expect(next).toHaveBeenCalledTimes(1);
  });
});
