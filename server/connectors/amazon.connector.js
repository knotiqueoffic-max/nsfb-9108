const BaseConnector = require('./base.connector');
class AmazonConnector extends BaseConnector {
  constructor() {
    super('amazon');
    this.sellerId = process.env.AMAZON_SELLER_ID;
    this.mwsToken = process.env.AMAZON_SP_API_TOKEN;
    this.isConfigured = !!(this.sellerId && this.mwsToken);
  }
  async fetchOrders(options = {}) {
    if (!this.isConfigured) return super.fetchOrders(options);
    throw new Error('Amazon SP-API implementation pending — add AMAZON_SELLER_ID and AMAZON_SP_API_TOKEN to .env');
  }
}
module.exports = new AmazonConnector();
