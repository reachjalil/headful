# Backup & Recovery desktop entry

The native entry verifies the selected org and authenticated CLI principal, then returns only a fixed `https://headful.cloud/backup?sourceOrg=...` destination. It does not transfer CLI credentials, authenticate a cloud Salesforce login, start a native backup, or approve a restore. The cloud editor requires its own owner session and explicit Salesforce login selection.

`BackupRecovery.tsx` supplies the compact editor panel. Public main integrates it as `headful.admin-utilities/backup-recovery` with the org switcher, breadcrumbs and contribution system. The normal workspace includes this cloud destination; the standalone `backup-recovery` experience is development-only. The contribution supplies navigation and an identity check, while the cloud service independently owns account, provider connection, storage and exact recovery review.

The isolated `backup-recovery` fixture uses fictional data and no Salesforce calls. Its six-step recipe resets, selects `ready`, opens the flow, chooses cloud protection, captures a screenshot and checks for alerts. The successful report is retained in the private coordination repository. The fixture is separate evidence from real native scratch recovery and cloud scheduling tests.

Cloud archive and recovery implementation is supplied separately. This desktop entry does not establish cloud rollout/storage configuration or embedded native cloud-session bridging. No full-org protection is claimed. Select and verify cloud coverage independently before including recovery in a release promise.
