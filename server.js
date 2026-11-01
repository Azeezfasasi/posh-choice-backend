// Local / long-running server entry point (Render, `npm start`, `npm run dev`).
// On Vercel, api/index.js is used instead.
const app = require('./app');
const { connectDB } = require('./utils/db');

const PORT = process.env.PORT || 5000;

connectDB().catch((err) => console.error('MongoDB connection error:', err.message));

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
