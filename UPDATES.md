# HDGEcalls — Update workflow

The app has two update channels. **JS-only changes** ship over-the-air via
EAS Update (no APK reinstall). **Native or permission changes** require a new
APK; the in-app banner notifies users when one is published on GitHub.

## One-time setup (only the first time)

### A. Releases-only public repo

Source code lives in **private** `devdattatalele/HDGEcalls-App`. Built APKs
get mirrored to **public** `devdattatalele/HDGEcalls-releases` so anonymous
testers can download without a GitHub login.

1. Create the public repo at https://github.com/new — name it
   `HDGEcalls-releases`, visibility **Public**, leave it empty (no README).
2. Generate a fine-grained PAT at
   https://github.com/settings/personal-access-tokens/new:
   - Repository access: only `devdattatalele/HDGEcalls-releases`
   - Permissions → Contents: **Read and write**
   - Expiration: as long as you want (1 year is fine)
   - Copy the token.
3. In **HDGEcalls-App** (the private source repo) → Settings → Secrets and
   variables → Actions → New repository secret:
   - Name: `RELEASES_REPO_TOKEN`
   - Value: the PAT from step 2

### B. (Optional) Supabase env vars

If you ever stop committing `.env`, add these as Actions secrets too:
`EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`. Skip until then.

## A. JS-only updates (most changes)

```bash
# from your laptop, after committing & testing locally
eas update --branch production --message "tweak: <short summary>"
```

Installed users get the new bundle on the next app launch. No store, no APK.

The first time you do this, you'll need `eas login` (once) and
`npx expo install expo-updates` is already in. The EAS endpoint is baked
into `app.json` (`expo.updates.url`).

## B. APK updates (native / permission changes)

For changes that touch `android/`, `app.json`'s `android.permissions`, or any
native module, ship a new APK:

```bash
# bump the version in app.json
# "android": { "versionCode": <prev>+1 }, "version": "0.3.0"

git commit -am "release 0.3.0"
git tag v0.3.0
git push --tags
```

The `Build & Release APK` GitHub Action picks up the tag, builds an APK on
Ubuntu runners with debug signing (matches local builds), and creates a
GitHub Release with the APK attached.

Inside the app, `src/updates/updateCheck.ts` polls
`https://api.github.com/repos/<owner>/<repo>/releases/latest` on launch. When
the latest tag is semver-newer than `Application.nativeApplicationVersion`,
a brand-green banner appears at the bottom of the screen. Tapping it opens
the APK download URL in the browser; the user accepts Android's
"Install unknown app" prompt and installs.

### Manual trigger

The workflow also supports `workflow_dispatch` — go to **Actions → Build &
Release APK → Run workflow** and provide a tag like `v0.3.0`. Useful for
re-running a release if the first attempt failed.

## Verifying

After publishing:

- **EAS Update**: open the app while connected to wifi. Force-quit, reopen.
  Your changes should be live. Check the EAS dashboard for delivery stats.
- **APK release**: open the app. Within a couple of seconds the banner
  appears (assuming `GITHUB_REPO` is correct and the release isn't a
  draft/prerelease).

## Local builds

Independent of all the above, you can still build locally:

```bash
cd android && ./gradlew assembleRelease
# APK lands at android/app/build/outputs/apk/release/app-release.apk
```

These do **not** appear on the in-app banner — only GitHub Releases do.
