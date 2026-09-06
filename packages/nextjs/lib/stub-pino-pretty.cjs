// Optional pino transport used by WalletConnect logger in dev; not needed in the browser bundle.
module.exports = function stubPinoPretty() {
  return {};
};
