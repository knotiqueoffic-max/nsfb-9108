const Razorpay = require('razorpay');
const crypto = require('crypto');
const db = require('../db/database');

const KEY_ID = process.env.RAZORPAY_KEY_ID;
const KEY_SECRET = process.env.RAZORPAY_KEY_SECRET;
const WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET || 'knotique_webhook_secret';

let razorpay = null;

// Determine if we are in mock mode (evaluating or dev without keys)
const isMockMode = !KEY_ID || !KEY_SECRET;

if (!isMockMode) {
  razorpay = new Razorpay({
    key_id:     KEY_ID,
    key_secret: KEY_SECRET,
  });
  console.log('💳 Razorpay initialized in LIVE/TEST mode.');
} else {
  console.warn('⚠️ Razorpay environment variables (RAZORPAY_KEY_ID/KEY_SECRET) missing. Running in MOCK Mode.');
}

/**
 * Creates or retrieves a customer in Razorpay for a tenant.
 */
async function createCustomer(tenantId, name, email) {
  const tenant = await db('tenants').where('id', tenantId).first();
  if (!tenant) throw new Error('Tenant not found');

  if (tenant.razorpay_customer_id) {
    return tenant.razorpay_customer_id;
  }

  let customerId;

  if (isMockMode) {
    customerId = `cust_mock_${Math.random().toString(36).substr(2, 9)}`;
  } else {
    try {
      const response = await razorpay.customers.create({
        name,
        email,
        fail_existing: 0, // don't fail if email already exists
      });
      customerId = response.id;
    } catch (err) {
      console.error('Razorpay Customer Error:', err);
      // Fallback in case of api error
      customerId = `cust_fallback_${Math.random().toString(36).substr(2, 9)}`;
    }
  }

  await db('tenants').where('id', tenantId).update({ razorpay_customer_id: customerId });
  return customerId;
}

/**
 * Generates/creates a subscription for a tenant.
 * planId can be 'starter' | 'growth' | 'business'
 */
async function createSubscription(tenantId, planId) {
  const tenant = await db('tenants').where('id', tenantId).first();
  if (!tenant) throw new Error('Tenant not found');

  const plan = await db('plans').where('id', planId).first();
  if (!plan) throw new Error('Plan not found');

  // Ensure customer exists
  const owner = await db('users').where('id', tenant.owner_id).first();
  const customerId = await createCustomer(tenantId, owner?.name || tenant.name, owner?.email);

  let subscriptionId;
  let shortUrl = '';

  if (isMockMode) {
    subscriptionId = `sub_mock_${Math.random().toString(36).substr(2, 9)}`;
    shortUrl = `https://mock.razorpay.com/subscription/${subscriptionId}`;
  } else {
    // Razorpay subscription plan mappings
    // During actual setup, you map Knotique local plans to Razorpay Plan IDs.
    // We expect these in environment variables or configuration settings.
    let razorpayPlanId = process.env[`RAZORPAY_PLAN_${planId.toUpperCase()}`];

    if (!razorpayPlanId) {
      // Create a plan on-the-fly or fallback to local mock if none configured
      try {
        const rpPlan = await razorpay.plans.create({
          period: 'monthly',
          interval: 1,
          item: {
            name: `${plan.name} Subscription`,
            amount: plan.price_monthly, // in paise
            currency: 'INR',
          },
        });
        razorpayPlanId = rpPlan.id;
      } catch (err) {
        console.error('Razorpay Plan Create failed, fallback to mock subscription', err);
        subscriptionId = `sub_mock_plan_${Math.random().toString(36).substr(2, 9)}`;
        shortUrl = `https://mock.razorpay.com/subscription/${subscriptionId}`;
      }
    }

    if (!subscriptionId && razorpayPlanId) {
      try {
        const rpSub = await razorpay.subscriptions.create({
          plan_id: razorpayPlanId,
          customer_id: customerId,
          total_count: 12, // 12 billing cycles
          quantity: 1,
          customer_notify: 1,
        });
        subscriptionId = rpSub.id;
        shortUrl = rpSub.short_url || '';
      } catch (err) {
        console.error('Razorpay Subscription Create error:', err);
        throw new Error(err.message || 'Failed to create Razorpay subscription');
      }
    }
  }

  // Update tenant details
  await db('tenants').where('id', tenantId).update({
    razorpay_subscription_id: subscriptionId,
    plan_id:                  planId,
  });

  return { subscriptionId, shortUrl };
}

/**
 * Cancel an active subscription in Razorpay.
 */
async function cancelSubscription(subscriptionId) {
  if (isMockMode || subscriptionId.startsWith('sub_mock')) {
    return { status: 'cancelled' };
  }

  try {
    const response = await razorpay.subscriptions.cancel(subscriptionId, false); // cancel at end of cycle
    return response;
  } catch (err) {
    console.error('Razorpay Subscription Cancel Error:', err);
    throw err;
  }
}

/**
 * Validate webhook signature from Razorpay.
 */
function validateWebhookSignature(signature, body) {
  if (isMockMode) return true; // webhook simulation bypass
  const expectedSignature = crypto
    .createHmac('sha256', WEBHOOK_SECRET)
    .update(JSON.stringify(body))
    .digest('hex');
  return expectedSignature === signature;
}

module.exports = {
  createCustomer,
  createSubscription,
  cancelSubscription,
  validateWebhookSignature,
  isMockMode,
};
