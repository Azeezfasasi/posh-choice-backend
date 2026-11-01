const mongoose = require('mongoose');

// Reuse one connection across requests (and across warm serverless invocations)
let connectionPromise = null;

function connectDB() {
  if (mongoose.connection.readyState === 1) return Promise.resolve(mongoose.connection);
  if (!connectionPromise) {
    connectionPromise = mongoose
      .connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 })
      .then((m) => {
        console.log('MongoDB connected');
        return m.connection;
      })
      .catch((err) => {
        connectionPromise = null; // allow a retry on the next request
        throw err;
      });
  }
  return connectionPromise;
}

module.exports = { connectDB };
