const express = require('express');
const router = express.Router();
const { sendQuoteRequest, getAllQuoteRequests, deleteQuoteRequest, updateQuoteRequest } = require('../controllers/quoteController');
const { auth, authorizeRoles } = require('../middleware/auth');

// POST /api/quote
router.post('/quote', sendQuoteRequest);

// GET /api/quotes
router.get('/quotes', auth, authorizeRoles, getAllQuoteRequests);

// DELETE /api/quotes/:id
router.delete('/quotes/:id', auth, authorizeRoles, deleteQuoteRequest);

// PUT /api/quote/:id
router.put('/quotes/:id', auth, authorizeRoles, updateQuoteRequest);

module.exports = router;