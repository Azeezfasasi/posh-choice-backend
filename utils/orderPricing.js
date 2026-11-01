// Pure pricing logic for orders. Prices always come from the database,
// never from the client.

const getUnitPrice = (product) => (product.onSale ? product.salePrice : product.price);

const roundMoney = (value) => Math.round(value * 100) / 100;

/**
 * @param {Array<{productId: string, quantity: any}>} requestedItems
 * @param {Array} products - Product documents for the requested ids
 * @param {{shippingAmount: number}|null} deliveryLocation
 * @returns {{errors: string[], orderItems: Array, itemsPrice: number, shippingPrice: number, taxPrice: number, totalPrice: number}}
 */
function priceOrder(requestedItems, products, deliveryLocation) {
  const errors = [];
  const orderItems = [];
  const quantities = new Map();

  for (const item of requestedItems) {
    const quantity = Number(item.quantity);
    if (!Number.isInteger(quantity) || quantity < 1) {
      errors.push(`Invalid quantity for ${item.name || item.productId}.`);
      continue;
    }
    const id = String(item.productId);
    quantities.set(id, (quantities.get(id) || 0) + quantity);
  }

  for (const [id, quantity] of quantities) {
    const product = products.find(p => p._id.toString() === id);
    if (!product || product.status !== 'active') {
      errors.push(`Product with ID ${id} is not available.`);
      continue;
    }
    if (product.stockQuantity < quantity) {
      errors.push(`Not enough stock for ${product.name}. Available: ${product.stockQuantity}, Requested: ${quantity}.`);
      continue;
    }
    orderItems.push({
      productId: product._id,
      name: product.name,
      quantity,
      price: roundMoney(getUnitPrice(product)),
      image: product.thumbnail || (product.images && product.images[0] && product.images[0].url),
    });
  }

  const itemsPrice = roundMoney(orderItems.reduce((sum, item) => sum + item.price * item.quantity, 0));
  const shippingPrice = deliveryLocation ? roundMoney(deliveryLocation.shippingAmount) : 0;
  const taxPrice = 0;
  const totalPrice = roundMoney(itemsPrice + shippingPrice + taxPrice);

  return { errors, orderItems, itemsPrice, shippingPrice, taxPrice, totalPrice };
}

module.exports = { priceOrder, getUnitPrice };
