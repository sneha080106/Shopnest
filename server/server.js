require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const mongoose = require('mongoose');
const connectDB = require('./config/db');
const { notFound, errorHandler } = require('./middleware/errorHandler');

const authRoutes = require('./routes/authRoutes');
const productRoutes = require('./routes/productRoutes');
const cartRoutes = require('./routes/cartRoutes');
const addressRoutes = require('./routes/addressRoutes');
const orderRoutes = require('./routes/orderRoutes');
const paymentRoutes = require('./routes/paymentRoutes');
const adminRoutes = require('./routes/adminRoutes');

// Fail loudly at startup rather than limping along without a secret and producing confusing
// auth bugs later. MONGO_URI is also checked separately inside connectDB with its own message.
const REQUIRED_ENV_VARS = ['JWT_SECRET', 'MONGO_URI'];
const missingEnvVars = REQUIRED_ENV_VARS.filter(key => !process.env[key]);
if (missingEnvVars.length > 0 && process.env.NODE_ENV !== 'test') {
  console.error(`Missing required environment variable(s): ${missingEnvVars.join(', ')}. Copy .env.example to .env and fill these in.`);
  process.exit(1);
}

const app = express();

// helmet's default CSP is tuned for serving HTML from the same origin; this API only ever
// serves JSON to a separate frontend origin, so the real cross-origin policy is the CORS
// config below, not a content-security-policy header.
app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'cross-origin' } }));

app.use(cors({
  origin: process.env.CLIENT_URL || 'http://localhost:5173',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE']
}));
app.use(express.json({ limit: '2mb' }));
if (process.env.NODE_ENV !== 'test') {
  app.use(morgan('dev'));
}

app.get('/api/health', (req, res) => {
  const dbStates = ['disconnected', 'connected', 'connecting', 'disconnecting'];
  const dbState = dbStates[mongoose.connection.readyState] || 'unknown';
  res.status(dbState === 'connected' ? 200 : 503).json({
    success: dbState === 'connected',
    status: dbState === 'connected' ? 'ok' : 'degraded',
    database: dbState,
    environment: process.env.NODE_ENV || 'development'
  });
});

app.use('/api/auth', authRoutes);
app.use('/api/products', productRoutes);
app.use('/api/cart', cartRoutes);
app.use('/api/addresses', addressRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/payment', paymentRoutes);
app.use('/api/admin', adminRoutes);

app.use(notFound);
app.use(errorHandler);

const PORT = process.env.PORT || 5000;
let server;

async function start() {
  await connectDB();
  server = app.listen(PORT, () => {
    console.log(`ShopNest server running on port ${PORT} [${process.env.NODE_ENV || 'development'}]`);
  });
}

// On a platform restart/redeploy (Render, Railway, etc. send SIGTERM), finish in-flight
// requests and close the DB connection cleanly instead of dropping connections mid-request.
async function shutdown(signal) {
  console.log(`${signal} received, shutting down gracefully…`);
  if (server) {
    await new Promise(resolve => server.close(resolve));
  }
  await mongoose.connection.close();
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

if (require.main === module) {
  start();
}

module.exports = app;
