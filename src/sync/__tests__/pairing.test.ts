import {
  APP_DIAL_RETENTION_MS,
  isAppInitiated,
  sameNumber,
  type AppDial,
} from '../appDials';
import type { NormalizedCallLogEntry } from '../callLog';

const BASE = new Date('2026-06-11T10:00:00.000Z').getTime();

function call(
  overrides: Partial<NormalizedCallLogEntry>,
): NormalizedCallLogEntry {
  return {
    callLogId: 'call-1',
    phoneNumber: '9876543210',
    contactName: null,
    direction: 'outgoing',
    startedAtMs: BASE,
    durationSec: 60,
    ...overrides,
  };
}

function dial(overrides: Partial<AppDial> = {}): AppDial {
  return {
    phoneDigits: '9876543210',
    dialedAtMs: BASE,
    ...overrides,
  };
}

describe('phone suffix matcher', () => {
  it('normalizes whitespace, leading plus, country code 91, and suffixes', () => {
    expect(sameNumber('+91 98765 43210', '9876543210')).toBe(true);
    expect(sameNumber('98765 43210', '9876543210')).toBe(true);
    expect(sameNumber('+919876543210', '9876543210')).toBe(true);
    expect(sameNumber('+91 98765 43210', '09876543210')).toBe(true);
    expect(sameNumber('9876543210', '09876543210')).toBe(true);
    expect(sameNumber('1234567890', '9876543210')).toBe(false);
  });
});

describe('isAppInitiated', () => {
  it('matches an outgoing call within the 60s app-dial window', () => {
    const result = isAppInitiated(
      call({ startedAtMs: BASE + 30_000 }),
      [dial()],
    );

    expect(result).toEqual(dial());
  });

  it('matches an outgoing call at exactly +60s', () => {
    const result = isAppInitiated(
      call({ startedAtMs: BASE + 60_000 }),
      [dial()],
    );

    expect(result).toEqual(dial());
  });

  it('rejects an outgoing call at exactly +61s', () => {
    const result = isAppInitiated(
      call({ startedAtMs: BASE + 61_000 }),
      [dial()],
    );

    expect(result).toBeNull();
  });

  it('matches an incoming callback within 24h of the app-dial', () => {
    const result = isAppInitiated(
      call({
        direction: 'incoming',
        startedAtMs: BASE + 23 * 60 * 60 * 1000,
      }),
      [dial()],
    );

    expect(result).toEqual(dial());
  });

  it('rejects an incoming callback at 24h + 1min', () => {
    const result = isAppInitiated(
      call({
        direction: 'incoming',
        startedAtMs: BASE + APP_DIAL_RETENTION_MS + 60_000,
      }),
      [dial()],
    );

    expect(result).toBeNull();
  });

  it('skips a dial that has already been marked as matched', () => {
    const consumed: AppDial = {
      ...dial(),
      matchedCallLogId: 'previous-call',
    };
    const result = isAppInitiated(
      call({ startedAtMs: BASE + 30_000 }),
      [consumed],
    );

    expect(result).toBeNull();
  });

  it('reuses the same unmatched app-dial if the pure matcher is called twice', () => {
    const appDial = dial();
    const first = isAppInitiated(
      call({ callLogId: 'incoming-1', direction: 'incoming', startedAtMs: BASE + 60_000 }),
      [appDial],
    );
    const second = isAppInitiated(
      call({ callLogId: 'incoming-2', direction: 'incoming', startedAtMs: BASE + 120_000 }),
      [appDial],
    );

    // Current behavior: consumption happens later through markDialMatched(),
    // not inside this pure matcher, so both calls can claim the same dial.
    expect(first).toEqual(appDial);
    expect(second).toEqual(appDial);
  });

  it('rejects an outgoing call with no matching app-dial', () => {
    const result = isAppInitiated(
      call({ phoneNumber: '9123456789' }),
      [dial({ phoneDigits: '9876543210' })],
    );

    expect(result).toBeNull();
  });

  it('does not consider an incoming app-dial older than the retention horizon', () => {
    const result = isAppInitiated(
      call({ direction: 'incoming', startedAtMs: BASE }),
      [dial({ dialedAtMs: BASE - APP_DIAL_RETENTION_MS - 1 })],
    );

    expect(result).toBeNull();
  });

  it('handles Indian suffix-match edge cases', () => {
    expect(
      isAppInitiated(
        call({ phoneNumber: '+919876543210' }),
        [dial({ phoneDigits: '9876543210' })],
      ),
    ).toEqual(dial({ phoneDigits: '9876543210' }));

    expect(
      isAppInitiated(
        call({ phoneNumber: '09876543210' }),
        [dial({ phoneDigits: '+919876543210' })],
      ),
    ).toEqual(dial({ phoneDigits: '+919876543210' }));

    expect(
      isAppInitiated(
        call({ phoneNumber: '9876543210' }),
        [dial({ phoneDigits: '1234567890' })],
      ),
    ).toBeNull();
  });
});
