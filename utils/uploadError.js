// Error for rejected uploads; the central error handler returns it as a 400
const uploadError = (message) => {
  const err = new Error(message);
  err.statusCode = 400;
  return err;
};

module.exports = { uploadError };
