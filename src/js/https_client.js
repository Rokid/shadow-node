/* Copyright 2015-present Samsung Electronics Co., Ltd. and other contributors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

var util = require('util');
var tls = require('tls');
var OutgoingMessage = require('http_outgoing').OutgoingMessage;
var common = require('http_common');
var HTTPParser = require('httpparser').HTTPParser;

function ClientRequest(options, cb) {
  OutgoingMessage.call(this);

  // get port, host and method.
  var port = options.port = options.port || 443;
  var host = options.host = options.hostname || options.host || '127.0.0.1';
  var method = options.method || 'GET';
  var path = options.path || '/';

  // buffer for cached..
  this._buffer = null;

  // If `options` contains header information, save it.
  if (options.headers) {
    var keys = Object.keys(options.headers);
    for (var i = 0, l = keys.length; i < l; i++) {
      var key = keys[i];
      this.setHeader(key, options.headers[key]);
    }
  }

  if (host && !this.getHeader('host')) {
    var hostHeader = host;
    if (port && +port !== 443) {
      hostHeader += ':' + port;
    }
    this.setHeader('Host', hostHeader);
  }

  // store first header line to be sent.
  this._storeHeader(method + ' ' + path + ' HTTP/1.1\r\n');

  // Register response event handler.
  if (cb) {
    this.once('response', cb);
  }


  // Create socket.
  var socket = tls.connect({
    host: host,
    port: port
  });

  // setup connection information.
  setupConnection(this, socket);
}

util.inherits(ClientRequest, OutgoingMessage);

exports.ClientRequest = ClientRequest;


function setupConnection(req, socket) {
  var parser = common.createHTTPParser();
  parser.reinitialize(HTTPParser.RESPONSE);
  socket.parser = parser;
  socket._httpMessage = req;

  parser.socket = socket;
  parser.incoming = null;
  parser._headers = [];
  parser.onIncoming = parserOnIncomingClient;

  req.socket = socket;
  req.connection = socket;
  req.parser = parser;
  req.once('finish', function() {
    socket.end();
  });

  socket.on('error', socketOnError);
  socket.on('data', socketOnData);
  socket.on('end', socketOnEnd);
  socket.on('close', socketOnClose);
  socket.on('lookup', socketOnLookup);

  // socket emitted when a socket is assigned to req
  process.nextTick(function() {
    req.emit('socket', socket);
  });
}

function cleanUpSocket(socket) {
  var parser = socket.parser;
  var req = socket._httpMessage;

  if (parser) {
    // unref all links to parser, make parser GCed
    parser.finish();
    parser = null;
    socket.parser = null;
    req.parser = null;
  }

  socket.destroy();
}

function emitError(socket, err) {
  var req = socket._httpMessage;

  if (err) {
    var host;
    if (host = req.getHeader('host')) {
      err.message += ': ' + (host ? host : '');
    }
    req.emit('error', err);
  }
}

function socketOnClose() {
  var socket = this;
  var req = socket._httpMessage;
  var parser = socket.parser;

  // socket.read();

  req.emit('close');

  if (req.res && req.res.readable) {
    // Socket closed before we emitted 'end'
    var res = req.res;
    res.on('end', function() {
      res.emit('close');
    });
    res.push(null);
  }

  cleanUpSocket(this);
}

function socketOnError(err) {
  cleanUpSocket(this);
  emitError(this, err);
}

function socketOnLookup(err, ip, family) {
  emitError(this, err);
}

function socketOnData(d) {
  var socket = this;
  var req = this._httpMessage;
  var parser = this.parser;

  if (!this._buffer) {
    this._buffer = d;
  } else {
    this._buffer = Buffer.concat([this._buffer, d]);
  }

  if (this._buffer.valid('utf8')) {
    ondata(this._buffer);
    this._buffer = null;
  }

  function ondata(valid) {
    var ret = parser.execute(valid);
    if (ret instanceof Error) {
      cleanUpSocket(socket);
      req.emit('error', ret);
    }
  }
}

function socketOnEnd() {
  cleanUpSocket(this);
}

// This is called by parserOnHeadersComplete after response header is parsed.
// TODO: keepalive support
function parserOnIncomingClient(res, shouldKeepAlive) {
  var socket = this.socket;
  var req = socket._httpMessage;

  if (req.res) {
    // server sent responses twice.
    socket.destroy();
    return false;
  }
  req.res = res;

  res.req = req;

  res.on('end', responseOnEnd);

  req.emit('response', res);

  // response to HEAD req has no body
  var isHeadResponse = (req.method == 'HEAD');

  return isHeadResponse;

}

var responseOnEnd = function() {
  var res = this;
  var req = res.req;
  var socket = req.socket;

  // if (socket._socketState.writable) {
  //   socket.destroySoon();
  // }
};


ClientRequest.prototype.setTimeout = function(ms, cb) {
  var self = this;

  if (cb) self.once('timeout', cb);

  var emitTimeout = function() {
    self.emit('timeout');
  };

  // In IoT.js, socket is already assigned,
  // thus, it is sufficient to trigger timeout on socket 'connect' event.
  this.socket.once('connect', function() {
    self.socket.setTimeout(ms, emitTimeout);
  });

};
