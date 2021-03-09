/**
 * fhem-log-logger.ts
 * Author: derkallevombau
 * Created: Nov 24 2019
 */

// For strftime
/* eslint-disable @typescript-eslint/no-unsafe-call */

import strftime = require('strftime');

/**
 * Logger for first stage of application startup.
 * Since `console` outputs to stdout/stderr and these
 * are redirected to FHEM log, it uses the same formatting.
 */
const FhemLogLogger =
{
	debug(message: any, ...args: any[]): void { console.debug(strftime('%Y.%m.%d %H:%M:%S'), 'debug:', 'tuyadevctlsrv-fhem:', message, ...args); },
	info(message: any, ...args: any[]): void { console.info(strftime('%Y.%m.%d %H:%M:%S'), '2:', 'tuyadevctlsrv-fhem:', message, ...args); },
	warn(message: any, ...args: any[]): void { console.warn(strftime('%Y.%m.%d %H:%M:%S'), '1:', 'tuyadevctlsrv-fhem:', message, ...args); },
	error(message: any, ...args: any[]): void { console.error(strftime('%Y.%m.%d %H:%M:%S'), '1:', 'tuyadevctlsrv-fhem:', message, ...args); },
	fatal(message: any, ...args: any[]): void { console.error(strftime('%Y.%m.%d %H:%M:%S'), '0:', 'tuyadevctlsrv-fhem:', message, ...args); },

	// N.B.: - Using "String literal types" available since TS 4.1.
	//       - We can access the object's properties from inside the object.
	log(level: 'debug' | 'info' | 'warn' | 'error' | 'fatal', message: any, ...args: any[]): void { FhemLogLogger[level](message, ...args); }
};

export default FhemLogLogger;
