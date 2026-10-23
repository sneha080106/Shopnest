const mongoose = require('mongoose');
const { WEBHOOK_PROVIDERS, WEBHOOK_EVENT_STATUSES, WEBHOOK_EVENT_RETENTION_SECONDS } = require('../utils/paymentConstants');

// One row per webhook event the gateway has delivered to us. Gateways deliver the same event more
// than once (retries, redeliveries), so the unique (provider, eventId) index below is what makes
// "have I already handled this?" a database guarantee instead of a check-then-act race.
//
// Intended use (Phase 5, not implemented yet): insert a row when an event arrives. A duplicate-key
// error means it was already received; look at `status` to decide whether to skip it ('processed' /
// 'ignored') or retry it ('failed'). Handlers must still be idempotent, because "received" can be
// followed by a crash before "processed".
//
// Privacy: only identifiers, a hash of the body and static codes are stored - never the raw payload,
// which can contain the customer's email, phone number and card/UPI details.
const webhookEventSchema = new mongoose.Schema({
  provider: { type: String, enum: WEBHOOK_PROVIDERS, required: true, default: 'razorpay' },
  // Razorpay sends this in the x-razorpay-event-id header; it is unique per event, not per delivery.
  eventId: { type: String, required: true, trim: true, minlength: 1 },
  eventType: { type: String, required: true },
  status: { type: String, enum: WEBHOOK_EVENT_STATUSES, required: true, default: 'received' },
  // How many times this event id has been delivered (incremented on each duplicate delivery).
  deliveries: { type: Number, required: true, default: 1, min: 1 },
  // Ids pulled out of the event so it can be matched to our records without keeping the payload.
  gatewayOrderId: { type: String },
  gatewayPaymentId: { type: String },
  // SHA-256 of the raw body: lets us notice a "same event id, different content" delivery.
  payloadHash: { type: String },
  // When the gateway says the event happened (not when we received it).
  eventCreatedAt: { type: Date },
  receivedAt: { type: Date, required: true, default: Date.now },
  processedAt: { type: Date },
  // Static code only (e.g. 'amount_mismatch'); never an error message that could echo request data.
  errorCode: { type: String }
}, { timestamps: true });

// Deduplication. Explicit name so the migration script can recognise it.
webhookEventSchema.index({ provider: 1, eventId: 1 }, { name: 'webhook_event_unique', unique: true });
// Old dedup rows are removed automatically. Retention must stay well above the gateway's retry window.
webhookEventSchema.index(
  { receivedAt: 1 },
  { name: 'webhook_event_ttl', expireAfterSeconds: WEBHOOK_EVENT_RETENTION_SECONDS }
);

module.exports = mongoose.model('WebhookEvent', webhookEventSchema);
