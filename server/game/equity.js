// The equity maths lives in shared/equity.mjs, where the equity calculator
// page imports it too. Re-exported here so the table keeps its old require.
const { computeEquity, score } = require('../../shared/equity.mjs');

module.exports = { computeEquity, score };
