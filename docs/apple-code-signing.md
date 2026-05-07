# Apple Code Signing & Notarization Setup

How to make the Mac app open without the "damaged" / "unidentified developer" warning.

## The mental model

| Step | What it is | What it accomplishes |
|------|-----------|---------------------|
| 1. Membership ($99/year) | Apple Developer Program enrollment | Lets you generate certificates and submit to notarization |
| 2. Code Signing | Cryptographically tagging the app with a Developer ID certificate | Stops the "damaged" message; downgrades to a milder warning |
| 3. Notarization | Uploading the signed DMG to Apple, who scan it and issue a ticket | No warning at all — app opens like any other |

After all three, plus stapling the notarization ticket, customers just double-click and it works.

## Account details

- **Team ID:** `HPUYKW68K5`
- **Program:** Apple Developer Program
- **Enrolled as:** Individual

## Credentials

- **Signing Identity:** `Developer ID Application: Ore Phillips (HPUYKW68K5)`
- **Notarization Key ID:** `8J3Z83S84U`
- **Notarization Issuer ID:** `6eaddcc4-f91a-4f55-af04-6321ea4fadba`
- **API Key file:** `AuthKey_8J3Z83S84U.p8`

## Current status

- [x] Paid $99 (Apple Developer Program membership active)
- [x] Team ID obtained: `HPUYKW68K5`
- [x] Generated Developer ID Application certificate
- [x] Configured Tauri to sign with it (`tauri.conf.json` + `entitlements.plist`)
- [x] Set up notarization credentials (API key generated)
- [ ] GitHub secrets configured
- [ ] Submitted DMG to notarization + stapled ticket

---

## Step 1: Install Xcode

Required for the certificate tooling.

1. Open the Mac App Store, search for **Xcode**, install it (~15 GB)
2. After install, open Xcode once and accept the license terms

---

## Step 2: Find your Team ID

1. Go to https://developer.apple.com/account
2. Click **Membership Details**
3. Note your **Team ID** — a 10-character code like `ABCD123456`

---

## Step 3: Generate the Developer ID Application certificate

1. Open **Xcode** > Settings (Cmd+,) > **Accounts**
2. Click **+** in the bottom left, sign in with the Apple ID tied to the developer account
3. Select your team in the right pane > click **Manage Certificates...**
4. Click **+** in the bottom left of the certificates dialog > choose **Developer ID Application**
5. Close the dialog. The certificate is now in your login Keychain.

Verify it worked:

```bash
security find-identity -v -p codesigning
```

You should see:

```
1) ABCDEF1234... "Developer ID Application: Your Name (ABCD123456)"
```

Copy that full string in quotes — you'll paste it into `tauri.conf.json`.

---

## Step 4: Set up notarization credentials

We use an **App Store Connect API key** (more reliable than app-specific passwords, doesn't expire).

1. Go to https://appstoreconnect.apple.com
2. **Users and Access** > **Integrations** > **App Store Connect API**
3. Click **Generate API Key** (or +)
4. Name it `Notarization`, assign **Developer** role
5. Click **Generate**
6. **Download the .p8 file** — you can only do this once. Save it like `~/keys/AuthKey_XXXXXXXX.p8`
7. Note the **Key ID** (10 characters, shown next to the key)
8. Note the **Issuer ID** (a UUID shown at the top of the API Keys page)

Register these with macOS:

```bash
xcrun notarytool store-credentials "notarytool-profile" \
  --key ~/keys/AuthKey_XXXXXXXX.p8 \
  --key-id XXXXXXXXXX \
  --issuer xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
```

macOS stores them securely in the Keychain under the profile name `notarytool-profile`.

---

## Step 5: Configure Tauri to sign + notarize

Already done in this repo:

- `src-tauri/tauri.conf.json` has the `bundle.macOS` section with `signingIdentity` placeholder
- `src-tauri/entitlements.plist` has the minimum entitlements for a Tauri WebView app

**Update `tauri.conf.json`**: Replace `SIGNING_IDENTITY_HERE` with your actual signing identity string from Step 3.

---

## Step 6: Build, notarize, staple

Set environment variables:

```bash
export APPLE_SIGNING_IDENTITY="Developer ID Application: Your Name (TEAMID)"
export APPLE_API_ISSUER="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
export APPLE_API_KEY="XXXXXXXXXX"
export APPLE_API_KEY_PATH="$HOME/keys/AuthKey_XXXXXXXX.p8"
```

Then build:

```bash
npm run tauri build
```

Tauri will sign the app, submit the DMG to Apple, wait for the verdict (~2-10 min), and staple the ticket.

### Manual approach (first time, to verify each step)

```bash
# 1. Build (signs automatically using config)
npm run tauri build

# 2. Submit for notarization
xcrun notarytool submit \
  "src-tauri/target/release/bundle/dmg/MyAIforOne.Lite_X.X.X_aarch64.dmg" \
  --keychain-profile "notarytool-profile" \
  --wait

# 3. Staple the ticket so the DMG works offline
xcrun stapler staple \
  "src-tauri/target/release/bundle/dmg/MyAIforOne.Lite_X.X.X_aarch64.dmg"

# 4. Verify
spctl -a -t open --context context:primary-signature -v \
  "src-tauri/target/release/bundle/dmg/MyAIforOne.Lite_X.X.X_aarch64.dmg"
```

Expected results:
- `notarytool submit --wait` -> `status: Accepted`
- `stapler staple` -> `The staple and validate action worked!`
- `spctl -a -v` -> `accepted` and `source=Notarized Developer ID`

---

## Troubleshooting

**Notarization fails** — get the detailed log:

```bash
xcrun notarytool log <submission-id> --keychain-profile notarytool-profile
```

Common causes:
- Missing hardened runtime -> already set in `tauri.conf.json`
- Unsigned helper binary inside the bundle -> sign manually with `codesign --deep`
- A dylib needing a specific entitlement -> add it to `entitlements.plist`

**"Developer cannot be verified" still showing** — either forgot to staple, or customer downloaded before the stapled version was uploaded.

---

## What customers see at each stage

| Stage | Customer experience |
|-------|-------------------|
| No signing (current state) | "App is damaged and can't be opened" — most users bail |
| Signed only | "App can't be verified" — right-click > Open works |
| Signed + notarized + stapled | App opens normally, no warning |

---

## Future releases

Once setup is complete, every new release is just `npm run tauri build`. Worth wiring into GitHub Actions so releases are reproducible.
