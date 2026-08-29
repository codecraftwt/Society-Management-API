process.env.NODE_ENV = "test";

if (!global.io) {
  global.io = {
    to: () => ({ emit: () => {} }),
    emit: () => {},
  };
}
