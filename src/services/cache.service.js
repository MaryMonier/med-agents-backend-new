const cache = new Map();
const TTL = 60 * 60 * 1000; // 1 hour

const set = (key, value) => {
  cache.set(key, {
    value,
    expiresAt: Date.now() + TTL
  });
};

const get = (key) => {
  const item = cache.get(key);
  if (!item) return null;
  if (Date.now() > item.expiresAt) {
    cache.delete(key);
    return null;
  }
  return item.value;
};

const del = (key) => {
  cache.delete(key);
};

const clear = () => {
  cache.clear();
};

module.exports = { set, get, del, clear };