// Selected rows, keyed by account id. Keying by id (not by row index) is what
// keeps a selection stable across pages, sorts, filters and background
// refreshes. We keep the latest copy of each selected row so the export has
// current values even for rows that are no longer on screen.

import { useCallback, useState } from 'react';

export function useSelection() {
  const [selected, setSelected] = useState(() => new Map());

  const toggle = useCallback((row) => {
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(row.id)) next.delete(row.id);
      else next.set(row.id, row);
      return next;
    });
  }, []);

  const setMany = useCallback((rows, isSelected) => {
    setSelected((prev) => {
      const next = new Map(prev);
      for (const row of rows) {
        if (isSelected) next.set(row.id, row);
        else next.delete(row.id);
      }
      return next;
    });
  }, []);

  const clear = useCallback(() => setSelected(new Map()), []);

  // Refresh stored copies from newly fetched rows; no-op if nothing changed.
  const syncRows = useCallback((rows) => {
    setSelected((prev) => {
      let changed = false;
      const next = new Map(prev);
      for (const row of rows) {
        if (next.has(row.id) && next.get(row.id) !== row) {
          next.set(row.id, row);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, []);

  return { selected, toggle, setMany, clear, syncRows };
}
