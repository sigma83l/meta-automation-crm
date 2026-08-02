# Tenant Isolation Report

## Authority

The verified session identifies a user. An active workspace membership resolves
authority server-side. A request workspace identifier can only narrow an
already-authorized membership and never grants access.

Business rows carry non-null `workspace_id`. Forced RLS, composite workspace
foreign keys, private Storage paths and explicit service-role role checks form
independent enforcement layers.

## Required evidence

The Prompt 10 gate covers:

- cross-workspace UI/API/direct-ID/search/export/file denial;
- forged body/query/header workspace identifiers;
- owner/admin/operator/viewer boundaries;
- disabled workspace and removed-member denial;
- background replay and idempotency scope;
- environment credential separation by documented topology.

Hosted Preview/Staging and Production credential separation cannot be proven
until owner-approved projects exist. Local database, integration and browser
tests remain the release gate and may not be substituted for hosted proof.
