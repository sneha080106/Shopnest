// Tests for scripts/phase1-indexes.js. The script's logic is exercised against FAKE collections
// (plain objects that record calls) - it has NOT been run against a real MongoDB in this sandbox.

const { indexName, desiredIndexes, sameDefinition, planIndexes, duplicatePipeline, run, parseArgs } = require('../../scripts/phase1-indexes');
const Payment = require('../../models/Payment');
const Order = require('../../models/Order');
const WebhookEvent = require('../../models/WebhookEvent');

const quiet = () => {};

// A model double: real schema (so the desired indexes are the real ones), fake collection.
function fakeModel(realModel, { existing = [], duplicatesFor = {}, missingCollection = false, createFails = {} } = {}) {
  const created = [];
  const collection = {
    created,
    indexes: async () => {
      if (missingCollection) { const e = new Error('ns does not exist'); e.code = 26; throw e; }
      return existing;
    },
    aggregate: pipeline => ({
      toArray: async () => {
        const group = pipeline.find(st => st.$group);
        const key = Object.keys(group.$group._id).join('+');
        return duplicatesFor[key] || [];
      }
    }),
    createIndex: async (keys, options) => {
      if (createFails[options.name]) throw new Error(createFails[options.name]);
      created.push({ keys, options });
    }
  };
  return { schema: realModel.schema, collection };
}

// What MongoDB would report for an index that was built from our definition.
const asExisting = (w, extra = {}) => ({ v: 2, name: w.name, key: w.keys, ...w.options, ...extra });

describe('helpers', () => {
  test('indexName uses the explicit name, else the MongoDB default', () => {
    expect(indexName({ a: 1, b: -1 })).toBe('a_1_b_-1');
    expect(indexName({ a: 1 }, { name: 'custom' })).toBe('custom');
  });

  test('desiredIndexes returns each real index once, by name', () => {
    const names = desiredIndexes(Payment).map(i => i.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toEqual(expect.arrayContaining([
      'reference_1', 'gatewayOrderId_1', 'gatewayPaymentId_1', 'one_open_razorpay_payment_per_order', 'one_captured_razorpay_payment_per_order'
    ]));
    expect(desiredIndexes(WebhookEvent).map(i => i.name)).toEqual(expect.arrayContaining(['webhook_event_unique', 'webhook_event_ttl']));
    expect(desiredIndexes(Order).map(i => i.name)).toEqual(expect.arrayContaining(['payment_1', 'clientRequestId_1', 'awaiting_payment_expiry']));
  });

  test('sameDefinition compares keys, unique, sparse, partial filter and TTL (ignoring key order inside filters)', () => {
    const w = desiredIndexes(Payment).find(i => i.name === 'one_open_razorpay_payment_per_order');
    expect(sameDefinition(asExisting(w), w)).toBe(true);
    const reordered = asExisting(w, { partialFilterExpression: { status: { $in: ['Created', 'Attempted', 'Authorized'] }, provider: 'razorpay' } });
    expect(sameDefinition(reordered, w)).toBe(true);
    expect(sameDefinition(asExisting(w, { unique: false }), w)).toBe(false);
    expect(sameDefinition(asExisting(w, { partialFilterExpression: { provider: 'razorpay', status: 'Created' } }), w)).toBe(false);
    expect(sameDefinition(asExisting(w, { partialFilterExpression: undefined }), w)).toBe(false);
    const ttl = desiredIndexes(WebhookEvent).find(i => i.name === 'webhook_event_ttl');
    expect(sameDefinition(asExisting(ttl, { expireAfterSeconds: 60 }), ttl)).toBe(false);
  });

  test('planIndexes labels ok / missing / conflict', () => {
    const [a, b, c] = desiredIndexes(WebhookEvent).concat(desiredIndexes(Payment).slice(0, 1));
    const plan = planIndexes([a, b, c], [asExisting(a), asExisting(b, { unique: true, sparse: true })]);
    expect(plan.map(p => p.status)).toEqual(['ok', 'conflict', 'missing']);
  });

  test('duplicatePipeline restricts to the rows the index would cover', () => {
    const open = desiredIndexes(Payment).find(i => i.name === 'one_open_razorpay_payment_per_order');
    expect(duplicatePipeline(open)[0]).toEqual({ $match: open.options.partialFilterExpression });
    const sparse = desiredIndexes(Payment).find(i => i.name === 'gatewayOrderId_1');
    expect(duplicatePipeline(sparse)[0]).toEqual({ $match: { gatewayOrderId: { $exists: true } } });
    const plain = desiredIndexes(Payment).find(i => i.name === 'reference_1');
    expect(duplicatePipeline(plain)[0].$group).toBeDefined();
    expect(duplicatePipeline(plain).at(-1)).toEqual({ $limit: 5 });
  });

  test('parseArgs', () => {
    expect(parseArgs([])).toEqual({ apply: false, confirmDb: null, unknown: [] });
    expect(parseArgs(['--apply', '--confirm-db=shop'])).toEqual({ apply: true, confirmDb: 'shop', unknown: [] });
    expect(parseArgs(['--drop']).unknown).toEqual(['--drop']);
  });
});

describe('run(): check mode never changes anything', () => {
  test('on a brand-new database (no collections) everything is MISSING and nothing is created', async () => {
    const models = ['Order', 'Payment', 'WebhookEvent'].map((name, i) => ({
      name, model: fakeModel([Order, Payment, WebhookEvent][i], { missingCollection: true })
    }));
    const { results, exitCode } = await run({ models, apply: false, log: quiet });
    expect(exitCode).toBe(1);
    expect(results.every(r => r.status === 'missing')).toBe(true);
    models.forEach(m => expect(m.model.collection.created).toEqual([]));
  });

  test('when every index already exists, exit code is 0', async () => {
    const mk = real => fakeModel(real, { existing: desiredIndexes(real).map(w => asExisting(w)) });
    const { results, exitCode } = await run({
      models: [{ name: 'Order', model: mk(Order) }, { name: 'Payment', model: mk(Payment) }, { name: 'WebhookEvent', model: mk(WebhookEvent) }],
      log: quiet
    });
    expect(exitCode).toBe(0);
    expect(results.every(r => r.status === 'ok')).toBe(true);
  });
});

describe('run(): apply mode', () => {
  test('creates only the missing indexes, with the names and options from the schema', async () => {
    const have = desiredIndexes(Payment).filter(w => w.name !== 'gatewayOrderId_1').map(w => asExisting(w));
    const model = fakeModel(Payment, { existing: have });
    const { results, exitCode } = await run({ models: [{ name: 'Payment', model }], apply: true, log: quiet });
    expect(exitCode).toBe(0);
    expect(model.collection.created).toEqual([{ keys: { gatewayOrderId: 1 }, options: { name: 'gatewayOrderId_1', unique: true, sparse: true } }]);
    expect(results.find(r => r.name === 'gatewayOrderId_1').status).toBe('created');
  });

  test('the partial unique indexes are created with their partialFilterExpression', async () => {
    const model = fakeModel(Payment, { missingCollection: true });
    await run({ models: [{ name: 'Payment', model }], apply: true, log: quiet });
    const open = model.collection.created.find(c => c.options.name === 'one_open_razorpay_payment_per_order');
    expect(open.options).toMatchObject({ unique: true, partialFilterExpression: { provider: 'razorpay', status: { $in: ['Created', 'Attempted', 'Authorized'] } } });
  });

  test('never drops or rewrites an index that differs from the schema - it reports a CONFLICT', async () => {
    const wrong = desiredIndexes(Order).map(w => (w.name === 'payment_1' ? asExisting(w, { sparse: false }) : asExisting(w)));
    const model = fakeModel(Order, { existing: wrong });
    model.collection.dropIndex = jest.fn();
    const { results, exitCode } = await run({ models: [{ name: 'Order', model }], apply: true, log: quiet });
    expect(exitCode).toBe(1);
    expect(results.find(r => r.name === 'payment_1').status).toBe('conflict');
    expect(model.collection.created).toEqual([]);
    expect(model.collection.dropIndex).not.toHaveBeenCalled();
  });

  test('a unique index is NOT built over existing duplicate data; the duplicates are reported', async () => {
    const model = fakeModel(Order, {
      existing: desiredIndexes(Order).filter(w => w.name !== 'payment_1').map(w => asExisting(w)),
      duplicatesFor: { payment: [{ _id: { payment: 'p1' }, count: 2 }] }
    });
    const { results, exitCode } = await run({ models: [{ name: 'Order', model }], apply: true, log: quiet });
    expect(exitCode).toBe(1);
    const r = results.find(x => x.name === 'payment_1');
    expect(r.status).toBe('blocked');
    expect(r.detail).toMatch(/duplicates/);
    expect(model.collection.created).toEqual([]);
  });

  test('a failing createIndex is reported and the run continues with the others', async () => {
    const model = fakeModel(Payment, { missingCollection: true, createFails: { gatewayOrderId_1: 'boom' } });
    const { results, exitCode } = await run({ models: [{ name: 'Payment', model }], apply: true, log: quiet });
    expect(exitCode).toBe(2);
    expect(results.find(r => r.name === 'gatewayOrderId_1')).toMatchObject({ status: 'failed', detail: 'boom' });
    expect(results.filter(r => r.status === 'created').length).toBeGreaterThan(3);
  });
});
