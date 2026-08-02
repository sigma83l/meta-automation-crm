# Signal Mirror Theme and Design System

Design position: calm operational clarity inside a restrained cinematic shell.

The sole signature is the two-lane trusted signal converging on the policy
lock. Dense routes remain opaque. Mirror glass is limited to the top bar and
mobile navigation. Channel colors identify channels only and never authorize
actions.

Semantic token families:

- brand navy/blue: `#07111F`, `#0B1730`, `#14254A`, `#3457F1`;
- AI violet: `#6D3FE5`, `#8B5CF6`, `#F1ECFF`;
- trusted signal teal: `#087C87`, `#19A7B3`, `#E5F8FA`;
- light canvas/surface: `#F4F7FB` / `#FFFFFF`;
- dark canvas/surface: `#07111F` / `#0B1730`.

Light, Dark and System preferences are cookie/profile persisted. A head script
resolves System before first paint and the document suppresses only the
expected theme attribute hydration delta. Controls are at least 40 px desktop
and 44 px for touch. Motion is capped, purposeful and removed under
`prefers-reduced-motion`.

Desktop uses a 264 px rail, tablet a 76 px rail and mobile a top context bar
plus Home/Inbox/Create/CRM/More navigation. Operational tables, forms, Inbox
messages and settings never use glass.
