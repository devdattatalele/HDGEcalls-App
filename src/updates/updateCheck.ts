import * as Application from 'expo-application';

/**
 * Public releases-only repo. Source lives in the private HDGEcalls-App repo;
 * built APKs are mirrored here so anonymous downloads work and the in-app
 * banner can fetch release metadata without a token.
 */
export const GITHUB_REPO = 'devdattatalele/HDGEcalls-releases';

export interface AvailableRelease {
  tag: string;
  name: string;
  apkUrl: string;
  htmlUrl: string;
  bodyMarkdown: string;
}

interface GhReleaseAsset {
  name: string;
  browser_download_url: string;
  content_type: string;
}

interface GhRelease {
  tag_name: string;
  name: string;
  draft: boolean;
  prerelease: boolean;
  html_url: string;
  body: string;
  assets: GhReleaseAsset[];
}

/**
 * Parse a semver-ish tag like "v0.3.1" or "0.3.1" into [major, minor, patch].
 * Anything non-numeric is treated as 0. Trailing labels (-beta) are dropped.
 */
function parseVersion(raw: string): [number, number, number] {
  const s = raw.replace(/^v/i, '').split('-')[0].split('+')[0];
  const parts = s.split('.').map((p) => parseInt(p, 10) || 0);
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
}

/** Returns true when `b` is strictly newer than `a`. */
export function isNewer(a: string, b: string): boolean {
  const [a0, a1, a2] = parseVersion(a);
  const [b0, b1, b2] = parseVersion(b);
  if (b0 !== a0) return b0 > a0;
  if (b1 !== a1) return b1 > a1;
  return b2 > a2;
}

/**
 * Hit GitHub's releases/latest endpoint. Returns null when there's no
 * release newer than the currently installed app version (or when the call
 * fails — never throw upward; an update check failing should be silent).
 */
export async function checkForApkUpdate(): Promise<AvailableRelease | null> {
  const current = Application.nativeApplicationVersion;
  if (!current) return null;

  try {
    const res = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`,
      { headers: { Accept: 'application/vnd.github+json' } },
    );
    if (!res.ok) return null;
    const release = (await res.json()) as GhRelease;
    if (release.draft || release.prerelease) return null;
    if (!isNewer(current, release.tag_name)) return null;

    const apkAsset = release.assets.find(
      (a) =>
        a.name.toLowerCase().endsWith('.apk') ||
        a.content_type === 'application/vnd.android.package-archive',
    );
    if (!apkAsset) return null;

    return {
      tag: release.tag_name,
      name: release.name || release.tag_name,
      apkUrl: apkAsset.browser_download_url,
      htmlUrl: release.html_url,
      bodyMarkdown: release.body ?? '',
    };
  } catch {
    return null;
  }
}
