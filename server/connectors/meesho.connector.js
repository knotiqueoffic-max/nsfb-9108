const BaseConnector = require('./base.connector');
class MeeshoConnector extends BaseConnector {
  constructor() {
    super('meesho');
    this.apiKey = process.env.MEESHO_API_KEY;
    this.isConfigured = !!this.apiKey;
  }
  async fetchOrders(options = {}) {
    if (!this.isConfigured) return super.fetchOrders(options);
    throw new Error('Meesho Supplier API implementation pending — add MEESHO_API_KEY to .env');
  }
}
module.exports = new MeeshoConnector();
