#!/usr/bin/env node
/* eslint-disable no-console */
// Checks (and optionally creates) the MongoDB indexes the payment/order models rely on.
//
// WHY THIS EXISTS: declaring an index in a Mongoose schema does not guarantee it exists in the
// database you deployed to. Mongoose only tries to build indexes at startup (autoIndex), failures
// are reported as an event rather than a crash, and a unique index cannot be built at all while
// existing documents already violate it. So before taking payments, run this against the real
// database and read the report.
//
// SAFETY RULES
//   * Default mode is a READ-ONLY check. Nothing is changed.
//   * --apply only CREATES missing indexes. It never drops or rebuilds an index, even one that
//     differs from the schema (those are reported as CONFLICT for a human to decide).
//   * A unique index is not created if the data already contains duplicates; they are listed instead.
//   * --apply must be given --confirm-db=<database name> matching the database it connected to.
//
// USAGE (from the server/ folder, MONGO_URI in the environment or .env)
//   node scripts/phase1-indexes.js                              # check only
//   node scripts/phase1-indexes.js --apply --confirm-db=shopnest
//
// Exit codes: 0 everything in place, 1 indexes missing/conflicting (check mode) or skipped, 2 error.

const MANAGED_OPTION_KEYS = ['unique', 'sparse', 'partialFilterExpression', 'expireAfterSeconds'];

const stable = value => JSON.stringify(value, (_k, v) =>
  (v && typeof v === 'object' && !Array.isArray(v))
    ? Object.keys(v).sort().reduce((o, k) => { o[k] = v[k]; return o; }, {})
    : v);

function indexName(keys, options = {}) {
  return options.name || Object.entries(keys).map(([k, v]) => `${k}_${v}`).join('_');
}

// What the schema says should exist, de-duplicated by name (Mongoose can list one index twice when a
// field has both `index: true` and `unique: true`).
function desiredIndexes(model) {
  const byName = new Map();
  for (const [keys, options = {}] of model.schema.indexes()) {
    const name = indexName(keys, options);
    if (byName.has(name)) continue;
    const managed = {};
    for (const key of MANAGED_OPTION_KEYS) if (options[key] !== undefined) managed[key] = options[key];
    byName.set(name, { name, keys, options: managed });
  }
  return [...byName.values()];
}

// Same name AND same behaviour. (A different name for the same keys is treated as "missing" and the
// later createIndex call would be rejected by MongoDB, which is reported instead of hidden.)
function sameDefinition(existing, wanted) {
  return stable(existing.key) === stable(wanted.keys)
    && !!existing.unique === !!wanted.options.unique
    && !!existing.sparse === !!wanted.options.sparse
    && stable(existing.partialFilterExpression ?? null) === stable(wanted.options.partialFilterExpression ?? null)
    && (existing.expireAfterSeconds ?? null) === (wanted.options.expireAfterSeconds ?? null);
}

function planIndexes(wanted, existingIndexes) {
  return wanted.map(w => {
    const found = existingIndexes.find(e => e.name === w.name);
    if (!found) return { ...w, status: 'missing' };
    return { ...w, status: sameDefinition(found, w) ? 'ok' : 'conflict', existing: found };
  });
}

// Aggregation that finds rows that would make a unique index impossible to build.
function duplicatePipeline(wanted) {
  const fields = Object.keys(wanted.keys);
  let match = wanted.options.partialFilterExpression;
  if (!match && wanted.options.sparse) {
    match = Object.fromEntries(fields.map(f => [f, { $exists: true }]));
  }
  const pipeline = [];
  if (match) pipeline.push({ $match: match });
  pipeline.push(
    { $group: { _id: Object.fromEntries(fields.map(f => [f.replace(/\./g, '_'), `$${f}`])), count: { $sum: 1 } } },
    { $match: { count: { $gt: 1 } } },
    { $limit: 5 }
  );
  return pipeline;
}

async function listExisting(model) {
  try {
    return await model.collection.indexes();
  } catch (err) {
    if (err.code === 26 || /ns does not exist|NamespaceNotFound/i.test(err.message || '')) return []; // no collection yet
    throw err;
  }
}

async function findDuplicates(model, wanted) {
  try {
    return await model.collection.aggregate(duplicatePipeline(wanted)).toArray();
  } catch (err) {
    if (err.code === 26 || /ns does not exist|NamespaceNotFound/i.test(err.message || '')) return [];
    throw err;
  }
}

// models: [{ name, model }]. Returns { results, exitCode }. Never throws for a single bad index.
async function run({ models, apply = false, log = console.log }) {
  const results = [];
  let exitCode = 0;

  for (const { name: modelName, model } of models) {
    const existing = await listExisting(model);
    const plan = planIndexes(desiredIndexes(model), existing);

    for (const item of plan) {
      const label = `${modelName}.${item.name}`;
      const entry = { model: modelName, name: item.name, status: item.status };

      if (item.status === 'ok') {
        log(`  OK        ${label}`);
      } else if (item.status === 'conflict') {
        entry.detail = `exists but differs from the schema (existing: ${stable(item.existing)})`;
        log(`  CONFLICT  ${label} - ${entry.detail}. Not changed; decide manually (never auto-dropped).`);
        exitCode = Math.max(exitCode, 1);
      } else {
        // missing
        if (item.options.unique) {
          const dups = await findDuplicates(model, item);
          if (dups.length > 0) {
            entry.status = 'blocked';
            entry.detail = `existing data already has duplicates: ${stable(dups.map(d => ({ key: d._id, count: d.count })))}`;
            log(`  BLOCKED   ${label} - ${entry.detail}. Fix the data first, then re-run.`);
            exitCode = Math.max(exitCode, 1);
            results.push(entry);
            continue;
          }
        }
        if (!apply) {
          log(`  MISSING   ${label} - would be created with --apply`);
          exitCode = Math.max(exitCode, 1);
        } else {
          try {
            await model.collection.createIndex(item.keys, { name: item.name, ...item.options });
            entry.status = 'created';
            log(`  CREATED   ${label}`);
          } catch (err) {
            entry.status = 'failed';
            entry.detail = err.message;
            log(`  FAILED    ${label} - ${err.message}`);
            exitCode = 2;
          }
        }
      }
      results.push(entry);
    }
  }
  return { results, exitCode };
}

function parseArgs(argv) {
  const args = { apply: false, confirmDb: null, unknown: [] };
  for (const a of argv) {
    if (a === '--apply') args.apply = true;
    else if (a.startsWith('--confirm-db=')) args.confirmDb = a.slice('--confirm-db='.length);
    else args.unknown.push(a);
  }
  return args;
}

async function main(argv) {
  const args = parseArgs(argv);
  if (args.unknown.length > 0) {
    console.error(`Unknown argument(s): ${args.unknown.join(' ')}\nUsage: node scripts/phase1-indexes.js [--apply --confirm-db=<database>]`);
    return 2;
  }
  require('dotenv').config();
  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.error('MONGO_URI is not set.');
    return 2;
  }

  const mongoose = require('mongoose');
  await mongoose.connect(uri);
  try {
    const dbName = mongoose.connection.name;
    // Host and database name only - the connection string (with its password) is never printed.
    console.log(`Connected to ${mongoose.connection.host}/${dbName}`);

    if (args.apply && args.confirmDb !== dbName) {
      console.error(`Refusing to apply: pass --confirm-db=${dbName} to confirm this is the database you intend to change.`);
      return 2;
    }

    const admin = mongoose.connection.db.admin();
    const [{ version }, hello] = await Promise.all([admin.command({ buildInfo: 1 }), admin.command({ hello: 1 })]);
    console.log(`MongoDB ${version}; replica set: ${hello.setName ? hello.setName : 'NO (standalone) - multi-document transactions will not work'}`);
    console.log(args.apply ? 'Mode: APPLY (creates missing indexes only)\n' : 'Mode: CHECK (read-only)\n');

    const models = [
      { name: 'Order', model: require('../models/Order') },
      { name: 'Payment', model: require('../models/Payment') },
      { name: 'WebhookEvent', model: require('../models/WebhookEvent') }
    ];
    const { exitCode } = await run({ models, apply: args.apply });
    console.log(exitCode === 0 ? '\nAll expected indexes are in place.' : '\nSome indexes need attention (see above).');
    return exitCode;
  } finally {
    await mongoose.connection.close();
  }
}

if (require.main === module) {
  main(process.argv.slice(2)).then(code => process.exit(code), err => {
    console.error(`Index check failed: ${err.message}`);
    process.exit(2);
  });
}

module.exports = { indexName, desiredIndexes, sameDefinition, planIndexes, duplicatePipeline, run, parseArgs, MANAGED_OPTION_KEYS };
