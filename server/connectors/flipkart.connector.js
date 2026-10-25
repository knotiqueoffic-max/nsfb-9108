const BaseConnector = require('./base.connector');

/**
 * Flipkart Seller API connector (stub).
 * To activate: obtain Flipkart Seller API credentials and implement fetchOrders().
 * Docs: https://seller.flipkart.com/api-docs/
 */
class FlipkartConnector extends BaseConnector {
  constructor() {
    super('flipkart');
    this.clientId = process.env.FLIPKART_CLIENT_ID;
    this.clientSecret = process.env.FLIPKART_CLIENT_SECRET;
    this.isConfigured = !!(this.clientId && this.clientSecret);
  }

  async fetchOrders(options = {}) {
    if (!this.isConfigured) return super.fetchOrders(options);
    // TODO: implement OAuth2 + order fetch when credentials are available
    throw new Error('Flipkart API implementation pending — add FLIPKART_CLIENT_ID and FLIPKART_CLIENT_SECRET to .env');
  }
}

module.exports = new FlipkartConnector();
