require('dotenv').config();
const mongoose = require('mongoose');
const slugify = require('slugify');
const connectDB = require('../config/db');
const Product = require('../models/Product');
const User = require('../models/User');
const Order = require('../models/Order');
const Cart = require('../models/Cart');
const Review = require('../models/Review');
const seedProducts = require('./products');
const { resolveAdminPassword, AdminSeedConfigError } = require('../utils/adminSeedConfig');

async function run() {
  const destroy = process.argv.includes('-d');

  // Validate admin credentials before touching the database, so a missing or weak
  // ADMIN_PASSWORD aborts the seed without having connected or deleted anything.
  let adminPassword;
  if (!destroy) {
    const resolved = resolveAdminPassword(process.env);
    adminPassword = resolved.password;
    if (resolved.source === 'dev-default') {
      console.warn('WARNING: ADMIN_PASSWORD is not set; using the development-only default admin password against a local database. Never use this outside local development.');
    }
  }

  await connectDB();

  if (destroy) {
    await Promise.all([
      Product.deleteMany({}),
      Order.deleteMany({}),
      Cart.deleteMany({}),
      Review.deleteMany({}),
      User.deleteMany({ role: 'admin' })
    ]);
    console.log('Existing seed-managed data removed.');
    await mongoose.connection.close();
    process.exit(0);
  }

  await Promise.all([Product.deleteMany({}), Review.deleteMany({})]);

  const withSlugs = seedProducts.map(p => ({
    ...p,
    slug: slugify(p.name, { lower: true, strict: true })
  }));

  await Product.insertMany(withSlugs);
  console.log(`Seeded ${withSlugs.length} products.`);

  const adminEmail = process.env.ADMIN_EMAIL || 'admin@shopnest.example.com';
  const existingAdmin = await User.findOne({ email: adminEmail });
  if (!existingAdmin) {
    await User.create({
      name: 'ShopNest Admin',
      email: adminEmail,
      password: adminPassword,
      role: 'admin'
    });
    console.log(`Admin account created: ${adminEmail}`);
  } else {
    console.log('Admin account already exists, skipping.');
  }

  await mongoose.connection.close();
  console.log('Seeding complete.');
  process.exit(0);
}

run().catch(err => {
  if (err instanceof AdminSeedConfigError) {
    console.error(`Seeding aborted: ${err.message}`);
  } else {
    console.error('Seeding failed:', err);
  }
  process.exit(1);
});
