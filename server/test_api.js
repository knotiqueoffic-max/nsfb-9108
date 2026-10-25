const axios = require('axios');

async function test() {
  try {
    const res = await axios.get('http://localhost:5000/api/orders?start=2026-08-08&end=2026-08-08', {
      headers: {
        // we might need a token if it requires auth
      }
    });
    console.log('Orders:', res.data.orders.length);
  } catch (err) {
    console.error('API Error:', err.response ? err.response.data : err.message);
  }
}

test();
