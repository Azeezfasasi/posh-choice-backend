const { test } = require('node:test');
const assert = require('node:assert');
const { priceOrder } = require('../utils/orderPricing');

const product = (overrides) => ({
  _id: { toString: () => overrides.id },
  name: overrides.id,
  price: 1000,
  salePrice: 1000,
  onSale: false,
  status: 'active',
  stockQuantity: 10,
  images: [],
  ...overrides,
});

test('uses database prices, ignoring client-sent prices', () => {
  const result = priceOrder(
    [{ productId: 'a', quantity: 2, price: 1 }],
    [product({ id: 'a' })],
    { shippingAmount: 500 }
  );
  assert.deepStrictEqual(result.errors, []);
  assert.strictEqual(result.orderItems[0].price, 1000);
  assert.strictEqual(result.itemsPrice, 2000);
  assert.strictEqual(result.shippingPrice, 500);
  assert.strictEqual(result.totalPrice, 2500);
});

test('uses sale price when product is on sale', () => {
  const result = priceOrder(
    [{ productId: 'a', quantity: 1 }],
    [product({ id: 'a', onSale: true, salePrice: 750 })],
    null
  );
  assert.strictEqual(result.totalPrice, 750);
});

test('rejects zero, negative and fractional quantities', () => {
  for (const quantity of [0, -3, 1.5, 'abc']) {
    const result = priceOrder([{ productId: 'a', quantity }], [product({ id: 'a' })], null);
    assert.strictEqual(result.errors.length, 1, `quantity ${quantity} should be rejected`);
  }
});

test('combines duplicate lines before checking stock', () => {
  const result = priceOrder(
    [{ productId: 'a', quantity: 6 }, { productId: 'a', quantity: 6 }],
    [product({ id: 'a', stockQuantity: 10 })],
    null
  );
  assert.strictEqual(result.errors.length, 1);
});

test('rejects products that are not active', () => {
  const result = priceOrder([{ productId: 'a', quantity: 1 }], [product({ id: 'a', status: 'draft' })], null);
  assert.strictEqual(result.errors.length, 1);
});
