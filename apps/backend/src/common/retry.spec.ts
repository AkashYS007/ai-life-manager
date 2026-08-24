import { withRetry, DeliveryHttpError, isRetryableHttpError } from './retry';

// Pure logic, no Prisma/DB needed — same "highest-value thing to actually
// unit test" call as zoned-day.spec.ts. This is the one piece of the
// delivery-retry increment that isn't itself an external network call, so
// it's the one piece that actually can be exercised deterministically here.
describe('withRetry', () => {
  it('returns the result on the first success without retrying', async () => {
    const fn = jest.fn().mockResolvedValue('ok');
    const result = await withRetry(fn, { attempts: 3, baseDelayMs: 1 });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries after a failure and succeeds on a later attempt', async () => {
    const fn = jest
      .fn()
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValueOnce('ok');
    const result = await withRetry(fn, { attempts: 3, baseDelayMs: 1 });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('throws the last error once every attempt is exhausted', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('still failing'));
    await expect(withRetry(fn, { attempts: 3, baseDelayMs: 1 })).rejects.toThrow('still failing');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('fails fast without exhausting attempts when shouldRetry returns false', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('permanent'));
    await expect(
      withRetry(fn, { attempts: 3, baseDelayMs: 1, shouldRetry: () => false }),
    ).rejects.toThrow('permanent');
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe('isRetryableHttpError', () => {
  it('retries a 5xx DeliveryHttpError', () => {
    expect(isRetryableHttpError(new DeliveryHttpError('server error', 503))).toBe(true);
  });

  it('does not retry a 4xx DeliveryHttpError', () => {
    expect(isRetryableHttpError(new DeliveryHttpError('bad request', 400))).toBe(false);
  });

  it('retries a plain thrown error (e.g. a network failure with no status)', () => {
    expect(isRetryableHttpError(new Error('fetch failed'))).toBe(true);
  });
});
