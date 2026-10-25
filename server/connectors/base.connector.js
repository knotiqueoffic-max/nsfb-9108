/**
 * Base connector class — all platform connectors extend this.
 * Layer 2: structured so real API credentials can be plugged in per-platform.
 */
class BaseConnector {
  constructor(platformName) {
    this.platform = platformName;
    this.isConfigured = false;
  }

  /**
   * Check if this connector has valid credentials configured.
   */
  checkConfig() {
    throw new Error(`${this.platform} connector not configured. Use CSV import instead.`);
  }

  /**
   * Fetch pending orders from the platform API.
   * @returns {Promise<Array>} array of normalized order objects
   */
  async fetchOrders(_options = {}) {
    throw new Error(`${this.platform} live API not yet connected. Use CSV import.`);
  }

  /**
   * Update order status on the platform.
   */
  async updateOrderStatus(_orderId, _status) {
    throw new Error(`${this.platform} live API not yet connected.`);
  }

  /**
   * Get the connector status for display in settings.
   */
  getStatus() {
    return {
      platform: this.platform,
      connected: this.isConfigured,
      message: this.isConfigured
        ? `Connected to ${this.platform} API`
        : `Not configured — use CSV import or add API credentials in Settings`,
    };
  }
}

module.exports = BaseConnector;
