function formatCurrency(amount) {
  return `₹${Number(amount).toLocaleString('en-IN')}`;
}

function orderEmailTemplate(order, user) {
  const itemsRows = order.items.map(item => `
    <tr>
      <td style="padding:10px 0;border-bottom:1px solid #eee;">
        <div style="font-size:14px;color:#1a1a1a;">${item.name}</div>
        ${item.variant ? `<div style="font-size:12px;color:#777;">${item.variant}</div>` : ''}
        <div style="font-size:12px;color:#777;">Qty: ${item.quantity}</div>
      </td>
      <td style="padding:10px 0;border-bottom:1px solid #eee;text-align:right;font-size:14px;color:#1a1a1a;">
        ${formatCurrency(item.price * item.quantity)}
      </td>
    </tr>`).join('');

  const addr = order.shippingAddress;

  return `
  <div style="font-family:Arial,Helvetica,sans-serif;background:#f5f5f5;padding:24px;">
    <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:6px;overflow:hidden;border:1px solid #eee;">
      <div style="background:#154360;padding:20px 24px;">
        <span style="color:#ffffff;font-size:20px;font-weight:bold;letter-spacing:0.5px;">ShopNest</span>
      </div>
      <div style="padding:24px;">
        <h2 style="margin:0 0 8px 0;font-size:18px;color:#1a1a1a;">Hi ${user.name},</h2>
        <p style="margin:0 0 16px 0;font-size:14px;color:#444;line-height:1.5;">
          Your order has been successfully placed. Here are the details.
        </p>
        <table width="100%" style="font-size:13px;color:#444;margin-bottom:16px;">
          <tr><td style="padding:4px 0;">Order ID</td><td style="text-align:right;font-weight:bold;">${order.orderNumber}</td></tr>
          <tr><td style="padding:4px 0;">Order date</td><td style="text-align:right;">${new Date(order.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}</td></tr>
          <tr><td style="padding:4px 0;">Payment method</td><td style="text-align:right;">${order.paymentMethod}</td></tr>
          <tr><td style="padding:4px 0;">Order status</td><td style="text-align:right;">${order.orderStatus}</td></tr>
        </table>
        <table width="100%" style="border-collapse:collapse;margin-bottom:16px;">
          ${itemsRows}
        </table>
        <table width="100%" style="font-size:13px;color:#444;margin-bottom:16px;">
          <tr><td style="padding:2px 0;">Subtotal</td><td style="text-align:right;">${formatCurrency(order.subtotal)}</td></tr>
          <tr><td style="padding:2px 0;">Discount</td><td style="text-align:right;">-${formatCurrency(order.discount)}</td></tr>
          <tr><td style="padding:2px 0;">Delivery</td><td style="text-align:right;">${order.deliveryFee === 0 ? 'FREE' : formatCurrency(order.deliveryFee)}</td></tr>
          <tr><td style="padding:8px 0 0 0;font-weight:bold;font-size:14px;">Total</td><td style="text-align:right;padding:8px 0 0 0;font-weight:bold;font-size:14px;">${formatCurrency(order.total)}</td></tr>
        </table>
        <div style="background:#f9f9f9;border-radius:4px;padding:12px 16px;margin-bottom:16px;">
          <div style="font-size:13px;font-weight:bold;color:#1a1a1a;margin-bottom:4px;">Delivery address</div>
          <div style="font-size:13px;color:#555;line-height:1.5;">
            ${addr.fullName}, ${addr.phone}<br/>
            ${addr.houseNumber}, ${addr.street}<br/>
            ${addr.city}, ${addr.state} - ${addr.pincode}
          </div>
        </div>
        ${order.estimatedDelivery ? `<p style="font-size:13px;color:#444;">Expected delivery by <strong>${new Date(order.estimatedDelivery).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}</strong></p>` : ''}
        <p style="font-size:14px;color:#1a1a1a;margin-top:20px;">Thank you for shopping with ShopNest.</p>
      </div>
      <div style="background:#f5f5f5;padding:16px 24px;font-size:11px;color:#999;text-align:center;">
        This is a demo order confirmation. No real payment was processed.
      </div>
    </div>
  </div>`;
}

module.exports = orderEmailTemplate;
