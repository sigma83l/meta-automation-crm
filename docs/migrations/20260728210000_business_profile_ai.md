# Business Profile and AI Migration

Adds structured profiles, FAQ and price rows, encrypted credential envelopes,
AI audit events, forced RLS, and automatic profiles for new workspaces. Browser
roles can read masked credential metadata but cannot write envelopes.

Rollback first disables AI execution, then drops the initializer trigger and
function, Prompt 3 tables, and `ai_provider_mode`. It is destructive and needs
an approved maintenance window.
