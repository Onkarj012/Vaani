---
paths:
  - "src/shared/ipc.ts"
  - "src/preload/**/*.ts"
  - "src/renderer/**/*.ts"
---
# IPC Compatibility

- IMPORTANT: Preserve IPC channel compatibility between `src/shared/ipc.ts`, preload bridge, and renderer consumers.
- Any change to channel names or signatures must be updated in all three locations.