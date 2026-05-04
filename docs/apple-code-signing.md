# Apple Code Signing — Next Steps

> Prerequisite: Apple Developer Program enrollment ($99) — DONE, waiting for approval.
> Once approved, follow these steps in order.

---

## Step 1: Create Certificates

1. Go to https://developer.apple.com/account/resources/certificates
2. Click **+** to create a new certificate
3. Select **Developer ID Application** (signs the .app bundle)
4. Generate a Certificate Signing Request (CSR):
   - Open **Keychain Access** on a Mac
   - Menu > Certificate Assistant > Request a Certificate from a Certificate Authority
   - Enter your email, leave CA email blank, select "Saved to disk"
5. Upload the CSR, download the certificate, double-click to install in Keychain
6. Repeat for **Developer ID Installer** (signs the .dmg)

---

## Step 2: Export as .p12 for CI

1. Open **Keychain Access**
2. Find your "Developer ID Application" certificate
3. Right-click > Export > save as `.p12` with a strong password
4. Base64-encode it:
   ```bash
   base64 -i certificate.p12 -o certificate-base64.txt
   ```
5. Keep both the .p12 and the base64 file safe — you'll need them for GitHub secrets

---

## Step 3: Create an App-Specific Password (for Notarization)

1. Go to https://appleid.apple.com
2. Sign-In & Security > App-Specific Passwords > Generate
3. Name it "Tauri Notarization"
4. Save the generated password somewhere secure

---

## Step 4: Add GitHub Secrets

In the repo (github.com/agenticledger/myaiforone-lite) > Settings > Secrets > Actions, add:

| Secret                      | Value                                                    |
|-----------------------------|----------------------------------------------------------|
| `APPLE_CERTIFICATE`         | Contents of `certificate-base64.txt`                     |
| `APPLE_CERTIFICATE_PASSWORD`| The .p12 export password from Step 2                     |
| `APPLE_SIGNING_IDENTITY`    | `Developer ID Application: Your Name (TEAMID)`           |
| `APPLE_ID`                  | Your Apple ID email                                      |
| `APPLE_PASSWORD`            | The app-specific password from Step 3                    |
| `APPLE_TEAM_ID`             | Your 10-character team ID (visible in developer portal)  |

---

## Step 5: Update CI and Tauri Config

Once the secrets are in place, update `.github/workflows/build.yml` and `src-tauri/tauri.conf.json` to wire in signing and notarization. Tauri v2 picks up the env vars automatically — the CI just needs to expose them to the build step.

> Ask Claude to do this step — it can read the existing CI workflow and make the changes.

---

## Notes

- Certificates are valid for 5 years (Developer ID certs)
- Signing happens automatically in CI on every build — no manual steps after setup
- Apple notarization adds ~1-2 min to each CI build
- You need access to a Mac for Step 1 (creating the CSR and exporting the .p12)
- After this is done, macOS users will no longer see "unidentified developer" warnings
