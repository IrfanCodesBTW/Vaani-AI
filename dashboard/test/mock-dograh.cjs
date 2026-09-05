'use strict';

const https = require('node:https');
const origRequest = https.request;

const Module = require('node:module');
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  const exports = origLoad.apply(this, arguments);
  if (exports && typeof exports.rateOk === 'function') {
    exports.rateOk = () => true;
  }
  return exports;
};

// Minimal valid 44-byte WAV header + 100 bytes PCM silence
const wavHeader = Buffer.alloc(44);
wavHeader.write('RIFF', 0);
wavHeader.writeUInt32LE(36 + 100, 4);
wavHeader.write('WAVE', 8);
wavHeader.write('fmt ', 12);
wavHeader.writeUInt32LE(16, 16);
wavHeader.writeUInt16LE(1, 20); // PCM
wavHeader.writeUInt16LE(1, 22); // mono
wavHeader.writeUInt32LE(16000, 24); // 16kHz
wavHeader.writeUInt32LE(32000, 28);
wavHeader.writeUInt16LE(2, 32);
wavHeader.writeUInt16LE(16, 34);
wavHeader.write('data', 36);
wavHeader.writeUInt32LE(100, 40);
const mockWav = Buffer.concat([wavHeader, Buffer.alloc(100)]);

https.request = function (hostOrOptions, ...args) {
  let host = '';
  let path = '';
  if (typeof hostOrOptions === 'string') {
    host = hostOrOptions;
  } else if (hostOrOptions && typeof hostOrOptions === 'object') {
    host = hostOrOptions.host || hostOrOptions.hostname || '';
    path = hostOrOptions.path || '';
  }

  // Intercept Dograh requests
  if (host.includes('trycloudflare.com') || host.includes('dograh')) {
    const { EventEmitter } = require('node:events');
    const req = new EventEmitter();
    req.write = () => {};
    req.end = () => {
      process.nextTick(() => {
        const res = new EventEmitter();
        res.statusCode = 200;
        res.headers = { 'content-type': 'application/json' };
        const callback = args.find((a) => typeof a === 'function');
        if (callback) callback(res);
        const data = JSON.stringify({
          id: 101,
          status: 'published',
          detail: 'ok',
          message: 'call placed with run name WR-TEST-RUN-1',
          workflow_run_id: 1001,
        });
        res.emit('data', Buffer.from(data));
        res.emit('end');
      });
    };
    req.on = function (event, handler) {
      EventEmitter.prototype.on.call(this, event, handler);
      return this;
    };
    req.destroy = () => {};
    req.setTimeout = () => req;
    return req;
  }

  // Intercept Rumik Silk TTS requests to avoid expiring quota failures
  if (host.includes('rumik') || host.includes('silk')) {
    const { EventEmitter } = require('node:events');
    const req = new EventEmitter();
    req.write = () => {};
    req.end = () => {
      process.nextTick(() => {
        const res = new EventEmitter();
        res.statusCode = 200;
        res.headers = {
          'content-type': 'audio/wav',
          'content-length': String(mockWav.length),
          'x-credits-used': '1',
          'x-chars': '25',
        };
        const callback = args.find((a) => typeof a === 'function');
        if (callback) callback(res);
        res.emit('data', mockWav);
        res.emit('end');
      });
    };
    req.on = function (event, handler) {
      EventEmitter.prototype.on.call(this, event, handler);
      return this;
    };
    req.destroy = () => {};
    req.setTimeout = () => req;
    return req;
  }

  return origRequest.call(https, hostOrOptions, ...args);
};
