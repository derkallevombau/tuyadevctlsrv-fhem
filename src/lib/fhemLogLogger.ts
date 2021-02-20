/**
 * @file tuyadevctlsrv.js
 * Created on: Nov 24 2019
 * @author derkallevombau
 */

const strftime = require('strftime');

/**
 * Logger for first stage of application startup.
 * Since `console` outputs to stdout/stderr and these
 * are redirected to FHEM log, it uses the same formatting.
 */
const fhemLogLogger =
{
	debug: (message, ...optionalParams) => console.debug(strftime('%Y.%m.%d %H:%M:%S'), '4:', 'tuyadevctlsrv-fhem:', message, ...optionalParams),
	info:  (message, ...optionalParams) => console.info(strftime('%Y.%m.%d %H:%M:%S'), '3:', 'tuyadevctlsrv-fhem:', message, ...optionalParams),
	warn:  (message, ...optionalParams) => console.warn(strftime('%Y.%m.%d %H:%M:%S'), '2:', 'tuyadevctlsrv-fhem:', message, ...optionalParams),
	error: (message, ...optionalParams) => console.error(strftime('%Y.%m.%d %H:%M:%S'), '1:', 'tuyadevctlsrv-fhem:', message, ...optionalParams),
	fatal: (message, ...optionalParams) => console.error(strftime('%Y.%m.%d %H:%M:%S'), '1:', 'tuyadevctlsrv-fhem:', message, ...optionalParams),
};

fhemLogLogger.log = (level, ...args) => fhemLogLogger[level](...args);

module.exports = fhemLogLogger;
