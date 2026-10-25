const router = require('express').Router();
const db = require('../db/database');
const { authenticate, ownerOnly } = require('../middleware/auth');
const { createSubscription, cancelSubscription, validateWebhookSignature } = require('../services/razorpay.service');

// ─── Webhook (Public; does not use authenticate middleware) ──────────────────
router.post('/webhook', async (req, res) => {
  const signature = req.headers['x-razorpay-signature'];
  if (!signature) {
    return res.status(400).json({ error: 'Signature header missing' });
  }

  const isValid = validateWebhookSignature(signature, req.body);
  if (!isValid) {
    return res.status(400).json({ error: 'Invalid signature' });
  }

  const event = req.body.event;
  const payload = req.body.payload;

  console.log(`🔔 Razorpay Webhook Event Received: ${event}`);

  try {
    if (event && event.startsWith('subscription.')) {
      const subObj = payload.subscription.entity;
      const subId = subObj.id;

      // Find tenant associated with subscription ID
      const tenant = await db('tenants').where('razorpay_subscription_id', subId).first();
      if (tenant) {
        let status = 'active';
        if (event === 'subscription.charged') status = 'active';
        if (event === 'subscription.pending') status = 'past_due';
        if (event === 'subscription.halted')  status = 'locked';
        if (event === 'subscription.cancelled') status = 'canceled';

        await db('tenants').where('id', tenant.id).update({
          subscription_status: status,
          updated_at:          db.fn.now(),
        });

        // Insert an invoice if charged
        if (event === 'subscription.charged') {
          const invCount = await db('invoices').count('id as count').first();
          const nextInvNum = `INV-${new Date().getFullYear()}-${String(parseInt(invCount.count) + 1).padStart(4, '0')}`;
          
          await db('invoices').insert({
            tenant_id:        tenant.id,
            invoice_number:   nextInvNum,
            amount:           subObj.amount || 149900,
            currency:         subObj.currency || 'INR',
            status:           'paid',
            razorpay_payment_id: payload.payment?.entity?.id || null,
          });
        }
      }
    }
    res.json({ status: 'ok' });
  } catch (err) {
    console.error('Webhook processing error:', err);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

// All other endpoints require user authentication
router.use(authenticate);

// ─── GET /api/billing/plans — list all available plans ──────────────────────
router.get('/plans', async (req, res) => {
  const plans = await db('plans').where('is_active', true);
  res.json(plans);
});

// ─── GET /api/billing/invoices — payment history ──────────────────────────────
router.get('/invoices', ownerOnly, async (req, res) => {
  const invoices = await db('invoices')
    .where('tenant_id', req.tenant_id)
    .orderBy('billing_date', 'desc');
  res.json(invoices);
});

// ─── POST /api/billing/subscribe ──────────────────────────────────────────────
router.post('/subscribe', ownerOnly, async (req, res) => {
  const { plan_id } = req.body;
  if (!plan_id) return res.status(400).json({ error: 'plan_id is required' });

  // Handle Free 14-Day Trial: No payment gateway required
  if (plan_id === 'free_trial' || plan_id === 'free') {
    try {
      const trialEndsAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
      await db('tenants').where('id', req.tenant_id).update({
        plan_id:             'free_trial',
        subscription_status: 'trialing',
        trial_ends_at:       trialEndsAt,
        updated_at:          db.fn.now(),
      });

      const updatedTenant = await db('tenants').where('id', req.tenant_id).first();
      return res.json({
        status:      'success',
        isFreeTrial: true,
        tenant:      updatedTenant,
        message:     'Your 14-Day Free Trial has been activated successfully! Enjoy full access.',
      });
    } catch (err) {
      console.error('Free trial activation error:', err);
      return res.status(500).json({ error: 'Failed to activate free trial.' });
    }
  }

  try {
    const { subscriptionId, shortUrl } = await createSubscription(req.tenant_id, plan_id);
    res.json({
      subscriptionId,
      shortUrl,
      key: process.env.RAZORPAY_KEY_ID || null,
      message: 'Subscription initialized successfully.',
    });
  } catch (err) {
    console.error('Subscribe endpoint error:', err);
    res.status(500).json({ error: err.message || 'Failed to initiate subscription.' });
  }
});

// ─── POST /api/billing/verify-payment ─────────────────────────────────────────
router.post('/verify-payment', ownerOnly, async (req, res) => {
  const { razorpay_payment_id, razorpay_subscription_id, razorpay_signature, plan_id } = req.body;

  // Verify signature if signature details are provided (live mode verification)
  // In mock mode, we bypass signature verification and set status to active
  const isMock = !razorpay_signature || razorpay_subscription_id?.startsWith('sub_mock');

  if (!isMock) {
    const secret = process.env.RAZORPAY_KEY_SECRET;
    const generated_signature = crypto
      .createHmac('sha256', secret)
      .update(razorpay_payment_id + '|' + razorpay_subscription_id)
      .digest('hex');

    if (generated_signature !== razorpay_signature) {
      return res.status(400).json({ error: 'Invalid payment signature. Verification failed.' });
    }
  }

  // Update tenant subscription info
  await db('tenants').where('id', req.tenant_id).update({
    subscription_status: 'active',
    plan_id:             plan_id || 'starter',
    trial_ends_at:       null, // no longer in trial
    updated_at:          db.fn.now(),
  });

  // Create an invoice record
  const plan = await db('plans').where('id', plan_id).first();
  const invCount = await db('invoices').count('id as count').first();
  const nextInvNum = `INV-${new Date().getFullYear()}-${String(parseInt(invCount.count) + 1).padStart(4, '0')}`;

  await db('invoices').insert({
    tenant_id:        req.tenant_id,
    invoice_number:   nextInvNum,
    amount:           plan?.price_monthly || 49900,
    currency:         'INR',
    status:           'paid',
    razorpay_payment_id: razorpay_payment_id || `pay_mock_${Math.random().toString(36).substr(2, 9)}`,
    razorpay_signature:  razorpay_signature || null,
  });

  const updatedTenant = await db('tenants').where('id', req.tenant_id).first();
  res.json({
    status: 'success',
    tenant: updatedTenant,
    message: 'Subscription activated and verified successfully!',
  });
});

// ─── POST /api/billing/cancel ─────────────────────────────────────────────────
router.post('/cancel', ownerOnly, async (req, res) => {
  try {
    const tenant = await db('tenants').where('id', req.tenant_id).first();
    if (!tenant || !tenant.razorpay_subscription_id) {
      return res.status(400).json({ error: 'No active subscription to cancel.' });
    }

    await cancelSubscription(tenant.razorpay_subscription_id);

    // Downgrade tenant to Starter plan, canceled status
    await db('tenants').where('id', req.tenant_id).update({
      subscription_status:      'canceled',
      plan_id:                  'starter', // downgrade to free/starter
      razorpay_subscription_id: null,
      updated_at:               db.fn.now(),
    });

    const updatedTenant = await db('tenants').where('id', req.tenant_id).first();
    res.json({
      status: 'success',
      tenant: updatedTenant,
      message: 'Subscription cancelled successfully. Account reverted to Starter plan.',
    });
  } catch (err) {
    console.error('Cancel subscription endpoint error:', err);
    res.status(500).json({ error: err.message || 'Failed to cancel subscription.' });
  }
});

module.exports = router;
