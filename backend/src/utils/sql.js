function quoteIdent(s) { return '"' + String(s).replace(/"/g, '""') + '"'; }
function quoteLiteral(s) { return "'" + String(s).replace(/'/g, "''") + "'"; }
module.exports = { quoteIdent, quoteLiteral };
