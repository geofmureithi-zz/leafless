// @flow
"use strict";
import type { IncomingMessage, ServerResponse } from "http";

const http = require("http");
const https = require("https");
const fs = require("fs");
const url = require("url");
const path = require("path");

const mime = require("./vendor/mime");
const contentType = require("./vendor/parsers/content-type");
const routing = require("./vendor/routing");
const co = require("./vendor/co");

const makectx = require("./lib/makectx");
const staticHandler = require("./handlers/static");

/**
 * send back an http response to the client
 *
 * @param {any} value - the item being sent back as response
 * @param {Object} response - HTTPResponse object to which we are writing
 */
function sendResponse(value: any, response: ServerResponse) {
  if (value == undefined) return response.end();
  // did we get an object?
  if (typeof value === "object") {
    if (value.type && value.content) {
      response.setHeader("Content-Type", value.type);
      if (Buffer.isBuffer(value.content)) return response.end(value.content);

      return response.end(JSON.stringify(value.content));
    }
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify(value));
    return;
  }
  // return as is
  response.end(value);
}

/**
* httpListener is passed into http.createServer
* @param {ClientRequest} request http.ServerRequest
* @param {ServerResponse} response http.ServerResponse
*/
function httpListener(request: IncomingMessage, response: ServerResponse) {
  const URL = url.parse(request.url);
  let ctx, method: string, handler: Object, routed = routing.get(URL.pathname);

  // check 404s
  if (routed.handler == null) {
    response.statusCode = 404;
    return response.end("Not Found");
  }
  ctx = makectx(request, response, routed, URL);
  method = request.method.toLowerCase();
  handler = routed.handler;
  if (typeof routed.handler === "function") handler = new routed.handler({});

  // check 405 Method Not Supported
  if (handler[method] == undefined) {
    response.statusCode = 405;
    return response.end("Method Not Supported");
  }
  co
    .wrap(handler[method])
    .call(handler, ctx)
    .then(res => {
      sendResponse(res, response);
    })
    .catch(error => {
      // and error we don't know how to deal with
      console.error(error);
      process.exit(1);
    });
}

// options.ssl
function LeafLess(options: Object = {}) {
  let instance = {};
  instance.options = options;
  instance.listen = function(...args) {
    // set up a http server and pass in the listener
    if (options.ssl) {
      instance.server = https.createServer(
        options.ssl,
        httpListener.bind(instance)
      );
    } else {
      instance.server = http.createServer(httpListener.bind(instance));
    }
    instance.server.listen(...args);
    return instance.server;
  };

  /**
   * route sets handlers of the given paths
    route('/:tool/:path', {
      *post(ctx) {
        return ctx.params;
      }
    });

  * @param {string} path the url path being routed
  * @param {Object} handler the route handler
  */
  instance.route = function(path: string, handler: Object) {
    if (typeof path === "string") {
      if (Array.isArray(handler)) throw new Error(`handler can't be an array`);
      if (typeof handler === "function" || typeof handler === "object")
        return routing.set(path, handler);

      throw new Error(
        `route is expecting handler to be a function or object found '${typeof handler}'`
      );
    }
  };

  /**
   * support serving static files
   *
   * @param {string} path the url root to which to server static requests
   * @param {string} directory the directory from which to server static files
   * @param {Object} options any other options the might be set
   */
  instance.static = function(
    urlPath: string,
    directory: string,
    options: Object
  ) {
    let route = instance.route.bind(instance);
    staticHandler({ route, urlPath, directory, options });
  };

  return instance;
}

module.exports = LeafLess;
