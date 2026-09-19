'use strict';
const JSON_HEADERS = { 'content-type': 'application/json' };

function json(statusCode, obj) {
  return { statusCode, headers: JSON_HEADERS, body: JSON.stringify(obj) };
}

module.exports = { json };
