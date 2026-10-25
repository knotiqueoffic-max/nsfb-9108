const BaseConnector = require('./base.connector');
class EtsyConnector extends BaseConnector {
  constructor() {
    super('etsy');
    this.apiKey = process.env.ETSY_API_KEY;
    this.shopId = process.env.ETSY_SHOP_ID;
    this.isConfigured = !!(this.apiKey && this.shopId);
  }
  async fetchOrders(options = {}) {
    if (!this.isConfigured) return super.fetchOrders(options);
    throw new Error('Etsy API implementation pending — add ETSY_API_KEY and ETSY_SHOP_ID to .env');
  }
}
module.exports = new EtsyConnector();
