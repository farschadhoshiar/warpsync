"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_SSH_POOL_CONFIG = exports.ConnectionStatus = void 0;
var ConnectionStatus;
(function (ConnectionStatus) {
    ConnectionStatus["DISCONNECTED"] = "disconnected";
    ConnectionStatus["CONNECTING"] = "connecting";
    ConnectionStatus["CONNECTED"] = "connected";
    ConnectionStatus["ERROR"] = "error";
    ConnectionStatus["RETRYING"] = "retrying";
})(ConnectionStatus || (exports.ConnectionStatus = ConnectionStatus = {}));
exports.DEFAULT_SSH_POOL_CONFIG = {
    maxConnections: 10,
    idleTimeout: 30000, // 30 seconds
    connectionTTL: 300000, // 5 minutes
    healthCheckInterval: 60000, // 1 minute
    retryAttempts: 3,
    retryDelay: 1000 // 1 second
};
