// MetaMask SDK references RN async-storage; web bundle uses this in-memory stub (see next.config.js).
const mem = new Map();
const api = {
  getItem: async (k) => (mem.has(String(k)) ? mem.get(String(k)) : null),
  setItem: async (k, v) => {
    mem.set(String(k), String(v));
  },
  removeItem: async (k) => {
    mem.delete(String(k));
  },
  clear: async () => {
    mem.clear();
  },
  getAllKeys: async () => [...mem.keys()],
  multiGet: async (keys) => keys.map((k) => [k, mem.get(String(k)) ?? null]),
  multiSet: async (pairs) => {
    for (const [k, v] of pairs) mem.set(String(k), String(v));
  },
  multiRemove: async (keys) => {
    for (const k of keys) mem.delete(String(k));
  },
};
module.exports = api;
module.exports.default = api;
