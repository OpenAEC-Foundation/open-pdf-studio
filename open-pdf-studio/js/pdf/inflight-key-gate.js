export function createInflightKeyGate() {
  let generation = 0;
  let current = null;

  return {
    begin(key) {
      if (current?.key === key) return null;
      current = { key, generation: ++generation };
      return current;
    },

    cancel() {
      generation++;
      current = null;
    },

    isCurrent(token) {
      return current === token && token.generation === generation;
    },

    finish(token) {
      if (!this.isCurrent(token)) return false;
      current = null;
      return true;
    },
  };
}
