# Tenant Model

The application is multi-tenant inside one product database. It does not create
one database project per customer.

The session establishes identity; active membership establishes workspace and
role authority. Client workspace hints never grant access. Every business row,
private object, search, export, import, background event and audit path remains
workspace scoped.

Roles:

- Owner/Admin: settings, credentials, connections and all operational writes;
- Operator: CRM, Inbox and automation operations;
- Viewer: read-only.

Forced RLS, composite workspace foreign keys, private Storage paths and
service-layer role checks are independent layers. Removed or disabled
memberships, disabled profiles and disabled workspaces fail closed.
