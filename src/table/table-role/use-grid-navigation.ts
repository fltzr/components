// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { useEffect, useMemo } from 'react';
import { findFocusinCell, moveFocusBy, moveFocusIn, updateTableIndices } from './utils';
import { FocusedCell, GridNavigationAPI, GridNavigationProps } from './interfaces';
import { KeyCode } from '../../internal/keycode';
import { containsOrEqual } from '../../internal/utils/dom';

/**
 * Makes table with role="grid" navigable with keyboard commands.
 * See https://www.w3.org/WAI/ARIA/apg/patterns/grid
 */
export function useGridNavigation({ tableRole, pageSize, getTable }: GridNavigationProps): GridNavigationAPI {
  const model = useMemo(() => new GridNavigationModel(), []);

  // Initialize the model with the table container assuming it is mounted synchronously and only once.
  useEffect(
    () => {
      if (tableRole === 'grid') {
        const table = getTable();
        table && model.init(table);
      }
      return () => model.destroy();
    },
    // Assuming getTable is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [model, tableRole]
  );

  // Notify the model of the props change.
  useEffect(() => {
    model.update({ pageSize });
  }, [model, pageSize]);

  return {};
}

class GridNavigationModel {
  // Props
  private _pageSize = 0;
  private _table: null | HTMLTableElement = null;

  // State
  private prevFocusedCell: null | FocusedCell = null;
  private focusedCell: null | FocusedCell = null;
  private cleanup = () => {};

  public init(table: HTMLTableElement) {
    this._table = table;

    this.table.addEventListener('focusin', this.onFocusin);
    this.table.addEventListener('focusout', this.onFocusout);
    this.table.addEventListener('keydown', this.onKeydown);

    const mutationObserver = new MutationObserver(this.onMutation);
    mutationObserver.observe(table, { childList: true, subtree: true });

    // No need to clean this up as no resources are allocated.
    updateTableIndices(this.table, this.focusedCell ?? this.prevFocusedCell);

    this.cleanup = () => {
      this.table.removeEventListener('focusin', this.onFocusin);
      this.table.removeEventListener('focusout', this.onFocusout);
      this.table.removeEventListener('keydown', this.onKeydown);

      mutationObserver.disconnect();
    };
  }

  public destroy() {
    this.cleanup();
  }

  public update({ pageSize }: { pageSize: number }) {
    this._pageSize = pageSize;
  }

  private get pageSize() {
    return this._pageSize;
  }

  private get table(): HTMLTableElement {
    if (!this._table) {
      throw new Error('Invariant violation: GridNavigationModel is used before initialization.');
    }
    return this._table;
  }

  private onFocusin = (event: FocusEvent) => {
    const cell = findFocusinCell(event);

    if (!cell) {
      return;
    }
    this.prevFocusedCell = cell;
    this.focusedCell = cell;

    updateTableIndices(this.table, cell);
  };

  private onFocusout = () => {
    this.focusedCell = null;
  };

  private onKeydown = (event: KeyboardEvent) => {
    if (!this.focusedCell) {
      return;
    }

    const f2Code = 113;
    const ctrlKey = event.ctrlKey ? 1 : 0;
    const altKey = event.altKey ? 1 : 0;
    const shiftKey = event.shiftKey ? 1 : 0;
    const metaKey = event.metaKey ? 1 : 0;
    const numModifiersPressed = ctrlKey + altKey + shiftKey + metaKey;

    let key = event.keyCode;
    if (numModifiersPressed === 1 && event.ctrlKey) {
      key = -key;
    } else if (numModifiersPressed) {
      return;
    }

    const from = this.focusedCell;
    const minExtreme = Number.NEGATIVE_INFINITY;
    const maxExtreme = Number.POSITIVE_INFINITY;

    // When focus is inside widget cell only intercept Escape and F2 commands to move focus back to cell.
    if (from.widget && from.element !== from.cellElement) {
      if (key === KeyCode.escape || key === f2Code) {
        event.preventDefault();
        return moveFocusBy(this.table, from, { y: 0, x: 0 });
      }
      return;
    }

    switch (key) {
      case KeyCode.up:
        event.preventDefault();
        return moveFocusBy(this.table, from, { y: -1, x: 0 });

      case KeyCode.down:
        event.preventDefault();
        return moveFocusBy(this.table, from, { y: 1, x: 0 });

      case KeyCode.left:
        event.preventDefault();
        return moveFocusBy(this.table, from, { y: 0, x: -1 });

      case KeyCode.right:
        event.preventDefault();
        return moveFocusBy(this.table, from, { y: 0, x: 1 });

      case KeyCode.pageUp:
        event.preventDefault();
        return moveFocusBy(this.table, from, { y: -this.pageSize, x: 0 });

      case KeyCode.pageDown:
        event.preventDefault();
        return moveFocusBy(this.table, from, { y: this.pageSize, x: 0 });

      case KeyCode.home:
        event.preventDefault();
        return moveFocusBy(this.table, from, { y: 0, x: minExtreme });

      case KeyCode.end:
        event.preventDefault();
        return moveFocusBy(this.table, from, { y: 0, x: maxExtreme });

      case -KeyCode.home:
        event.preventDefault();
        return moveFocusBy(this.table, from, { y: minExtreme, x: minExtreme });

      case -KeyCode.end:
        event.preventDefault();
        return moveFocusBy(this.table, from, { y: maxExtreme, x: maxExtreme });

      case KeyCode.enter:
        if (from.element === from.cellElement) {
          event.preventDefault();
          return moveFocusIn(from);
        }
        break;

      case KeyCode.escape:
        if (from.element !== from.cellElement) {
          event.preventDefault();
          return moveFocusBy(this.table, from, { y: 0, x: 0 });
        }
        break;

      case f2Code:
        event.preventDefault();
        if (from.element === from.cellElement) {
          return moveFocusIn(from);
        } else {
          return moveFocusBy(this.table, from, { y: 0, x: 0 });
        }

      default:
        return;
    }
  };

  private onMutation = (mutationRecords: MutationRecord[]) => {
    if (!this.prevFocusedCell) {
      return;
    }

    // When focused cell was un-mounted - re-apply focus to the same location.
    for (const record of mutationRecords) {
      if (record.type === 'childList') {
        for (const removedNode of Array.from(record.removedNodes)) {
          if (containsOrEqual(removedNode, this.prevFocusedCell.element)) {
            moveFocusBy(this.table, this.prevFocusedCell, { y: 0, x: 0 });
          }
        }
      }
    }

    updateTableIndices(this.table, this.focusedCell ?? this.prevFocusedCell);
  };
}