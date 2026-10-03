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

async function run() {
  await connectDB();

  const destroy = process.argv.includes('-d');

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
  const adminPassword = process.env.ADMIN_PASSWORD || 'Admin@12345';
  const existingAdmin = await User.findOne({ email: adminEmail });
  if (!existingAdmin) {
    await User.create({
      name: 'ShopNest Admin',
      email: adminEmail,
      password: adminPassword,
      role: 'admin'
    });
    console.log(`Admin account created: ${adminEmail} / (password from .env)`);
  } else {
    console.log('Admin account already exists, skipping.');
  }

  await mongoose.connection.close();
  console.log('Seeding complete.');
  process.exit(0);
}

run().catch(err => {
  console.error('Seeding failed:', err);
  process.exit(1);
});
