let firepad = firepad || {};

firepad.ACEAdapter = class ACEAdapter {
  constructor(abacus) {
    this.ignoreChanges = false;
    this.onChange = this.onChange.bind(this);
    this.onBlur = this.onBlur.bind(this);
    this.onFocus = this.onFocus.bind(this);
    this.onCursorActivity = this.onCursorActivity.bind(this);
    this.abc = abacus;
    // this.aceSession = this.ace.getSession();
    // this.aceDoc = this.aceSession.getDocument();
    // this.aceDoc.setNewLineMode("unix");
    this.grabDocumentState();
    // this.ace.on("change", this.onChange);
    // this.ace.on("blur", this.onBlur);
    // this.ace.on("focus", this.onFocus);
    // this.aceSession.selection.on("changeCursor", this.onCursorActivity);
    // this.aceRange = (ace.require != null ? ace.require : require)(
    //   "ace/range"
    // ).Range;
  }

  grabDocumentState() {
    this.lastDocLines = this.aceDoc.getAllLines();
    return (this.lastCursorRange = this.aceSession.selection.getRange());
  }

  // Removes all event listeners from the ACE editor instance
  detach() {
    this.ace.removeListener("change", this.onChange);
    this.ace.removeListener("blur", this.onBlur);
    this.ace.removeListener("focus", this.onFocus);
    return this.aceSession.selection.removeListener(
      "changeCursor",
      this.onCursorActivity
    );
  }

  onChange(change) {
    if (!this.ignoreChanges) {
      const pair = this.operationFromACEChange(change);
      this.trigger("change", ...Array.from(pair));
      return this.grabDocumentState();
    }
  }

  onBlur() {
    if (this.ace.selection.isEmpty()) {
      return this.trigger("blur");
    }
  }

  onFocus() {
    return this.trigger("focus");
  }

  onCursorActivity() {
    return setTimeout(() => {
      return this.trigger("cursorActivity");
    }, 0);
  }

  // Converts an ACE change object into a TextOperation and its inverse
  // and returns them as a two-element array.
  operationFromACEChange(change) {
    console.log('extracting an operation from ace');
    let action, start, text;
    if (change.data) {
      // Ace < 1.2.0
      const delta = change.data;
      if (["insertLines", "removeLines"].includes(delta.action)) {
        text = delta.lines.join("\n") + "\n";
        action = delta.action.replace("Lines", "");
      } else {
        text = delta.text.replace(this.aceDoc.getNewLineCharacter(), "\n");
        action = delta.action.replace("Text", "");
      }
      start = this.indexFromPos(delta.range.start);
    } else {
      // Ace 1.2.0+
      text = change.lines.join("\n");
      start = this.indexFromPos(change.start);
    }

    let restLength = this.lastDocLines.join("\n").length - start;
    if (change.action === "remove") {
      restLength -= text.length;
    }
    const insert_op = new firepad.TextOperation()
      .retain(start)
      .insert(text)
      .retain(restLength);
    const delete_op = new firepad.TextOperation()
      .retain(start)
      .delete(text)
      .retain(restLength);
    if (change.action === "remove") {
      return [delete_op, insert_op];
    } else {
      return [insert_op, delete_op];
    }
  }

  // Apply an operation to an ACE instance.
  applyOperationToACE(operation) {
    let index = 0;
    for (let op of Array.from(operation.ops)) {
      if (op.isRetain()) {
        index += op.chars;
      } else if (op.isInsert()) {
        this.aceDoc.insert(this.posFromIndex(index), op.text);
        index += op.text.length;
      } else if (op.isDelete()) {
        const from = this.posFromIndex(index);
        const to = this.posFromIndex(index + op.chars);
        const range = this.aceRange.fromPoints(from, to);
        this.aceDoc.remove(range);
      }
    }
    return this.grabDocumentState();
  }

  posFromIndex(index) {
    let row;
    for (row = 0; row < this.aceDoc.$lines.length; row++) {
      const line = this.aceDoc.$lines[row];
      if (index <= line.length) {
        break;
      }
      index -= line.length + 1;
    }
    return { row, column: index };
  }

  indexFromPos(pos, lines) {
    if (lines == null) {
      lines = this.lastDocLines;
    }
    let index = 0;
    for (
      let i = 0, end = pos.row, asc = 0 <= end;
      asc ? i < end : i > end;
      asc ? i++ : i--
    ) {
      index += this.lastDocLines[i].length + 1;
    }
    return (index += pos.column);
  }

  getValue() {
    return this.aceDoc.getValue();
  }

  getCursor() {
    let end, start;
    try {
      start = this.indexFromPos(
        this.aceSession.selection.getRange().start,
        this.aceDoc.$lines
      );
      end = this.indexFromPos(
        this.aceSession.selection.getRange().end,
        this.aceDoc.$lines
      );
    } catch (e) {
      // If the new range doesn't work (sometimes with setValue), we'll use the old range
      try {
        start = this.indexFromPos(this.lastCursorRange.start);
        end = this.indexFromPos(this.lastCursorRange.end);
      } catch (e2) {
        console.log(
          "Couldn't figure out the cursor range:",
          e2,
          "-- setting it to 0:0."
        );
        [start, end] = Array.from([0, 0]);
      }
    }
    if (start > end) {
      [start, end] = Array.from([end, start]);
    }
    console.log('heres the cursor!');
    return new firepad.Cursor(start, end);
  }

  setCursor(cursor) {
    let start = this.posFromIndex(cursor.position);
    let end = this.posFromIndex(cursor.selectionEnd);
    if (cursor.position > cursor.selectionEnd) {
      [start, end] = Array.from([end, start]);
    }
    return this.aceSession.selection.setSelectionRange(
      new this.aceRange(start.row, start.column, end.row, end.column)
    );
  }

  setOtherCursor(cursor, color, clientId) {
    if (this.otherCursors == null) {
      this.otherCursors = {};
    }
    let cursorRange = this.otherCursors[clientId];
    if (cursorRange) {
      cursorRange.start.detach();
      cursorRange.end.detach();
      this.aceSession.removeMarker(cursorRange.id);
    }
    let start = this.posFromIndex(cursor.position);
    let end = this.posFromIndex(cursor.selectionEnd);
    if (cursor.selectionEnd < cursor.position) {
      [start, end] = Array.from([end, start]);
    }
    let clazz = `other-client-selection-${color.replace("#", "")}`;
    const justCursor = cursor.position === cursor.selectionEnd;
    if (justCursor) {
      clazz = clazz.replace("selection", "cursor");
    }
    const css = `.${clazz} {
  position: absolute;
  background-color: ${justCursor ? "transparent" : color};
  border-left: 2px solid ${color};
}`;
    this.addStyleRule(css);
    this.otherCursors[clientId] = cursorRange = new this.aceRange(
      start.row,
      start.column,
      end.row,
      end.column
    );

    // Hack this specific range to, when clipped, return an empty range that
    // pretends to not be empty. This lets us draw markers at the ends of lines.
    // This might be brittle in the future.
    const self = this;
    cursorRange.clipRows = function () {
      const range = self.aceRange.prototype.clipRows.apply(this, arguments);
      range.isEmpty = () => false;
      return range;
    };

    cursorRange.start = this.aceDoc.createAnchor(cursorRange.start);
    cursorRange.end = this.aceDoc.createAnchor(cursorRange.end);
    cursorRange.id = this.aceSession.addMarker(cursorRange, clazz, "text");
    // Return something with a clear method to mimic expected API from CodeMirror
    return {
      clear: () => {
        cursorRange.start.detach();
        cursorRange.end.detach();
        return this.aceSession.removeMarker(cursorRange.id);
      }
    };
  }

  addStyleRule(css) {
    if (typeof document === "undefined" || document === null) {
      return;
    }
    if (!this.addedStyleRules) {
      this.addedStyleRules = {};
      const styleElement = document.createElement("style");
      document.documentElement
        .getElementsByTagName("head")[0]
        .appendChild(styleElement);
      this.addedStyleSheet = styleElement.sheet;
    }
    if (this.addedStyleRules[css]) {
      return;
    }
    this.addedStyleRules[css] = true;
    return this.addedStyleSheet.insertRule(css, 0);
  }

  registerCallbacks(callbacks) {
    this.callbacks = callbacks;
  }

  trigger(event, ...args) {
    return this.callbacks[event] && this.callbacks[event].apply(this, args);
  }

  applyOperation(operation) {
    if (!operation.isNoop()) {
      this.ignoreChanges = true;
    }
    console.log('applying operation to ace');
    this.applyOperationToACE(operation);
    return (this.ignoreChanges = false);
  }

  registerUndo(undoFn) {
    return (this.ace.undo = undoFn);
  }

  registerRedo(redoFn) {
    return (this.ace.redo = redoFn);
  }

  invertOperation(operation) {
    // TODO: Optimize to avoid copying entire text?
    return operation.invert(this.getValue());
  }
};
