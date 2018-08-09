var NODE_DEBUG = process.env.NODE_DEBUG;

module.exports = function(tag) {
  function debug(str) {
    var prefix = '\033';
    console.info(`${tag} ${prefix}[90m${str}${prefix}[0m`);
  }
  if (NODE_DEBUG === '*') {
    return debug;
  }
  if (NODE_DEBUG === tag) {
    return debug;
  }
};
