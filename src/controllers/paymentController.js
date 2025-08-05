const razorpay = require('../utils/razorpayClient');
const { serviceRole: supabaseServiceRole } = require('../utils/supabaseClient');
const crypto = require('crypto');

exports.initiatePayment = async (req, res, next) => {
  try {
    const { orderId } = req.body;

    // Fetch order details to get the actual amount
    const { data: order, error: orderError } = await supabaseServiceRole
      .from('orders')
      .select('id, final_amount')
      .eq('id', orderId)
      .single();

    if (orderError) {
      if (orderError.code === 'PGRST116') {
        return res.status(404).json({ success: false, message: 'Order not found.' });
      }
      throw orderError;
    }

    const amountInPaise = Math.round(order.final_amount * 100); // Convert to paise
    const currency = 'INR';

    const options = {
      amount: amountInPaise,
      currency,
      receipt: `order_rcptid_${orderId}`,
      payment_capture: 1, // Auto-capture payment
      notes: { order_id: orderId },
    };
    const razorpayOrder = await razorpay.orders.create(options);
    res.json({ success: true, order: razorpayOrder });
  } catch (err) {
    next(err);
  }
};

exports.paymentWebhook = async (req, res, next) => {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET; // Make sure this is in your .env
  const shasum = crypto.createHmac('sha256', secret);
  shasum.update(req.rawBody);
  const digest = shasum.digest('hex');

  if (digest === req.headers['x-razorpay-signature']) {
    const event = req.body.event;
    const payload = req.body.payload;

    console.log('Webhook received:', event);

    try {
      switch (event) {
        case 'payment.captured':
          const payment = payload.payment.entity;
          const orderId = payment.notes.order_id;

          await supabaseServiceRole
            .from('orders')
            .update({ payment_status: 'paid', status: 'processing' })
            .eq('id', orderId);

          await supabaseServiceRole
            .from('payments')
            .insert({
              order_id: orderId,
              payment_gateway_transaction_id: payment.id,
              amount: payment.amount / 100, // Convert back to rupees
              status: payment.status,
              payment_method: payment.method,
              payment_gateway_response: payload,
            });
          break;
        case 'payment.failed':
          const failedPayment = payload.payment.entity;
          const failedOrderId = failedPayment.notes.order_id;

          await supabaseServiceRole
            .from('orders')
            .update({ payment_status: 'failed', status: 'cancelled' })
            .eq('id', failedOrderId);

          await supabaseServiceRole
            .from('payments')
            .insert({
              order_id: failedOrderId,
              payment_gateway_transaction_id: failedPayment.id,
              amount: failedPayment.amount / 100,
              status: failedPayment.status,
              payment_method: failedPayment.method,
              payment_gateway_response: payload,
            });
          break;
        // Add other event types as needed
        default:
          console.log(`Unhandled event type ${event}`);
      }
    } catch (dbErr) {
      console.error('Database update error on webhook:', dbErr);
      return res.status(500).json({ success: false, message: 'Error processing webhook.' });
    }
    res.json({ received: true });
  } else {
    console.log('Invalid Razorpay signature');
    res.status(403).json({ success: false, message: 'Invalid signature' });
  }
}; 

exports.verifyPayment = async (req, res, next) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, orderId } = req.body;

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature || !orderId) {
      return res.status(400).json({ success: false, message: 'Missing required parameters.' });
    }

    const secret = process.env.RAZORPAY_KEY_SECRET;
    const hmac = crypto.createHmac('sha256', secret);
    hmac.update(`${razorpay_order_id}|${razorpay_payment_id}`);
    const generatedSignature = hmac.digest('hex');

    if (generatedSignature !== razorpay_signature) {
      return res.status(400).json({ success: false, message: 'Invalid signature.' });
    }

    // Fetch order amount for record keeping
    const { data: order, error: orderError } = await supabaseServiceRole
      .from('orders')
      .select('final_amount')
      .eq('id', orderId)
      .single();

    if (orderError) {
      if (orderError.code === 'PGRST116') {
        return res.status(404).json({ success: false, message: 'Order not found.' });
      }
      throw orderError;
    }

    // Update order status
    await supabaseServiceRole
      .from('orders')
      .update({ payment_status: 'paid', status: 'processing' })
      .eq('id', orderId);

    // Record payment details
    await supabaseServiceRole
      .from('payments')
      .insert({
        order_id: orderId,
        payment_gateway_transaction_id: razorpay_payment_id,
        amount: order.final_amount,
        status: 'captured',
        payment_method: 'razorpay',
        payment_gateway_response: { razorpay_order_id, razorpay_payment_id, razorpay_signature },
      });

    return res.json({ success: true, verified: true });
  } catch (err) {
    next(err);
  }
}; 

