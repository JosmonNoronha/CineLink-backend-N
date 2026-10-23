const mockVerify = jest.fn();
jest.mock('../src/config/firebase', () => ({ getAuth: () => ({ verifyIdToken: mockVerify }) }));
jest.mock('../src/utils/logger', () => ({ logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() } }));

const { requirePermission, _resetForTests } = require('../src/middleware/rbac');

const run = async (perm, perms, token = 'tok') => {
  const next = jest.fn();
  await requirePermission(perm)(
    { user: { permissions: perms }, headers: token ? { authorization: `Bearer ${token}` } : {} },
    {},
    next,
  );
  return next.mock.calls[0][0];
};

beforeEach(() => {
  mockVerify.mockReset().mockResolvedValue({});
  _resetForTests();
});

describe('requirePermission', () => {
  test('ordinary permissions do not call Firebase', async () => {
    expect(await run('user:read', ['user:read'])).toBeUndefined();
    expect(mockVerify).not.toHaveBeenCalled();
  });

  test('missing permission is 403 without calling Firebase', async () => {
    expect(await run('admin:all', ['user:read'])).toMatchObject({ statusCode: 403 });
    expect(mockVerify).not.toHaveBeenCalled();
  });

  test('admin permission re-checks the token for revocation', async () => {
    expect(await run('admin:all', ['admin:all'])).toBeUndefined();
    expect(mockVerify).toHaveBeenCalledWith('tok', true);
  });

  test('the check is remembered for a minute, per token', async () => {
    await run('content:moderate', ['content:moderate']);
    await run('content:moderate', ['content:moderate']);
    expect(mockVerify).toHaveBeenCalledTimes(1);
    await run('content:moderate', ['content:moderate'], 'other');
    expect(mockVerify).toHaveBeenCalledTimes(2);
  });

  test('a revoked or disabled admin is refused, and not remembered', async () => {
    mockVerify.mockRejectedValue({ code: 'auth/id-token-revoked' });
    expect(await run('admin:all', ['admin:all'])).toMatchObject({ statusCode: 401, code: 'TOKEN_REVOKED' });
    mockVerify.mockRejectedValue({ code: 'auth/user-disabled' });
    expect(await run('admin:all', ['admin:all'])).toMatchObject({ code: 'TOKEN_REVOKED' });
  });

  test('revocation is noticed after the minute passes', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-01-01T00:00:00Z'));
    await run('admin:all', ['admin:all']);
    jest.setSystemTime(new Date('2026-01-01T00:01:01Z'));
    mockVerify.mockRejectedValue({ code: 'auth/id-token-revoked' });
    expect(await run('admin:all', ['admin:all'])).toMatchObject({ code: 'TOKEN_REVOKED' });
    jest.useRealTimers();
  });

  test('when Firebase cannot be reached, privileged actions fail closed with 503', async () => {
    mockVerify.mockRejectedValue(new Error('network down'));
    expect(await run('admin:all', ['admin:all'])).toMatchObject({ statusCode: 503, code: 'AUTH_UNAVAILABLE' });
  });

  test('no bearer header on a privileged route is 401', async () => {
    expect(await run('admin:all', ['admin:all'], null)).toMatchObject({ statusCode: 401 });
  });
});
