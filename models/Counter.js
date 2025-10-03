const mongoose = require('mongoose');

const counterSchema = mongoose.Schema({
    _id: { // This will be the name of the counter
        type: String,
        required: true
    },
    seq: { // This will store the current sequence number
        type: Number,
        default: 0
    }
});

const Counter = mongoose.model('Counter', counterSchema);

module.exports = Counter;
