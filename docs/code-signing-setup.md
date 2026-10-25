# Code signing setup (SignPath Foundation)

The desktop workflow (`.github/workflows/desktop.yml`) can code-sign `daylog-setup.exe` for free
through [SignPath Foundation](https://signpath.org/). Until the steps below are done, the signing
steps are skipped and builds keep shipping unsigned, so nothing breaks in the meantime.

## 1. Get the requirements onto `main`

SignPath Foundation checks the repository when you apply. These are already in place on this
branch; merge it to `main` first:

- [x] Public repository
- [x] OSI-approved licence (`LICENSE`, MIT)
- [x] Code signing policy and privacy statement (README → _Code signing policy_)
- [x] Installer built on GitHub-hosted runners from this repository

## 2. Apply

- [ ] Apply for a free open-source project at <https://signpath.org/> (Apply / "Get started"),
      pointing to `https://github.com/Mufassir-Chowdhury/daylog`.
- [ ] Turn on two-factor authentication on your GitHub and SignPath accounts — SignPath requires
      it for project members.
- [ ] Wait for approval. They review applications by hand, so it can take a while.

## 3. Set up the project on signpath.io

Once accepted, in the SignPath web app:

- [ ] **Project** — slug `daylog` (the workflow uses this name).
- [ ] **Signing policy** — slug `release-signing`, using the SignPath Foundation release
      certificate. Add yourself as an approver.
- [ ] **Trusted build system** — link GitHub (github.com) to the project, so only artifacts built
      by GitHub Actions on GitHub-hosted runners are accepted.
- [ ] **Artifact configuration** — set this as the project's default:

  ```xml
  <artifact-configuration xmlns="http://signpath.io/artifact-configuration/v1">
    <zip-file>
      <pe-file path="daylog-setup.exe">
        <authenticode-sign/>
      </pe-file>
    </zip-file>
  </artifact-configuration>
  ```

- [ ] **CI user** — create one, give it _submitter_ rights on the `release-signing` policy, and
      generate an API token for it. Copy the token now; it's shown once.
- [ ] Note your **organization ID** (shown in the organization settings).

## 4. Add the values to GitHub

In the repository: **Settings → Secrets and variables → Actions**.

- [ ] **Variables** tab → `SIGNPATH_ORGANIZATION_ID` = your organization ID.
      This variable is what switches signing on.
- [ ] **Secrets** tab → `SIGNPATH_API_TOKEN` = the CI user's API token.

## 5. Ship a signed build

- [ ] Push to `main` (or run the _Desktop app_ workflow by hand from the Actions tab).
- [ ] The workflow stops at **Sign the installer with SignPath** and waits for you. Open the
      signing request on signpath.io and **approve** it — within an hour, or the job times out and
      the release isn't published.
- [ ] Check the release: download `daylog-setup.exe`, right-click → **Properties → Digital
      Signatures** should list _SignPath Foundation_.

## Good to know

- **Every push to `main` needs an approval.** Each build makes a new signing request.
- **The certificate is in SignPath Foundation's name**, not yours.
- **SmartScreen may still warn for a while** until the certificate builds up download reputation.
- **Only the installer is signed**, not the `daylog.exe` inside it. That's common and doesn't
  affect SmartScreen on install.
- **Auto-update keeps working:** after signing, `desktop/refresh-update-info.mjs` updates the
  checksum and size in `latest.yml` so installed apps accept the signed installer.
