'use strict';
const { json } = require('../lib/common');

module.exports = () =>
  json(200, {
    app: 'VY',
    mode: 'prototype',
    ageMinimum: 13,
    directMessages: false,
    moderationEnabled: true,
    legalReviewRequired: true,
  });
