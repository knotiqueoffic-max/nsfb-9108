const BaseConnector = require('./base.connector');
class MyntraConnector extends BaseConnector {
  constructor() {
    super('myntra');
    this.apiKey = process.env.MYNTRA_API_KEY;
    this.isConfigured = !!this.apiKey;
  }
  async fetchOrders(options = {}) {
    if (!this.isConfigured) return super.fetchOrders(options);
    throw new Error('Myntra Partner API implementation pending — add MYNTRA_API_KEY to .env');
  }
}
module.exports = new MyntraConnector();
