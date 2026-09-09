'use client';

import * as React from 'react';

/**
 * Local draft of a server value. Re-syncs only when the SERVER CONTENT changes
 * (deep compare via JSON), never on identity alone, so a save on another part of
 * the DTO cannot wipe unsaved edits here — every PATCH/PUT returns a fresh DTO
 * object, and an identity-keyed effect would reset this draft on each of them.
 * Returns [draft, setDraft, dirty].
 */
export function useServerDraft<T>(server: T): [T, React.Dispatch<React.SetStateAction<T>>, boolean] {
  const serverJson = React.useMemo(() => JSON.stringify(server), [server]);
  const [draft, setDraft] = React.useState<T>(server);
  const lastServer = React.useRef(serverJson);
  React.useEffect(() => {
    if (lastServer.current !== serverJson) { lastServer.current = serverJson; setDraft(server); }
  }, [serverJson, server]);
  const dirty = React.useMemo(() => JSON.stringify(draft) !== serverJson, [draft, serverJson]);
  return [draft, setDraft, dirty];
}
