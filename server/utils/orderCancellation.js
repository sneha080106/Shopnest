// Cancelling an order: change its status AND give the reserved stock back, exactly once.
//
// There is no multi-document transaction here (a plain local MongoDB can't run one), so the safety
// comes from atomic single-document steps in a deliberate order:
//   1. Claim the cancellation: one conditional update that only succeeds if the order is still in a
//      cancellable status. Two racing requests (customer + admin, or a double click) -> one wins.
//   2. Release the stock behind a `stockReleased` flag that is claimed atomically BEFORE any stock is
//      added, so stock can never be returned twice, however many times this runs.
//   3. If adding stock fails part-way, what was added is taken back and the flag is cleared, so the
//      next cancel request on the (already Cancelled) order finishes the job.

const Order = require('../models/Order');
const Product = require('../models/Product');
const AppError = require('./AppError');
const { CANCELLED, CUSTOMER_CANCELLABLE, ADMIN_CANCELLABLE, hasRealPayment } = require('./orderTransitions');

// Returns the stock of every item to the shop, once. Safe to call repeatedly.
async function releaseOrderStock(order) {
  const claimed = await Order.findOneAndUpdate(
    { _id: order._id, stockReleased: { $ne: true } },
    { $set: { stockReleased: true, stockReleasedAt: new Date() } },
    { new: true }
  );
  if (!claimed) return false; // already released

  const done = [];
  try {
    for (const item of order.items) {
      await Product.updateOne({ _id: item.product }, { $inc: { stock: item.quantity } });
      done.push(item);
    }
  } catch (err) {
    for (const item of done) {
      try { await Product.updateOne({ _id: item.product }, { $inc: { stock: -item.quantity } }); } catch (_) { /* best effort */ }
    }
    try {
      await Order.updateOne({ _id: order._id }, { $set: { stockReleased: false }, $unset: { stockReleasedAt: 1 } });
    } catch (e) {
      console.error(`[order] Could not clear stockReleased for ${order.orderNumber}: ${e.message}`);
    }
    throw err;
  }
  return true;
}

// actor: 'customer' | 'admin'. Returns { order, replay, refunded }.
async function cancelOrder(order, actor) {
  const allowed = actor === 'admin' ? ADMIN_CANCELLABLE : CUSTOMER_CANCELLABLE;

  // Already cancelled (a retry, or an earlier attempt that stopped before the stock came back):
  // make sure the stock is back and report success.
  if (order.orderStatus === CANCELLED) {
    await releaseOrderStock(order);
    return { order: await Order.findById(order._id), replay: true, refunded: order.paymentStatus === 'Refunded' };
  }
  if (!allowed.includes(order.orderStatus)) {
    throw new AppError(
      actor === 'admin'
        ? `An order that is ${order.orderStatus} cannot be cancelled`
        : `This order can no longer be cancelled online because it is ${order.orderStatus}. Please contact support.`,
      400
    );
  }
  if (hasRealPayment(order)) {
    throw new AppError('This order was paid online and needs a gateway refund, which is not available yet. Please contact support.', 409);
  }

  // A paid (demo) order is marked Refunded; anything else keeps its payment status.
  const wasPaid = order.paymentStatus === 'Paid';
  const claimed = await Order.findOneAndUpdate(
    {
      _id: order._id,
      orderStatus: { $in: allowed },
      paymentStatus: wasPaid ? 'Paid' : { $ne: 'Paid' }
    },
    { $set: { orderStatus: CANCELLED, cancelledAt: new Date(), cancelledBy: actor, ...(wasPaid && { paymentStatus: 'Refunded' }) } },
    { new: true }
  );

  if (!claimed) {
    // Lost a race: look at what it is now.
    const current = await Order.findById(order._id);
    if (current && current.orderStatus === CANCELLED) {
      await releaseOrderStock(current);
      return { order: await Order.findById(order._id), replay: true, refunded: current.paymentStatus === 'Refunded' };
    }
    throw new AppError('The order was just updated. Please refresh and try again.', 409);
  }

  await releaseOrderStock(claimed);
  return { order: await Order.findById(order._id), replay: false, refunded: wasPaid };
}

module.exports = { cancelOrder, releaseOrderStock };
