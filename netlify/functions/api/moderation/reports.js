'use strict';
const { json } = require('../../lib/common');
const { reports } = require('../../lib/reports-store');

module.exports = () => json(200, reports);
